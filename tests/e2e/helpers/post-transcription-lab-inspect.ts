import { isEnhancementStatusRunning, listMappingStageFromTranscript } from "../../../lib/post-processing/projection";
import { evaluateSpeakerMappingStructuralCompleteness } from "../../../lib/transcription/speaker-mapping-completeness";
import { query } from "./db";
import type {
  LabDomainSnapshot,
  LabReadinessSnapshot,
} from "./post-transcription-lab-briefing";

export type { LabDomainSnapshot, LabReadinessSnapshot };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function currentEnhancementStatus(processingMetadata: unknown): string | null {
  const enhancement = asRecord(asRecord(processingMetadata).transcriptEnhancement);
  const status = typeof enhancement.status === "string" ? enhancement.status : null;
  if (status === "IN_PROGRESS" || status === "RUNNING") {
    return "IN_PROGRESS";
  }
  return status;
}


export async function loadLabDomainSnapshot(sessionId: string): Promise<LabDomainSnapshot> {
  const session = (
    await query<{
      status: string;
      negotiationState: string;
      roomLifecycle: string | null;
    }>(
      `SELECT "status","negotiationState","roomLifecycle" FROM "Session" WHERE "id" = $1`,
      [sessionId],
    )
  )[0];
  if (!session) {
    throw new Error(`Lab inspect could not find session ${sessionId}`);
  }

  const recording = (
    await query<{ status: string }>(
      `SELECT "status" FROM "Recording" WHERE "sessionId" = $1`,
      [sessionId],
    )
  )[0];

  const transcript = (
    await query<{
      id: string;
      status: string;
      retranscribeCount: number;
      speakerMappingStatus: string | null;
      speakerMappingConfirmedAt: Date | string | null;
      speakerMappingConfirmedBy: string | null;
      hasSpeakerDiarization: boolean;
      processingMetadata: unknown;
      speakerMapping: unknown;
      text: string;
      diarizedText: string | null;
    }>(
      `SELECT "id","status","retranscribeCount","speakerMappingStatus",
              "speakerMappingConfirmedAt","speakerMappingConfirmedBy",
              "hasSpeakerDiarization","processingMetadata","speakerMapping",
              "text","diarizedText"
       FROM "Transcript" WHERE "sessionId" = $1`,
      [sessionId],
    )
  )[0];

  const segments = transcript
    ? await query<{
        speakerLabel: string | null;
        mappedParticipantId: string | null;
        text: string;
      }>(
        `SELECT "speakerLabel","mappedParticipantId","text"
         FROM "TranscriptSegment" WHERE "transcriptId" = $1
         ORDER BY "orderIndex" ASC`,
        [transcript.id],
      )
    : [];

    const ai = (
    await query<{
      status: string;
      transcriptId: string | null;
      transcriptRetranscribeCount: number;
      inputFingerprint: string | null;
    }>(
      `SELECT "status","transcriptId","transcriptRetranscribeCount","inputFingerprint"
       FROM "AiAnalysis" WHERE "sessionId" = $1`,
      [sessionId],
    )
  )[0];

  const publication = (
    await query<{ id: string }>(
      `SELECT p."id"
       FROM "AiAnalysisPublication" p
       JOIN "AiAnalysis" a ON a."id" = p."aiAnalysisId"
       WHERE a."sessionId" = $1 AND p."revokedAt" IS NULL
       LIMIT 1`,
      [sessionId],
    )
  )[0];

  const metadata = asRecord(transcript?.processingMetadata);
  return {
    sessionStatus: session.status,
    negotiationState: session.negotiationState,
    roomLifecycle: session.roomLifecycle,
    recordingStatus: recording?.status ?? null,
    transcriptStatus: transcript?.status ?? null,
    transcriptId: transcript?.id ?? null,
    retranscribeCount: transcript?.retranscribeCount ?? null,
    speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
    speakerMappingConfirmedAt: transcript?.speakerMappingConfirmedAt
      ? String(transcript.speakerMappingConfirmedAt)
      : null,
    speakerMappingConfirmedBy: transcript?.speakerMappingConfirmedBy ?? null,
    enhancementStatus: currentEnhancementStatus(transcript?.processingMetadata),
    mappingSuggestion: metadata.mappingSuggestion ?? null,
    processingMetadataKeys: Object.keys(metadata),
    segmentCount: segments.length,
    mappedSpokenSegmentCount: segments.filter(
      (segment) => segment.text.trim() && segment.mappedParticipantId,
    ).length,
    aiStatus: ai?.status ?? null,
    aiTranscriptId: ai?.transcriptId ?? null,
    aiRetranscribeCount: ai?.transcriptRetranscribeCount ?? null,
    aiInputFingerprint: ai?.inputFingerprint ?? null,
    publicationActive: Boolean(publication),
  };
}

export async function loadLabReadinessSnapshot(
  sessionId: string,
): Promise<LabReadinessSnapshot> {
  const transcript = (
    await query<{
      status: string;
      text: string;
      diarizedText: string | null;
      hasSpeakerDiarization: boolean;
      speakerMappingStatus: string | null;
      speakerMapping: unknown;
      processingMetadata: unknown;
    }>(
      `SELECT "status","text","diarizedText","hasSpeakerDiarization",
              "speakerMappingStatus","speakerMapping","processingMetadata"
       FROM "Transcript" WHERE "sessionId" = $1`,
      [sessionId],
    )
  )[0];
  const segments = transcript
    ? await query<{
        speakerLabel: string | null;
        mappedParticipantId: string | null;
        text: string;
      }>(
        `SELECT seg."speakerLabel", seg."mappedParticipantId", seg."text"
         FROM "TranscriptSegment" seg
         JOIN "Transcript" t ON t."id" = seg."transcriptId"
         WHERE t."sessionId" = $1`,
        [sessionId],
      )
    : [];
  const participants = await query<{ id: string; type: string }>(
    `SELECT "id","type" FROM "SessionParticipant" WHERE "sessionId" = $1`,
    [sessionId],
  );

  const enhancementStatus = currentEnhancementStatus(transcript?.processingMetadata);
  const hasUsableContent = Boolean(
    transcript?.text?.trim() ||
      transcript?.diarizedText?.trim() ||
      segments.some((segment) => segment.text?.trim()),
  );
  const completeness = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: Boolean(transcript?.hasSpeakerDiarization),
    speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
    segments,
    participants,
  });
  const enhancementRunning = isEnhancementStatusRunning(enhancementStatus);
  const transcriptReady = hasUsableContent && transcript?.status === "COMPLETED";
  const aiReady = transcriptReady && completeness.readyForAnalysis && !enhancementRunning;
  const sessionsListMappingStage = listMappingStageFromTranscript({
    transcriptPresent: Boolean(transcript),
    mappingInput: {
      hasSpeakerDiarization: Boolean(transcript?.hasSpeakerDiarization),
      speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
      segments,
      participants,
    },
  });

  return {
    transcriptUsable: transcriptReady,
    enhancementTerminal: !enhancementRunning,
    speakerMappingReadyForAnalysis: completeness.readyForAnalysis,
    aiReadyByCurrentContract: aiReady,
    aiReadyReason: !transcript
      ? "TRANSCRIPT_MISSING"
      : transcript.status !== "COMPLETED"
        ? "TRANSCRIPT_NOT_COMPLETED"
        : !hasUsableContent
          ? "TRANSCRIPT_CONTENT_EMPTY"
          : enhancementRunning
            ? "ENHANCEMENT_RUNNING"
            : !completeness.readyForAnalysis
              ? "SPEAKER_MAPPING_REQUIRED"
              : "READY",
    sessionsListMappingStage,
    materialsRailMappingStage: completeness.readyForAnalysis
      ? transcript?.speakerMappingStatus === "CONFIRMED"
        ? "ready"
        : "informational"
      : Boolean(transcript)
        ? "action_required"
        : "pending",
  };
}

