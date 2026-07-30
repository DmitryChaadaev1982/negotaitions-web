import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  handleNegotiationStartRecording,
} from "@/lib/livekit-egress";
import {
  buildControlState,
  getAutoFinishPreparationUpdateData,
  getControlUpdateData,
  SESSION_CONTROL_SELECT,
  shouldAutoFinish,
  shouldAutoFinishPreparation,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  buildSessionCloseState,
  isSessionClosedByOrganizer,
  SESSION_CLOSE_SELECT,
} from "@/lib/session-close-state";
import {
  closeAllOpenPauseIntervals,
  closeLatestPauseInterval,
  createPauseInterval,
} from "@/lib/session-pause-intervals";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";
import { validateSessionRoomConnectionLease } from "@/lib/session-room-connection-lease";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { shouldRunLivekitRecordingLifecycle } from "@/lib/session-control-recording-policy";
import { completeSessionCanonical } from "@/lib/session-completion";

const controlActionSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  connectionId: z.string().trim().min(1).max(128).optional(),
  action: z.enum([
    "START_PREPARATION",
    "PAUSE_PREPARATION",
    "RESUME_PREPARATION",
    "STOP_PREPARATION",
    "SKIP_PREPARATION",
    "START",
    "PAUSE",
    "RESUME",
    "FINISH",
  ]),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export const runtime = "nodejs";

function shortConnectionId(connectionId: string | null | undefined) {
  if (!connectionId) return null;
  if (connectionId.length <= 12) return connectionId;
  return connectionId.slice(-12);
}

function logStage310SessionControl(
  event: string,
  payload: Record<string, unknown>,
) {
  console.info(
    JSON.stringify({
      area: "stage310_session_control",
      event,
      ...payload,
    }),
  );
}

async function syncPauseIntervals(
  sessionId: string,
  action: "PAUSE" | "RESUME" | "FINISH",
  now: Date,
) {
  if (action === "PAUSE") {
    await createPauseInterval(sessionId, now);
    return;
  }

  if (action === "RESUME") {
    await closeLatestPauseInterval(sessionId, now);
    return;
  }

  await closeAllOpenPauseIntervals(sessionId, now);
}

function isIdempotentNoopAction(params: {
  action: z.infer<typeof controlActionSchema>["action"];
  negotiationState: string;
}) {
  if (params.action === "PAUSE" && params.negotiationState === "PAUSED") {
    return true;
  }
  if (params.action === "RESUME" && params.negotiationState === "RUNNING") {
    return true;
  }
  return false;
}

async function applyAutoTransitions(sessionId: string, now: Date) {
  let session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      ...SESSION_CONTROL_SELECT,
      ...SESSION_CLOSE_SELECT,
    },
  });

  if (buildSessionCloseState(session).isClosed) {
    return session;
  }

  if (shouldAutoFinishPreparation(session, now)) {
    session = await prisma.session.update({
      where: { id: sessionId },
      data: getAutoFinishPreparationUpdateData(session, now),
      select: {
        ...SESSION_CONTROL_SELECT,
        ...SESSION_CLOSE_SELECT,
      },
    });
  }

  if (shouldAutoFinish(session, now)) {
    await completeSessionCanonical({
      sessionId,
      mode: "ROOM_FACILITATOR_FINISH",
      reason: "AUTO_TIMER_FINISH",
    });
    session = await prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        ...SESSION_CONTROL_SELECT,
        ...SESSION_CLOSE_SELECT,
      },
    });
  }

  return session;
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = controlActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { action } = parsed.data;
  logStage310SessionControl("operation_started", {
    sessionId,
    action,
    connectionId: shortConnectionId(parsed.data.connectionId),
  });
  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );

  if (!participant) {
    logStage310SessionControl("authorisation_result", {
      sessionId,
      action,
      authorised: false,
      reason: "participant_not_found",
      connectionId: shortConnectionId(parsed.data.connectionId),
    });
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
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
  logStage310SessionControl("authorisation_result", {
    sessionId,
    action,
    authorised: isRoomAccessAllowed(accessDecision.output),
    decision: accessDecision.output,
    participantType: participant.type,
    negotiationState: participant.session.negotiationState,
    roomLifecycle: participant.session.roomLifecycle ?? null,
    eventId: participant.session.eventId ?? null,
    connectionId: shortConnectionId(parsed.data.connectionId),
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
    action !== "FINISH"
  ) {
    return NextResponse.json(
      {
        error: "negotiationAlreadyFinished",
        code: "DEBRIEF_CONTROL_DENIED",
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
      logStage310SessionControl("controlled_error", {
        sessionId,
        action,
        operation: "connection_lease",
        error: "staleConnection",
        participantType: participant.type,
        activeConnectionVersion: leaseState.version,
        connectionId: shortConnectionId(parsed.data.connectionId),
      });
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

  if (participant.type !== ParticipantType.FACILITATOR) {
    logStage310SessionControl("authorisation_result", {
      sessionId,
      action,
      authorised: false,
      reason: "not_facilitator",
      participantType: participant.type,
      connectionId: shortConnectionId(parsed.data.connectionId),
    });
    return NextResponse.json(
      { error: "Only facilitators can control negotiation state." },
      { status: 403 },
    );
  }

  const now = new Date();

  try {
    let session = await applyAutoTransitions(sessionId, now);

    if (isSessionClosedByOrganizer(session)) {
      logStage310SessionControl("lifecycle_decision", {
        sessionId,
        action,
        decision: "closed_by_organizer",
        participantType: participant.type,
        negotiationState: session.negotiationState,
      });
      return NextResponse.json(
        { error: "sessionClosedByEvent" },
        { status: 409 },
      );
    }

    if (shouldAutoFinish(session, now) && action !== "FINISH") {
      logStage310SessionControl("lifecycle_decision", {
        sessionId,
        action,
        decision: "auto_finished",
        participantType: participant.type,
        negotiationState: session.negotiationState,
      });
      return NextResponse.json(
        buildControlState(session, participant.type, now),
      );
    }

    if (
      isIdempotentNoopAction({
        action,
        negotiationState: session.negotiationState,
      })
    ) {
      if (action === "PAUSE") {
        await createPauseInterval(sessionId, now);
      } else if (action === "RESUME") {
        await closeLatestPauseInterval(sessionId, now);
      }
      const recording = await prisma.recording.findUnique({
        where: { sessionId },
        select: { status: true, errorMessage: true },
      });
      logStage310SessionControl("operation_result", {
        sessionId,
        action,
        result: "idempotent_noop",
        participantType: participant.type,
        negotiationState: session.negotiationState,
        recordingStatus: recording?.status ?? null,
      });
      return NextResponse.json({
        ...buildControlState(session, participant.type, now),
        recording: recording
          ? {
              status: recording.status,
              errorMessage: recording.errorMessage,
            }
          : null,
      });
    }

    let recordingWarning: string | undefined;

    // LiveKit egress start/stop — skip entirely for Voximplant provider.
    // For Voximplant, recording is orchestrated by the browser adapter:
    // after this /control response, the client calls /recording-control and
    // relays the typed scenarioMessage to the VoxEngine conference.
    const recordingProvider = (
      await prisma.recording.findUnique({
        where: { sessionId },
        select: { provider: true },
      })
    )?.provider;
    const isLiveKit =
      resolveEffectiveRecordingProvider(recordingProvider) === "livekit";

    if (isLiveKit && shouldRunLivekitRecordingLifecycle(action) && action === "START") {
      const recordingResult = await handleNegotiationStartRecording(sessionId);
      if (recordingResult && !recordingResult.ok) {
        recordingWarning = recordingResult.warning;
      }
    }

    if (action === "FINISH") {
      const finishResult = await completeSessionCanonical({
        sessionId,
        mode: "ROOM_FACILITATOR_FINISH",
      });
      logStage310SessionControl("lifecycle_decision", {
        sessionId,
        action,
        decision: "facilitator_finish",
        participantType: participant.type,
        negotiationState: finishResult.negotiationState,
        roomLifecycle: finishResult.roomLifecycle,
        closeReason: finishResult.closeReason,
        recordingStatus: finishResult.recording.status,
        stopOperationId: finishResult.recording.stopOperationId,
        stopOperationState: finishResult.recording.stopOperationState,
      });
      recordingWarning = finishResult.recording.warning ?? undefined;

      session = await prisma.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
        },
      });
    } else {
      const updateData = getControlUpdateData(session, action, now);
      session = await prisma.session.update({
        where: { id: sessionId },
        data: updateData,
        select: {
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
        },
      });
    }

    if (action === "PAUSE" || action === "RESUME") {
      await syncPauseIntervals(sessionId, action, now);
    }

    if (action === "PAUSE") {
      console.info(
        `[session-control] PAUSE applied without recording stop: sessionId=${sessionId} provider=${isLiveKit ? "livekit" : "voximplant"}`,
      );
    }

    session = await applyAutoTransitions(sessionId, now);

    const recording = await prisma.recording.findUnique({
      where: { sessionId },
      select: { status: true, errorMessage: true },
    });

    logStage310SessionControl("operation_result", {
      sessionId,
      action,
      result: "ok",
      participantType: participant.type,
      negotiationState: session.negotiationState,
      recordingStatus: recording?.status ?? null,
      recordingWarning: recordingWarning ?? null,
    });

    return NextResponse.json({
      ...buildControlState(session, participant.type, now),
      recordingWarning,
      recording: recording
        ? {
            status: recording.status,
            errorMessage: recording.errorMessage,
          }
        : null,
    });
  } catch (error) {
    logStage310SessionControl("controlled_error", {
      sessionId,
      action,
      operation: "control_update",
      error:
        error instanceof Error
          ? error.message
          : "Unable to update negotiation state.",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update negotiation state.",
      },
      { status: 400 },
    );
  }
}
