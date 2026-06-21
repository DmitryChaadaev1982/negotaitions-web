import { prisma } from "@/lib/prisma";

export async function updateParticipantPresence(joinToken: string) {
  const now = new Date();

  const participant = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    select: { id: true, sessionId: true, joinedAt: true },
  });

  if (!participant) {
    return null;
  }

  await prisma.sessionParticipant.update({
    where: { id: participant.id },
    data: {
      lastSeenAt: now,
      ...(participant.joinedAt ? {} : { joinedAt: now }),
    },
  });

  return participant.sessionId;
}
