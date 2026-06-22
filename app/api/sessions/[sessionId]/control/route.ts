import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  handleNegotiationFinishRecording,
  handleNegotiationStartRecording,
} from "@/lib/livekit-egress";
import {
  buildControlState,
  getControlUpdateData,
  shouldAutoFinish,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  closeLatestPauseInterval,
  createPauseInterval,
} from "@/lib/session-pause-intervals";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

const controlActionSchema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  action: z.enum(["START", "PAUSE", "RESUME", "FINISH"]),
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

  const { joinToken, action } = parsed.data;
  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);

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
    let session = participant.session;

    if (shouldAutoFinish(session, now) && action !== "FINISH") {
      const autoFinishData = getControlUpdateData(session, "FINISH", now);
      session = await prisma.session.update({
        where: { id: sessionId },
        data: autoFinishData,
        select: {
          id: true,
          negotiationState: true,
          durationSeconds: true,
          negotiationStartedAt: true,
          negotiationEndedAt: true,
          timerStartedAt: true,
          pausedAt: true,
          totalPausedSeconds: true,
        },
      });

      await closeLatestPauseInterval(sessionId, now);
      await handleNegotiationFinishRecording(sessionId);

      return NextResponse.json(buildControlState(session, participant.type, now));
    }

    const updateData = getControlUpdateData(session, action, now);

    session = await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
      select: {
        id: true,
        status: true,
        negotiationState: true,
        durationSeconds: true,
        negotiationStartedAt: true,
        negotiationEndedAt: true,
        timerStartedAt: true,
        pausedAt: true,
        totalPausedSeconds: true,
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
