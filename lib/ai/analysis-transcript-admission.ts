import {
  AiAnalysisStatus,
  type PrismaClient,
} from "@/app/generated/prisma/client";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import {
  claimAiAnalysisRun,
  createPrismaAiAnalysisOperationStore,
  type AiAnalysisClaimResult,
} from "@/lib/ai/analysis-operation";
import {
  assembleSessionAnalysisContext,
  fingerprintSessionAnalysisContext,
  loadSessionAnalysisGraph,
  type SessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import { prisma } from "@/lib/prisma";
import { listPauseIntervals } from "@/lib/session-pause-intervals";
import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import { shouldConfirmAutoSuggestedMappingAfterAiAdmission } from "@/lib/transcription/confirm-mapping-after-ai-admission";
import { persistMappingOwnedTranscriptUpdate } from "@/lib/transcription/mapping-persistence";
import {
  lockAiAnalysisRowForUpdate,
  lockTranscriptRowForUpdate,
} from "@/lib/transcription/transcript-row-lock";

export type AdmitAiAnalysisMaterialResult =
  | (AiAnalysisClaimResult & {
      analysisContext: SessionAnalysisContext;
      inputFingerprint: string;
      transcriptId: string;
      transcriptRetranscribeCount: number;
    })
  | { state: "enhancement_in_flight" }
  | { state: "transcript_missing" }
  | { state: "session_missing" }
  | {
      state: "not_ready";
      reason: Exclude<
        ReturnType<typeof evaluateAiAnalysisReadiness>["reason"],
        "READY"
      >;
    };

export type AiAnalysisTranscriptAdmissionResult = AdmitAiAnalysisMaterialResult;

type AdmissionClient = Pick<PrismaClient, "$transaction">;

/**
 * Authoritative Start-AI claim used by the Analyze route.
 * Route prechecks are UX only. This function locks Transcript, constructs
 * the provider context from that snapshot, fingerprints it, then claims
 * AiAnalysis with that identity before commit.
 */
export async function admitAiAnalysisMaterial(params: {
  sessionId: string;
  language?: string;
  transcriptId?: string;
  now?: Date;
  client?: AdmissionClient;
  confirmAutoSuggestedMapping?: { confirmedBy: string };
}): Promise<AdmitAiAnalysisMaterialResult> {
  const client = params.client ?? prisma;
  const now = params.now ?? new Date();
  return client.$transaction(async (tx) => {
    const transcriptRef = await tx.transcript.findUnique({
      where: { sessionId: params.sessionId },
      select: { id: true },
    });
    if (!transcriptRef) {
      return { state: "transcript_missing" as const };
    }
    if (params.transcriptId && params.transcriptId !== transcriptRef.id) {
      return { state: "transcript_missing" as const };
    }
    const locked = await lockTranscriptRowForUpdate(tx, transcriptRef.id);
    if (!locked) {
      return { state: "transcript_missing" as const };
    }

    const session = await loadSessionAnalysisGraph(params.sessionId, tx);
    if (!session) {
      return { state: "session_missing" as const };
    }
    const transcript = session.transcript;
    if (!transcript || transcript.id !== transcriptRef.id) {
      return { state: "transcript_missing" as const };
    }

    const enhancementJob = parseTranscriptEnhancementJob(transcript.processingMetadata);
    if (enhancementJob.publicationEligible) {
      return { state: "enhancement_in_flight" as const };
    }

    const sessionParticipants = session.participants.map((participant) => ({
      id: participant.id,
      type: participant.type,
    }));
    const readiness = evaluateAiAnalysisReadiness({
      status: transcript.status,
      text: transcript.text,
      diarizedText: transcript.diarizedText,
      hasSpeakerDiarization: transcript.hasSpeakerDiarization,
      speakerMappingStatus: transcript.speakerMappingStatus,
      speakerMapping: transcript.speakerMapping,
      enhancementStatus: enhancementJob.executionStatus,
      enhancementPublicationEligible: enhancementJob.publicationEligible,
      participants: sessionParticipants,
      segments: transcript.segments.map((segment) => ({
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        text: segment.text,
      })),
    });
    if (readiness.reason !== "READY") {
      const reason: Exclude<
        ReturnType<typeof evaluateAiAnalysisReadiness>["reason"],
        "READY"
      > = readiness.reason;
      return { state: "not_ready" as const, reason };
    }

    const pauseIntervals = await listPauseIntervals(params.sessionId, tx);
    const analysisContext = assembleSessionAnalysisContext(session, pauseIntervals);
    const inputFingerprint = fingerprintSessionAnalysisContext(analysisContext);
    const analysisLanguage =
      params.language ??
      transcript.language ??
      session.snapshotCaseLanguage.toLowerCase();
    const transcriptRetranscribeCount = transcript.retranscribeCount ?? 0;

    await lockAiAnalysisRowForUpdate(tx, params.sessionId);
    const claimed = await claimAiAnalysisRun({
      sessionId: params.sessionId,
      transcriptId: transcript.id,
      transcriptRetranscribeCount,
      language: analysisLanguage,
      inputFingerprint,
      now,
      store: createPrismaAiAnalysisOperationStore(tx),
    });

    if (claimed.state === "claimed" && params.confirmAutoSuggestedMapping) {
      if (
        shouldConfirmAutoSuggestedMappingAfterAiAdmission({
          speakerMappingStatus: transcript.speakerMappingStatus,
          hasSpeakerDiarization: transcript.hasSpeakerDiarization,
          segments: transcript.segments.map((segment) => ({
            text: segment.text,
            speakerLabel: segment.speakerLabel,
            mappedParticipantId: segment.mappedParticipantId,
          })),
          participants: sessionParticipants,
        })
      ) {
        await persistMappingOwnedTranscriptUpdate({
          tx,
          transcriptId: transcript.id,
          expectedTranscriptId: transcript.id,
          expectedRetranscribeCount: transcriptRetranscribeCount,
          patch: {
            speakerMappingStatus: "CONFIRMED",
            speakerMappingConfirmedAt: now,
            speakerMappingConfirmedBy: params.confirmAutoSuggestedMapping.confirmedBy,
          },
          rebuildDiarizedText: false,
        });
      }
    }

    if (claimed.state === "claimed") {
      return {
        ...claimed,
        analysisContext,
        inputFingerprint,
        transcriptId: transcript.id,
        transcriptRetranscribeCount,
      };
    }
    return {
      ...claimed,
      analysisContext,
      inputFingerprint,
      transcriptId: transcript.id,
      transcriptRetranscribeCount,
    };
  });
}

/**
 * @deprecated Use `admitAiAnalysisMaterial`. Kept as the Product admission
 * entry used by existing PG-RACE coverage.
 */
export async function claimAiAnalysisRunWithTranscriptAuthority(params: {
  sessionId: string;
  transcriptId: string;
  transcriptRetranscribeCount: number;
  language: string;
  now?: Date;
  client?: AdmissionClient;
  confirmAutoSuggestedMapping?: { confirmedBy: string };
}): Promise<AdmitAiAnalysisMaterialResult> {
  return admitAiAnalysisMaterial({
    sessionId: params.sessionId,
    transcriptId: params.transcriptId,
    language: params.language,
    now: params.now,
    client: params.client,
    confirmAutoSuggestedMapping: params.confirmAutoSuggestedMapping,
  });
}

export function isLiveAiAnalysisStatus(status: AiAnalysisStatus | string | null | undefined): boolean {
  return status === AiAnalysisStatus.QUEUED || status === AiAnalysisStatus.ANALYZING;
}
