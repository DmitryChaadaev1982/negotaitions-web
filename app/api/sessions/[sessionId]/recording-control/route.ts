import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  refreshRecordingStatus,
  startAudioOnlyRoomRecording,
  stopRecording,
} from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import { getVideoProvider } from "@/lib/env";
import { buildVoximplantRecordingDispatch, getVoximplantRecordingStateFromDb } from "@/lib/voximplant/recording-dispatch";

export const runtime = "nodejs";

const actionSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  action: z.enum(["start", "stop", "refresh"]),
  // Required for start action: caller must explicitly confirm recording consent in UI.
  // Absent or false → 400 for start; ignored for stop/refresh.
  recordingConsentConfirmed: z.boolean().optional(),
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

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  // ── Baseline permission checks (same for all providers) ──────────────────
  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );

  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, livekitRoomName: true, deletedAt: true },
  });

  if (!session || session.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
  }

  if (parsed.data.action === "start") {
    if (!parsed.data.recordingConsentConfirmed) {
      return NextResponse.json(
        { error: "recordingConsentConfirmed is required to start recording." },
        { status: 400 },
      );
    }
  }

  // ── Provider dispatch ────────────────────────────────────────────────────
  const provider = getVideoProvider();

  if (provider === "voximplant") {
    return handleVoximplantRecording(
      parsed.data.action,
      sessionId,
      participant.id,
    );
  }

  // ── LiveKit dispatch (existing behavior — unchanged) ─────────────────────
  if (parsed.data.action === "start") {
    const result = await startAudioOnlyRoomRecording(session);
    return NextResponse.json({
      ok: result.ok,
      warning: result.ok ? undefined : result.warning,
      recording: result.recording,
    });
  }

  const recording = await prisma.recording.findUnique({ where: { sessionId } });
  if (!recording) {
    return NextResponse.json({ error: "No recording available yet." }, { status: 404 });
  }

  if (parsed.data.action === "stop") {
    const result = await stopRecording(recording);
    return NextResponse.json({
      ok: result.ok,
      warning: result.ok ? undefined : result.warning,
      recording: result.recording,
    });
  }

  const updated = await refreshRecordingStatus(recording);
  return NextResponse.json({ recording: updated });
}

// ─── Voximplant recording handler ────────────────────────────────────────────
//
// Start/stop: returns a typed RecordingControlMessage for the browser adapter
// to relay via conference.sendMessage(). The VoxEngine scenario executes the
// recording action and sends status updates to the server webhook.
//
// Refresh: reads the canonical Recording DB row (updated by the webhook).
// Does not dispatch a scenario message.

async function handleVoximplantRecording(
  action: "start" | "stop" | "refresh",
  sessionId: string,
  participantId: string,
) {
  if (action === "refresh") {
    const recording = await getVoximplantRecordingStateFromDb(sessionId);
    return NextResponse.json({
      ok: true,
      provider: "voximplant" as const,
      recording,
      fileKeyHandoff: "webhook" as const,
      fileKeyHandoffDeferred: false,
    });
  }

  try {
    const dispatch = buildVoximplantRecordingDispatch(action, {
      sessionId,
      participantId,
    });

    return NextResponse.json({
      ok: dispatch.ok,
      provider: "voximplant" as const,
      warning: dispatch.warning,
      scenarioMessage: dispatch.scenarioMessage,
      recordingConfig: dispatch.recordingConfig,
      recording: {
        status: dispatch.recordingStatusPending,
        errorMessage: null,
      },
      fileKeyHandoff: "webhook" as const,
      fileKeyHandoffDeferred: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build Voximplant recording dispatch.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
