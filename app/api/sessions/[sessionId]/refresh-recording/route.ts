import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { refreshRecordingStatus } from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { appendRecordingDebugEvent } from "@/lib/debug/recording-debug";

export const runtime = "nodejs";

const refreshSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
}).refine((data) => Boolean(data.joinToken || data.participantId), {
  message: "joinToken or participantId is required",
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);

  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
  });
  const provider = resolveEffectiveRecordingProvider(recording?.provider);

  appendRecordingDebugEvent({
    sessionId,
    source: "refresh-recording",
    level: "info",
    step: "refresh-recording:called",
    message: `refresh-recording called, provider=${provider} recordingFound=${Boolean(recording)}`,
    data: {
      provider,
      recordingFound: Boolean(recording),
      status: recording?.status ?? null,
    },
  });

  // For Voximplant: recording status is updated exclusively by the VoxEngine
  // webhook (/voximplant/recording-status). Calling LiveKit egress here would
  // be wrong. Return the current DB row directly (null when not yet created).
  if (provider === "voximplant") {
    if (!recording) {
      return NextResponse.json({ recording: null });
    }
    return NextResponse.json({
      recording: {
        id: recording.id,
        status: recording.status,
        recordingType: recording.recordingType,
        fileKey: recording.fileKey,
        fileName: recording.fileName,
        originalSizeBytes: recording.originalSizeBytes,
        compressedSizeBytes: recording.compressedSizeBytes,
        compressionStatus: recording.compressionStatus,
        compressionError: recording.compressionError,
        startedAt: recording.startedAt?.toISOString() ?? null,
        endedAt: recording.endedAt?.toISOString() ?? null,
        errorMessage: recording.errorMessage,
      },
    });
  }

  if (!recording) {
    return NextResponse.json({ error: "No recording available yet." }, { status: 404 });
  }

  // LiveKit: refresh status via egress API.
  const updated = await refreshRecordingStatus(recording);

  return NextResponse.json({
    recording: {
      id: updated.id,
      status: updated.status,
      recordingType: updated.recordingType,
      fileKey: updated.fileKey,
      fileName: updated.fileName,
      originalSizeBytes: updated.originalSizeBytes,
      compressedSizeBytes: updated.compressedSizeBytes,
      compressionStatus: updated.compressionStatus,
      compressionError: null,
      startedAt: updated.startedAt?.toISOString() ?? null,
      endedAt: updated.endedAt?.toISOString() ?? null,
      errorMessage: updated.errorMessage,
    },
  });
}
