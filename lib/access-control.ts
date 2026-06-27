import type {
  EventParticipant,
  ParticipantType,
  SessionParticipant,
  TrainingEvent,
} from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { normalizeUserEmail } from "@/lib/invite-email";
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
  /** true for any user with host-level API capabilities (admin, hostOwner, facilitatorOwner, hostToken) */
  isHost: boolean;
  /**
   * true only when this user is the *designated* host/facilitator of this
   * specific event (isHostOwner || isFacilitatorOwner || isHostToken).
   * Unlike isHost, this is false for system admins who are not the event owner.
   * Use this to gate host-controls UI — so a system admin joining another
   * user's event lobby sees participant controls, not the host panel.
   */
  isEventOwner: boolean;
  currentParticipant: EventParticipant | null;
  hasUserParticipant: boolean;
  hasTokenParticipant: boolean;
  /** true when the user has an EventInvite by userId or by normalized email */
  hasEmailInvite: boolean;
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
  /** true when the user has a SessionInvite by userId or by normalized email */
  hasEmailInvite: boolean;
};

export function canAccessEvent(access: CurrentUserEventAccess) {
  return (
    access.isAdmin ||
    access.isHostOwner ||
    access.isFacilitatorOwner ||
    access.hasUserParticipant ||
    access.hasTokenParticipant ||
    access.isHostToken ||
    access.hasEmailInvite
  );
}

export function canEditEvent(access: CurrentUserEventAccess) {
  return access.isAdmin || access.isHostOwner || access.isFacilitatorOwner;
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
    access.tokenParticipant !== null ||
    access.hasEmailInvite
  );
}

export function canEditSession(access: CurrentUserSessionAccess) {
  return (
    access.isAdmin ||
    access.isSessionFacilitatorOwner ||
    access.isEventHostOwner ||
    access.isEventFacilitatorOwner
  );
}

/**
 * For Sessions, facilitatorId is the owner by product decision.
 * Changing facilitatorId changes the Session owner.
 * Private Sessions require facilitatorId (enforced in createSession/updateSession).
 *
 * Canonical ownership model:
 *   NegotiationCase owner = createdByUserId
 *   TrainingEvent/Event owner = hostUserId
 *   Session owner = facilitatorId  ← this file
 */
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

  const normalizedEmail = user?.email ? normalizeUserEmail(user.email) : null;

  const [tokenParticipant, userParticipant, emailInvite] = await Promise.all([
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
    user
      ? prisma.eventInvite.findFirst({
          where: {
            eventId,
            OR: [
              { userId: user.id },
              ...(normalizedEmail ? [{ invitedEmailNormalized: normalizedEmail }] : []),
            ],
          },
          select: { id: true },
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
  // Authenticated lobby identity must be resolved by eventId + currentUser.id.
  // Never fall back to host/first participant for authenticated users.
  // Token-only (non-user) host access may still fall back to the isHost participant.
  if (!currentParticipant && !user && isHostToken) {
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
    isEventOwner: isHostOwner || isFacilitatorOwner || isHostToken,
    currentParticipant,
    hasUserParticipant: userParticipant !== null,
    hasTokenParticipant: tokenParticipant !== null,
    hasEmailInvite: emailInvite !== null,
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

  const normalizedEmail = user?.email ? normalizeUserEmail(user.email) : null;

  const [tokenParticipant, userParticipant, emailInvite] = await Promise.all([
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
    user
      ? prisma.sessionInvite.findFirst({
          where: {
            sessionId,
            OR: [
              { userId: user.id },
              ...(normalizedEmail ? [{ invitedEmailNormalized: normalizedEmail }] : []),
            ],
          },
          select: { id: true },
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
    hasEmailInvite: emailInvite !== null,
  };
}

export function isFacilitatorParticipantType(
  participantType: ParticipantType | null | undefined,
) {
  return participantType === "FACILITATOR";
}
