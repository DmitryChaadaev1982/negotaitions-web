import { prisma } from "@/lib/prisma";

type EventPresenceTokens = {
  hostToken?: string;
  participantToken?: string;
};

export async function updateEventParticipantPresence(participantToken: string) {
  return updateEventLobbyPresence(undefined, { participantToken });
}

export async function updateEventLobbyPresence(
  expectedEventId: string | undefined,
  tokens: EventPresenceTokens,
) {
  const now = new Date();
  const participantToken = tokens.participantToken?.trim();
  const hostToken = tokens.hostToken?.trim();

  let participant: {
    id: string;
    eventId: string;
    joinedAt: Date | null;
  } | null = null;

  if (participantToken) {
    participant = await prisma.eventParticipant.findUnique({
      where: { participantToken },
      select: { id: true, eventId: true, joinedAt: true },
    });
  } else if (hostToken) {
    const event = await prisma.trainingEvent.findUnique({
      where: { hostToken },
      select: { id: true },
    });

    if (!event) {
      return null;
    }

    participant = await prisma.eventParticipant.findFirst({
      where: {
        eventId: event.id,
        isHost: true,
      },
      select: { id: true, eventId: true, joinedAt: true },
    });
  }

  if (!participant) {
    return null;
  }

  if (expectedEventId && participant.eventId !== expectedEventId) {
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
