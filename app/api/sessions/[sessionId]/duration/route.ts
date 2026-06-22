import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { canEditSessionDurations } from "@/lib/negotiation-control";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MAX_PREPARATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  MIN_PREPARATION_DURATION_MINUTES,
  minutesToSeconds,
} from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

const durationSchema = z
  .object({
    joinToken: z.string().trim().min(1, "Join token is required"),
    durationMinutes: z.coerce
      .number()
      .int("Duration must be a whole number of minutes")
      .min(
        MIN_NEGOTIATION_DURATION_MINUTES,
        `Duration must be at least ${MIN_NEGOTIATION_DURATION_MINUTES} minute`,
      )
      .max(
        MAX_NEGOTIATION_DURATION_MINUTES,
        `Duration must be at most ${MAX_NEGOTIATION_DURATION_MINUTES} minutes`,
      )
      .optional(),
    preparationDurationMinutes: z.coerce
      .number()
      .int("Preparation duration must be a whole number of minutes")
      .min(
        MIN_PREPARATION_DURATION_MINUTES,
        `Preparation duration must be at least ${MIN_PREPARATION_DURATION_MINUTES} minutes`,
      )
      .max(
        MAX_PREPARATION_DURATION_MINUTES,
        `Preparation duration must be at most ${MAX_PREPARATION_DURATION_MINUTES} minutes`,
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.durationMinutes !== undefined ||
      data.preparationDurationMinutes !== undefined,
    { message: "At least one duration field is required." },
  );

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = durationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { joinToken, durationMinutes, preparationDurationMinutes } = parsed.data;
  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can update session durations." },
      { status: 403 },
    );
  }

  if (!canEditSessionDurations(participant.session.negotiationState)) {
    return NextResponse.json(
      { error: "Durations can only be updated before negotiation starts." },
      { status: 400 },
    );
  }

  const session = await prisma.session.update({
    where: { id: sessionId },
    data: {
      ...(durationMinutes !== undefined
        ? { durationSeconds: minutesToSeconds(durationMinutes) }
        : {}),
      ...(preparationDurationMinutes !== undefined
        ? {
            preparationDurationSeconds: minutesToSeconds(
              preparationDurationMinutes,
            ),
          }
        : {}),
    },
    select: {
      id: true,
      durationSeconds: true,
      preparationDurationSeconds: true,
      negotiationState: true,
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    durationSeconds: session.durationSeconds,
    preparationDurationSeconds: session.preparationDurationSeconds,
    durationMinutes:
      durationMinutes ?? Math.round(session.durationSeconds / 60),
    preparationDurationMinutes:
      preparationDurationMinutes ??
      Math.round(session.preparationDurationSeconds / 60),
    negotiationState: session.negotiationState,
  });
}
