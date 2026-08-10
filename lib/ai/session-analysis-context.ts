import { prisma } from "@/lib/prisma";
import { listPauseIntervals } from "@/lib/session-pause-intervals";
import {
  buildPauseOffsetIntervals,
  filterSegmentsByPauseIntervals,
} from "@/lib/transcription/pause-interval-filter";
import { getPauseProcessingModeFromMetadata } from "@/lib/transcription/pause-processing-mode";
export { buildAnalysisPrompt } from "@/lib/ai/session-analysis-prompt";

export type SessionAnalysisParticipant = {
  id: string;
  displayName: string;
  type: string;
  roleName: string | null;
  notes: string;
};

export type SessionAnalysisRole = {
  id: string;
  name: string;
  privateInstructions: string;
  objectives: string;
  constraints: string;
  hiddenInfo: string;
  fallbackPosition: string;
};

export type SessionAnalysisTranscript = {
  id: string;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  segments: Array<{
    orderIndex: number;
    speakerLabel: string | null;
    mappedParticipantName: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
  }>;
};

export type SessionAnalysisContext = {
  session: {
    id: string;
    title: string;
    roomLabel: string | null;
    status: string;
    caseTitle: string;
    caseLanguage: string;
    publicInstructions: string;
    businessContext: string;
    preparationDurationSeconds: number;
    durationSeconds: number;
    startedAt: string | null;
    endedAt: string | null;
    negotiationStartedAt: string | null;
    negotiationEndedAt: string | null;
    sequenceNumber: number | null;
  };
  event: {
    id: string;
    title: string;
    status: string;
  } | null;
  roles: SessionAnalysisRole[];
  participants: SessionAnalysisParticipant[];
  transcript: SessionAnalysisTranscript | null;
};

export async function buildSessionAnalysisContext(
  sessionId: string,
): Promise<SessionAnalysisContext | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: {
      event: {
        select: { id: true, title: true, status: true },
      },
      sessionRoles: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          privateInstructions: true,
          objectives: true,
          constraints: true,
          hiddenInfo: true,
          fallbackPosition: true,
        },
      },
      participants: {
        select: {
          id: true,
          displayName: true,
          type: true,
          notes: true,
          sessionRole: {
            select: { name: true },
          },
        },
      },
      recording: {
        select: {
          startedAt: true,
          endedAt: true,
        },
      },
      transcript: {
        include: {
          segments: {
            orderBy: { orderIndex: "asc" },
            include: {
              mappedParticipant: {
                select: { displayName: true },
              },
            },
          },
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const participants: SessionAnalysisParticipant[] = session.participants.map(
    (p) => ({
      id: p.id,
      displayName: p.displayName,
      type: p.type,
      roleName: p.sessionRole?.name ?? null,
      notes: p.notes,
    }),
  );

  const roles: SessionAnalysisRole[] = session.sessionRoles.map((r) => ({
    id: r.id,
    name: r.name,
    privateInstructions: r.privateInstructions,
    objectives: r.objectives,
    constraints: r.constraints,
    hiddenInfo: r.hiddenInfo,
    fallbackPosition: r.fallbackPosition,
  }));

  let transcript: SessionAnalysisTranscript | null = null;
  if (session.transcript) {
    const t = session.transcript;
    const pauseProcessingMode = getPauseProcessingModeFromMetadata(
      t.processingMetadata,
    );
    const filteredSegments =
      pauseProcessingMode === "source_audio_cut"
        ? t.segments
        : filterSegmentsByPauseIntervals(
            t.segments,
            buildPauseOffsetIntervals({
              recordingStartedAt: session.recording?.startedAt,
              recordingEndedAt: session.recording?.endedAt,
              pauseIntervals: await listPauseIntervals(sessionId),
            }),
            (segment) => ({
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds,
            }),
          ).keptSegments;
    const pauseFilteringApplied = filteredSegments.length !== t.segments.length;
    transcript = {
      id: t.id,
      text: pauseFilteringApplied
        ? filteredSegments.map((seg) => seg.text.trim()).filter(Boolean).join(" ")
        : t.text,
      diarizedText: pauseFilteringApplied
        ? filteredSegments.length > 0
          ? filteredSegments.map((seg) => seg.text.trim()).filter(Boolean).join("\n\n")
          : null
        : t.diarizedText,
      language: t.language,
      transcriptionModel: t.transcriptionModel,
      hasSpeakerDiarization: t.hasSpeakerDiarization,
      segments: filteredSegments.map((seg) => ({
        orderIndex: seg.orderIndex,
        speakerLabel: seg.speakerLabel,
        mappedParticipantName: seg.mappedParticipant?.displayName ?? null,
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        text: seg.text,
      })),
    };
  }

  return {
    session: {
      id: session.id,
      title: session.title,
      roomLabel: session.roomLabel,
      status: session.status,
      caseTitle: session.snapshotCaseTitle,
      caseLanguage: session.snapshotCaseLanguage,
      publicInstructions: session.snapshotPublicInstructions,
      businessContext: session.snapshotBusinessContext,
      preparationDurationSeconds: session.preparationDurationSeconds,
      durationSeconds: session.durationSeconds,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      negotiationStartedAt: session.negotiationStartedAt?.toISOString() ?? null,
      negotiationEndedAt: session.negotiationEndedAt?.toISOString() ?? null,
      sequenceNumber: session.sequenceNumber,
    },
    event: session.event
      ? {
          id: session.event.id,
          title: session.event.title,
          status: session.event.status,
        }
      : null,
    roles,
    participants,
    transcript,
  };
}
