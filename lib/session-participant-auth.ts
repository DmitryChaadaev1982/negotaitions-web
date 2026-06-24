import type { ParticipantType } from "@/app/generated/prisma/client";
import { SESSION_CONTROL_SELECT } from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import { SESSION_CLOSE_SELECT } from "@/lib/session-close-state";

export async function getSessionParticipantByJoinToken(
  joinToken: string,
  sessionId?: string,
) {
  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    include: {
      session: {
        select: {
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
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
