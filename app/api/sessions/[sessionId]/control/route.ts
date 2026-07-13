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
  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
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

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can control negotiation state." },
      { status: 403 },
    );
  }

  const now = new Date();

  try {
    let session = await applyAutoTransitions(sessionId, now);

    if (isSessionClosedByOrganizer(session)) {
      return NextResponse.json(
        { error: "sessionClosedByEvent" },
        { status: 409 },
      );
    }

    if (shouldAutoFinish(session, now) && action !== "FINISH") {
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
