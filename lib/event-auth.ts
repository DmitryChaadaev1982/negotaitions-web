import {
  TrainingEventStatus,
  type EventParticipant,
  type TrainingEvent,
} from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import {
  canAccessEvent,
  getCurrentUserEventAccess,
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export type EventAccessContext = {
  event: TrainingEvent;
  isHost: boolean;
  isAdmin: boolean;
  currentParticipant: EventParticipant | null;
};

export type EventAccessTokens = {
  hostToken?: string | null;
  participantToken?: string | null;
};

export function isEventDeletedOrCancelled(
  event: Pick<TrainingEvent, "status" | "deletedAt">,
) {
  return (
    event.deletedAt != null || event.status === TrainingEventStatus.CANCELLED
  );
}

export function isEventUnavailable(event: Pick<TrainingEvent, "status" | "deletedAt">) {
  return (
    isEventDeletedOrCancelled(event) ||
    event.status === TrainingEventStatus.COMPLETED
  );
}

export function isEventCompleted(event: Pick<TrainingEvent, "status">) {
  return event.status === TrainingEventStatus.COMPLETED;
}

export async function resolveEventAccess(
  eventId: string,
  tokens: EventAccessTokens,
  user?: AuthUser | null,
): Promise<EventAccessContext | null> {
  const access = await getCurrentUserEventAccess(eventId, user ?? null, tokens);
  if (!access || !canAccessEvent(access)) {
    return null;
  }

  return {
    event: access.event,
    isHost: access.isHost,
    isAdmin: access.isAdmin,
    currentParticipant: access.currentParticipant,
  };
}

export async function findEventByPublicJoinCode(publicJoinCode: string) {
  return prisma.trainingEvent.findUnique({
    where: { publicJoinCode },
  });
}
