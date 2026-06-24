import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import {
  getDisplaySpeakerLabel,
  getUniqueSpeakerLabels,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const joinToken = new URL(_request.url).searchParams.get("joinToken")?.trim();

  if (!joinToken) {
    return NextResponse.json({ error: "Join token is required." }, { status: 400 });
  }

  try {
    const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);

    if (!participant || participant.type !== ParticipantType.FACILITATOR) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        deletedAt: null,
      },
      include: {
        recording: true,
        transcript: {
          include: {
            segments: {
              orderBy: { orderIndex: "asc" },
            },
          },
        },
        participants: {
          include: {
            sessionRole: {
              select: { name: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const labelOrder =
      session.transcript?.segments
        .map((segment) => segment.speakerLabel)
        .filter((label): label is string => Boolean(label)) ?? [];

    const detectedSpeakers = session.transcript
      ? getUniqueSpeakerLabels(
          session.transcript.segments.map((segment) => ({
            speakerLabel: segment.speakerLabel,
            displaySpeakerLabel: segment.speakerLabel
              ? getDisplaySpeakerLabel(segment.speakerLabel, labelOrder)
              : null,
          })),
        )
      : [];

    return NextResponse.json({
      recording: session.recording
        ? {
            id: session.recording.id,
            status: session.recording.status,
            recordingType: session.recording.recordingType,
            fileKey: session.recording.fileKey,
            fileName: session.recording.fileName,
            mimeType: session.recording.mimeType,
            originalSizeBytes: session.recording.originalSizeBytes,
            compressedFileKey: session.recording.compressedFileKey,
            compressedFileName: session.recording.compressedFileName,
            compressedMimeType: session.recording.compressedMimeType,
            compressedSizeBytes: session.recording.compressedSizeBytes,
            compressionStatus: session.recording.compressionStatus,
            compressionError: session.recording.compressionError,
            startedAt: session.recording.startedAt?.toISOString() ?? null,
            endedAt: session.recording.endedAt?.toISOString() ?? null,
            errorMessage: session.recording.errorMessage,
          }
        : null,
      transcript: session.transcript
        ? {
            id: session.transcript.id,
            source: session.transcript.source,
            text: session.transcript.text,
            diarizedText: session.transcript.diarizedText,
            language: session.transcript.language,
            transcriptionModel: session.transcript.transcriptionModel,
            hasSpeakerDiarization: session.transcript.hasSpeakerDiarization,
            speakerMapping:
              (session.transcript.speakerMapping as SpeakerMapping | null) ?? null,
            updatedAt: session.transcript.updatedAt.toISOString(),
            segments: session.transcript.segments.map((segment) => ({
              id: segment.id,
              speakerLabel: segment.speakerLabel,
              mappedParticipantId: segment.mappedParticipantId,
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds,
              text: segment.text,
              orderIndex: segment.orderIndex,
              displaySpeakerLabel: segment.speakerLabel
                ? getDisplaySpeakerLabel(segment.speakerLabel, labelOrder)
                : null,
            })),
          }
        : null,
      detectedSpeakers,
      participants: session.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName,
        type: participant.type,
        roleName: participant.sessionRole?.name ?? null,
      })),
      isDeleted: session.deletedAt != null,
    });
  } catch (error) {
    console.error("[recording] Failed to load session recording data:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load recording data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
