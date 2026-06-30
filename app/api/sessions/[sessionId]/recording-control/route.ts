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
import { buildVoximplantRecordingDispatch } from "@/lib/voximplant/recording-dispatch";

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
// Returns a typed RecordingControlMessage for the browser adapter to relay to
// the Voximplant conference via SDK Conference.sendMessage().
//
// The browser adapter workflow:
//   1. Call POST /api/sessions/{id}/recording-control with { action, ... }
//   2. Receive { ok, scenarioMessage, recordingConfig, recordingStatusPending }
//   3. Send JSON.stringify(scenarioMessage) to the Voximplant conference via SDK
//   4. The VoxEngine scenario receives it via MessagingAPIMessage and executes
//      the recording action, then sends a RecordingStatusMessage back.
//   5. Poll this endpoint with action=refresh to get final status (Stage 5.4:
//      implement server-push via scenario HTTP callback for real-time status).
//
// Recording.fileKey handoff (deferred to Stage 5.4):
//   The VoxEngine scenario can provide a Recording.fileKey in a RecordingStatusMessage.
//   Safe handoff requires: (a) a server webhook to receive the key from the scenario,
//   (b) a Recording DB row created by the scenario callback rather than the client.
//   Creating a Recording row here without a real fileKey would require schema changes
//   (optional fileKey) which is deferred per Stage 5.3 constraints.
//   Next step for Stage 5.4: add VOXIMPLANT_RECORDING_WEBHOOK_SECRET + POST handler
//   that writes the Recording row when the scenario reports recording completion.

function handleVoximplantRecording(
  action: "start" | "stop" | "refresh",
  sessionId: string,
  participantId: string,
) {
  try {
    const dispatch = buildVoximplantRecordingDispatch(action, {
      sessionId,
      participantId,
      // Role not available here — use access-control-resolved participant type above.
      // The scenario independently authorizes via the user's VoxRoomRole credential.
    });

    return NextResponse.json({
      ok: dispatch.ok,
      provider: "voximplant" as const,
      warning: dispatch.warning,
      // Typed scenario message — browser adapter relays this to the conference SDK.
      scenarioMessage: dispatch.scenarioMessage,
      recordingConfig: dispatch.recordingConfig,
      // Pending status while the scenario processes the command.
      recording: {
        status: dispatch.recordingStatusPending,
        errorMessage: null,
      },
      // Stage 5.4 note:
      // Recording.fileKey handoff is deferred. The browser adapter should relay the
      // scenario message and then await a RecordingStatusMessage from the scenario.
      // Server-side status tracking requires a scenario HTTP callback endpoint.
      fileKeyHandoffDeferred: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build Voximplant recording dispatch.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
