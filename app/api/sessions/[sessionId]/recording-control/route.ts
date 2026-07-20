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
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";
import { validateSessionRoomConnectionLease } from "@/lib/session-room-connection-lease";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import {
  buildVoximplantRecordingDispatch,
  getVoximplantRecordingStateFromDb,
  upsertVoximplantRecordingOnStart,
  upsertVoximplantRecordingOnStop,
} from "@/lib/voximplant/recording-dispatch";
import { resolveVoximplantRecordingWebhookUrlFromDb } from "@/lib/voximplant/recording-webhook-url";
import { appendRecordingDebugEvent } from "@/lib/debug/recording-debug";
import {
  claimStopRelayDispatch,
  getStopRelayHintForSession,
  reportStopRelayOutcome,
} from "@/lib/session-recording-stop-relay";

export const runtime = "nodejs";

const actionSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  connectionId: z.string().trim().min(1).max(128).optional(),
  operationId: z.string().trim().min(1).max(128).optional(),
  action: z.enum(["start", "stop", "refresh", "relay_stop", "relay_stop_report"]),
  stopOperationId: z.string().trim().min(1).optional(),
  relayOutcome: z
    .enum(["ACKNOWLEDGED", "SEND_FAILED", "TIMEOUT", "UNAVAILABLE"])
    .optional(),
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

  // ── Baseline participant + lease checks ───────────────────────────────────
  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );

  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const accessDecision = decideSessionRoomAccess({
    user: {
      isAuthenticated: true,
      isAuthorizedMember: true,
    },
    session: {
      sessionId,
      negotiationState: participant.session.negotiationState,
      roomLifecycle: participant.session.roomLifecycle ?? null,
      deletedAt: participant.session.deletedAt ?? null,
      closeReason: participant.session.closeReason ?? null,
      closedByEventAt: participant.session.closedByEventAt ?? null,
      eventId: participant.session.eventId ?? null,
      eventStatus: participant.session.event?.status ?? null,
    },
    redirect: {
      sessionId,
      participantJoinToken: participant.joinToken,
      eventId: participant.session.eventId ?? null,
      eventStatus: participant.session.event?.status ?? null,
      preferEventResultsForEventOwner: participant.type === ParticipantType.FACILITATOR,
    },
  });
  if (!isRoomAccessAllowed(accessDecision.output)) {
    if (accessDecision.output === "DENY_DELETED") {
      return NextResponse.json({ error: "sessionDeleted" }, { status: 404 });
    }
    if (accessDecision.output === "DENY_UNAUTHORIZED") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    return NextResponse.json(
      {
        error:
          accessDecision.output === "EVENT_CLOSED" ? "eventClosed" : "roomClosed",
        code:
          accessDecision.output === "EVENT_CLOSED"
            ? "EVENT_CLOSED"
            : "ROOM_CLOSED",
        redirectTo: accessDecision.redirectTo,
      },
      { status: 409 },
    );
  }

  if (
    accessDecision.output === "ALLOW_DEBRIEF" &&
    parsed.data.action !== "refresh" &&
    parsed.data.action !== "relay_stop" &&
    parsed.data.action !== "relay_stop_report"
  ) {
    return NextResponse.json(
      {
        error: "recordingControlUnavailableInDebrief",
        code: "DEBRIEF_RECORDING_CONTROL_DENIED",
      },
      { status: 409 },
    );
  }

  if (participant.userId && parsed.data.connectionId) {
    const leaseState = await validateSessionRoomConnectionLease({
      sessionId,
      userId: participant.userId,
      connectionId: parsed.data.connectionId,
    });
    if (!leaseState.isCurrentConnectionActive) {
      return NextResponse.json(
        {
          error: "staleConnection",
          code: "STALE_CONNECTION",
          activeConnectionVersion: leaseState.version,
        },
        { status: 409 },
      );
    }
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      livekitRoomName: true,
      deletedAt: true,
      recording: { select: { provider: true } },
    },
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
  const provider = resolveEffectiveRecordingProvider(
    session.recording?.provider,
  );

  if (provider === "voximplant") {
    if (parsed.data.action === "relay_stop") {
      const hint = await getStopRelayHintForSession({
        sessionId,
        participantType: participant.type,
      });
      if (!hint) {
        return NextResponse.json(
          { error: "stopRelayUnavailable", code: "STOP_RELAY_UNAVAILABLE" },
          { status: 409 },
        );
      }
      if (
        parsed.data.stopOperationId &&
        parsed.data.stopOperationId !== hint.operationId
      ) {
        return NextResponse.json(
          { error: "stopRelayOperationMismatch", code: "STOP_RELAY_OPERATION_MISMATCH" },
          { status: 403 },
        );
      }

      const claim = await claimStopRelayDispatch({
        sessionId,
        operationId: hint.operationId,
        participant: {
          id: participant.id,
          type: participant.type,
        },
      });

      if (!claim) {
        return NextResponse.json(
          { error: "stopRelayClaimUnavailable", code: "STOP_RELAY_CLAIM_UNAVAILABLE" },
          { status: 409 },
        );
      }

      const recording = await getVoximplantRecordingStateFromDb(sessionId);
      return NextResponse.json({
        ok: true,
        provider: "voximplant" as const,
        stopRelay: {
          operationId: claim.operationId,
          requestId: claim.requestId,
          scenarioMessage: claim.scenarioMessage,
        },
        recording,
      });
    }

    if (parsed.data.action === "relay_stop_report") {
      if (!parsed.data.stopOperationId || !parsed.data.relayOutcome) {
        return NextResponse.json(
          { error: "stopOperationId and relayOutcome are required." },
          { status: 400 },
        );
      }
      await reportStopRelayOutcome({
        sessionId,
        operationId: parsed.data.stopOperationId,
        outcome: parsed.data.relayOutcome,
      });
      return NextResponse.json({ ok: true, provider: "voximplant" as const });
    }

    if (participant.type !== ParticipantType.FACILITATOR) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    return handleVoximplantRecording(
      parsed.data.action,
      sessionId,
      participant.id,
      parsed.data.operationId,
    );
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
  requestId?: string,
) {
  console.log(
    `[recording-control] provider=voximplant action=${action} sessionId=${sessionId}`,
  );

  appendRecordingDebugEvent({
    sessionId,
    source: "recording-control",
    level: "info",
    step: `recording-control:${action}:received`,
    message: `recording-control ${action} received`,
    data: {
      provider: "voximplant",
      action,
      sessionId,
      participantIdPresent: Boolean(participantId),
    },
  });

  if (action === "refresh") {
    const recording = await getVoximplantRecordingStateFromDb(sessionId);
    appendRecordingDebugEvent({
      sessionId,
      source: "recording-control",
      level: "info",
      step: "recording-control:refresh:db",
      message: `refresh DB result: status=${recording.status}`,
      data: { status: recording.status },
    });
    return NextResponse.json({
      ok: true,
      provider: "voximplant" as const,
      recording,
      fileKeyHandoff: "webhook" as const,
      fileKeyHandoffDeferred: false,
    });
  }

  try {
    const [dispatch, webhookResolution] = await Promise.all([
      buildVoximplantRecordingDispatch(action, {
        sessionId,
        participantId,
        requestId,
      }),
      resolveVoximplantRecordingWebhookUrlFromDb(),
    ]);

    appendRecordingDebugEvent({
      sessionId,
      source: "scenario-message",
      level: "info",
      step: `recording-control:${action}:scenarioMessage`,
      message: `scenarioMessage built for action=${action}`,
      data: {
        action: dispatch.scenarioMessage.action,
        sessionId: dispatch.scenarioMessage.sessionId,
        conferenceName: dispatch.scenarioMessage.conferenceName,
        webhookBaseUrl: dispatch.scenarioMessage.webhookBaseUrl ?? null,
        webhookBaseUrlSource: webhookResolution.effectiveSource,
        overrideEnabled: webhookResolution.overrideEnabled,
        savedOverridePresent: webhookResolution.savedOverridePresent,
        envWebhookBaseUrlPresent: Boolean(webhookResolution.envWebhookBaseUrl),
        requestId: dispatch.scenarioMessage.requestId,
        requestIdOverrideUsed: Boolean(requestId),
      },
    });

    // Persist Recording row so webhook can find/update it and materials page shows status.
    const persisted =
      action === "start"
        ? await upsertVoximplantRecordingOnStart(sessionId)
        : await upsertVoximplantRecordingOnStop(sessionId);

    console.log(
      `[recording-control] vox ${action}: DB result recordingId=${persisted.id} status=${persisted.status}`,
    );

    appendRecordingDebugEvent({
      sessionId,
      source: "recording-control",
      level: persisted.status === "FAILED" ? "error" : "success",
      step: `recording-control:${action}:db`,
      message: `${action} DB result: recordingId=${persisted.id} status=${persisted.status}`,
      data: {
        recordingId: persisted.id,
        status: persisted.status,
      },
    });

    return NextResponse.json({
      ok: dispatch.ok,
      provider: "voximplant" as const,
      warning: dispatch.warning,
      scenarioMessage: dispatch.scenarioMessage,
      recordingConfig: dispatch.recordingConfig,
      recording: {
        id: persisted.id,
        status: persisted.status,
        errorMessage: persisted.errorMessage,
      },
      fileKeyHandoff: "webhook" as const,
      fileKeyHandoffDeferred: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to build Voximplant recording dispatch.";
    appendRecordingDebugEvent({
      sessionId,
      source: "recording-control",
      level: "error",
      step: `recording-control:${action}:error`,
      message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
