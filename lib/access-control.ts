import type {
  EventParticipant,
  ParticipantType,
  SessionParticipant,
  TrainingEvent,
} from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

export type EventTokenContext = {
  hostToken?: string | null;
  participantToken?: string | null;
};

export type SessionTokenContext = {
  joinToken?: string | null;
};

export type CurrentUserEventAccess = {
  event: TrainingEvent;
  user: AuthUser | null;
  isAdmin: boolean;
  isHostOwner: boolean;
  isFacilitatorOwner: boolean;
  isHostToken: boolean;
  isHost: boolean;
  currentParticipant: EventParticipant | null;
  hasUserParticipant: boolean;
  hasTokenParticipant: boolean;
};

export type CurrentUserSessionAccess = {
  session: {
    id: string;
    eventId: string | null;
    facilitatorId: string;
    deletedAt: Date | null;
    event: {
      id: string;
      hostUserId: string | null;
      facilitatorUserId: string | null;
    } | null;
  };
  user: AuthUser | null;
  isAdmin: boolean;
  isEventHostOwner: boolean;
  isEventFacilitatorOwner: boolean;
  isSessionFacilitatorOwner: boolean;
  tokenParticipant: SessionParticipant | null;
  userParticipant: SessionParticipant | null;
};

export function canAccessEvent(access: CurrentUserEventAccess) {
  return (
    access.isAdmin ||
    access.isHostOwner ||
    access.isFacilitatorOwner ||
    access.hasUserParticipant ||
    access.hasTokenParticipant ||
    access.isHostToken
  );
}

export function canManageEvent(access: CurrentUserEventAccess) {
  return (
    access.isAdmin ||
    access.isHostOwner ||
    access.isFacilitatorOwner ||
    access.isHostToken
  );
}

export function canAccessSession(access: CurrentUserSessionAccess) {
  return (
    access.isAdmin ||
    access.isEventHostOwner ||
    access.isEventFacilitatorOwner ||
    access.isSessionFacilitatorOwner ||
    access.userParticipant !== null ||
    access.tokenParticipant !== null
  );
}

export function canManageSession(access: CurrentUserSessionAccess) {
  return (
    access.isAdmin ||
    access.isEventHostOwner ||
    access.isEventFacilitatorOwner ||
    access.isSessionFacilitatorOwner ||
    (access.userParticipant?.type === "FACILITATOR") ||
    (access.tokenParticipant?.type === "FACILITATOR")
  );
}

export function canAccessSessionMaterials(access: CurrentUserSessionAccess) {
  return canAccessSession(access);
}

export function canRunTranscription(access: CurrentUserSessionAccess) {
  return canManageSession(access);
}

export function canRunAiAnalysis(access: CurrentUserSessionAccess) {
  return canManageSession(access);
}

export function canEditSpeakerMapping(access: CurrentUserSessionAccess) {
  return canManageSession(access);
}

export async function getCurrentUserEventAccess(
  eventId: string,
  user: AuthUser | null,
  tokens: EventTokenContext = {},
): Promise<CurrentUserEventAccess | null> {
  const hostToken = tokens.hostToken?.trim() || null;
  const participantToken = tokens.participantToken?.trim() || null;

  if (!hostToken && !participantToken && !user) {
    return null;
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return null;
  }

  const admin = user ? isAdmin(user) : false;
  const isHostOwner = Boolean(user && event.hostUserId === user.id);
  const isFacilitatorOwner = Boolean(user && event.facilitatorUserId === user.id);
  const isHostToken = Boolean(hostToken && hostToken === event.hostToken);

  const [tokenParticipant, userParticipant] = await Promise.all([
    participantToken
      ? prisma.eventParticipant.findFirst({
          where: {
            eventId,
            participantToken,
          },
        })
      : Promise.resolve(null),
    user
      ? prisma.eventParticipant.findFirst({
          where: {
            eventId,
            userId: user.id,
          },
        })
      : Promise.resolve(null),
  ]);

  if (
    tokenParticipant &&
    tokenParticipant.userId &&
    user &&
    tokenParticipant.userId !== user.id &&
    !admin
  ) {
    return null;
  }

  let currentParticipant = tokenParticipant ?? userParticipant ?? null;
  if (!currentParticipant && (isHostToken || isHostOwner || isFacilitatorOwner || admin)) {
    currentParticipant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        isHost: true,
      },
    });
  }

  return {
    event,
    user,
    isAdmin: admin,
    isHostOwner,
    isFacilitatorOwner,
    isHostToken,
    isHost: admin || isHostOwner || isFacilitatorOwner || isHostToken,
    currentParticipant,
    hasUserParticipant: userParticipant !== null,
    hasTokenParticipant: tokenParticipant !== null,
  };
}

export async function getCurrentUserSessionAccess(
  sessionId: string,
  user: AuthUser | null,
  tokens: SessionTokenContext = {},
): Promise<CurrentUserSessionAccess | null> {
  const joinToken = tokens.joinToken?.trim() || null;

  if (!joinToken && !user) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      eventId: true,
      facilitatorId: true,
      deletedAt: true,
      event: {
        select: {
          id: true,
          hostUserId: true,
          facilitatorUserId: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const [tokenParticipant, userParticipant] = await Promise.all([
    joinToken
      ? prisma.sessionParticipant.findUnique({
          where: { joinToken },
        })
      : Promise.resolve(null),
    user
      ? prisma.sessionParticipant.findFirst({
          where: {
            sessionId,
            userId: user.id,
          },
        })
      : Promise.resolve(null),
  ]);

  if (tokenParticipant && tokenParticipant.sessionId !== sessionId) {
    return null;
  }

  const admin = user ? isAdmin(user) : false;
  const isEventHostOwner = Boolean(user && session.event?.hostUserId === user.id);
  const isEventFacilitatorOwner = Boolean(
    user && session.event?.facilitatorUserId === user.id,
  );
  const isSessionFacilitatorOwner = Boolean(
    user && session.facilitatorId === user.id,
  );

  return {
    session,
    user,
    isAdmin: admin,
    isEventHostOwner,
    isEventFacilitatorOwner,
    isSessionFacilitatorOwner,
    tokenParticipant,
    userParticipant,
  };
}

export function isFacilitatorParticipantType(
  participantType: ParticipantType | null | undefined,
) {
  return participantType === "FACILITATOR";
}
