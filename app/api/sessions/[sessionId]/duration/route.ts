import { NextResponse } from "next/server";
import { z } from "zod";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/client";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  minutesToSeconds,
} from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

const durationSchema = z.object({
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
    ),
});

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

  const { joinToken, durationMinutes } = parsed.data;
  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can update negotiation duration." },
      { status: 403 },
    );
  }

  if (participant.session.negotiationState !== NegotiationState.LOBBY) {
    return NextResponse.json(
      { error: "Duration can only be updated while in lobby." },
      { status: 400 },
    );
  }

  const session = await prisma.session.update({
    where: { id: sessionId },
    data: {
      durationSeconds: minutesToSeconds(durationMinutes),
    },
    select: {
      id: true,
      durationSeconds: true,
      negotiationState: true,
    },
  });

  return NextResponse.json({
    sessionId: session.id,
    durationSeconds: session.durationSeconds,
    durationMinutes,
    negotiationState: session.negotiationState,
  });
}
