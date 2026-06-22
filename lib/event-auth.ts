import {
  TrainingEventStatus,
  type EventParticipant,
  type TrainingEvent,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type EventAccessContext = {
  event: TrainingEvent;
  isHost: boolean;
  currentParticipant: EventParticipant | null;
};

export type EventAccessTokens = {
  hostToken?: string | null;
  participantToken?: string | null;
};

export function isEventUnavailable(event: Pick<TrainingEvent, "status" | "deletedAt">) {
  return (
    event.deletedAt != null ||
    event.status === TrainingEventStatus.CANCELLED ||
    event.status === TrainingEventStatus.COMPLETED
  );
}

export async function resolveEventAccess(
  eventId: string,
  tokens: EventAccessTokens,
): Promise<EventAccessContext | null> {
  const hostToken = tokens.hostToken?.trim();
  const participantToken = tokens.participantToken?.trim();

  if (!hostToken && !participantToken) {
    return null;
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return null;
  }

  const isHost = Boolean(hostToken && hostToken === event.hostToken);

  if (!isHost && !participantToken) {
    return null;
  }

  let currentParticipant: EventParticipant | null = null;

  if (participantToken) {
    currentParticipant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        participantToken,
      },
    });

    if (!currentParticipant && !isHost) {
      return null;
    }
  }

  if (isHost && !currentParticipant) {
    currentParticipant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        isHost: true,
      },
    });
  }

  return { event, isHost, currentParticipant };
}

export async function findEventByPublicJoinCode(publicJoinCode: string) {
  return prisma.trainingEvent.findUnique({
    where: { publicJoinCode },
  });
}
