import type { ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function getSessionParticipantByJoinToken(
  joinToken: string,
  sessionId?: string,
) {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: {
      session: {
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
      },
    },
  });

  if (!participant) {
    return null;
  }

  if (sessionId && participant.sessionId !== sessionId) {
    return null;
  }

  return participant;
}

export type AuthenticatedSessionParticipant = NonNullable<
  Awaited<ReturnType<typeof getSessionParticipantByJoinToken>>
>;

export function isFacilitatorParticipant(
  participant: Pick<AuthenticatedSessionParticipant, "type">,
) {
  return participant.type === ("FACILITATOR" satisfies ParticipantType);
}
