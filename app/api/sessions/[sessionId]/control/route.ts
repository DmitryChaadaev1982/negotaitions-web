import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  handleNegotiationFinishRecording,
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
  SESSION_CLOSE_SELECT,
} from "@/lib/session-close-state";
import {
  closeLatestPauseInterval,
  createPauseInterval,
} from "@/lib/session-pause-intervals";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";

const controlActionSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
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

  await closeLatestPauseInterval(sessionId, now);
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
    session = await prisma.session.update({
      where: { id: sessionId },
      data: getControlUpdateData(session, "FINISH", now),
      select: {
        ...SESSION_CONTROL_SELECT,
        ...SESSION_CLOSE_SELECT,
      },
    });

    await closeLatestPauseInterval(sessionId, now);
    await handleNegotiationFinishRecording(sessionId);
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

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can control negotiation state." },
      { status: 403 },
    );
  }

  const now = new Date();

  try {
    let session = await applyAutoTransitions(sessionId, now);

    if (buildSessionCloseState(session).isClosed) {
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

    const updateData = getControlUpdateData(session, action, now);

    session = await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
      select: {
        ...SESSION_CONTROL_SELECT,
        ...SESSION_CLOSE_SELECT,
      },
    });

    let recordingWarning: string | undefined;

    if (action === "START") {
      const recordingResult = await handleNegotiationStartRecording(sessionId);
      if (recordingResult && !recordingResult.ok) {
        recordingWarning = recordingResult.warning;
      }
    }

    if (action === "PAUSE" || action === "RESUME" || action === "FINISH") {
      await syncPauseIntervals(sessionId, action, now);
    }

    if (action === "FINISH") {
      const stopResult = await handleNegotiationFinishRecording(sessionId);
      recordingWarning = stopResult.warning;
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
