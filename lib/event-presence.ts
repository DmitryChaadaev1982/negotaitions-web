import { prisma } from "@/lib/prisma";

export async function updateEventParticipantPresence(participantToken: string) {
  const now = new Date();

  const participant = await prisma.eventParticipant.findUnique({
    where: { participantToken },
    select: { id: true, eventId: true, joinedAt: true },
  });

  if (!participant) {
    return null;
  }

  await prisma.eventParticipant.update({
    where: { id: participant.id },
    data: {
      lastSeenAt: now,
      ...(participant.joinedAt ? {} : { joinedAt: now }),
    },
  });

  return participant.eventId;
}

export async function leaveEventLobby(participantToken: string) {
  const participant = await prisma.eventParticipant.findUnique({
    where: { participantToken },
    select: { id: true, eventId: true },
  });

  if (!participant) {
    return null;
  }

  await prisma.eventParticipant.update({
    where: { id: participant.id },
    data: { lastSeenAt: null },
  });

  return participant.eventId;
}
