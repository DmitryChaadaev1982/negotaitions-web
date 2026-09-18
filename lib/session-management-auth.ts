import { NextResponse } from "next/server";

import type { ParticipantType } from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { getOptionalCurrentUser } from "@/lib/auth";
import {
  canAccessSession,
  canManageSession,
  getCurrentUserSessionAccess,
  type CurrentUserSessionAccess,
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import {
  resolveRoomParticipantFromParsedBody,
  type RoomParticipantResult,
} from "@/lib/room-participant-resolver";

export type SessionAuthTokens = {
  joinToken?: string | null;
  participantId?: string | null;
};

export type SessionManagementDecision = {
  allowed: boolean;
  status: 200 | 401 | 403;
  reason: "ok" | "unauthorized" | "forbidden";
};

export type SessionMaterialsProjection = {
  canManage: boolean;
  isManagerProjection: boolean;
  viewerType: ParticipantType | null;
};

function hasAuthToken(tokens: SessionAuthTokens) {
  return Boolean(tokens.joinToken?.trim() || tokens.participantId?.trim());
}

export function sessionAuthTokensFrom(
  source:
    | URL
    | URLSearchParams
    | {
        joinToken?: string | null;
        participantId?: string | null;
      },
): SessionAuthTokens {
  if (source instanceof URL) {
    return {
      joinToken: source.searchParams.get("joinToken"),
      participantId: source.searchParams.get("participantId"),
    };
  }
  if (source instanceof URLSearchParams) {
    return {
      joinToken: source.get("joinToken"),
      participantId: source.get("participantId"),
    };
  }
  return {
    joinToken: source.joinToken,
    participantId: source.participantId,
  };
}

/**
 * Pure management decision used by API guards and AUTH tests.
 *
 * Canonical rule: ADMIN, Session facilitator, Event host, or Event
 * facilitator may manage. A resolved FACILITATOR participant is the
 * token/account equivalent of the Session-facilitator rule. Owner/creator
 * of a Case, ordinary participant, or observer is not enough.
 */
export function decideSessionManagementAuthorization(input: {
  hasAuthenticatedUser: boolean;
  hasJoinToken: boolean;
  access: CurrentUserSessionAccess | null;
  resolvedParticipantType: ParticipantType | null;
}): SessionManagementDecision {
  if (input.access && canManageSession(input.access)) {
    return { allowed: true, status: 200, reason: "ok" };
  }
  if (input.resolvedParticipantType === "FACILITATOR") {
    return { allowed: true, status: 200, reason: "ok" };
  }
  if (!input.hasAuthenticatedUser && !input.hasJoinToken) {
    return { allowed: false, status: 401, reason: "unauthorized" };
  }
  return { allowed: false, status: 403, reason: "forbidden" };
}

/**
 * After shared authorization succeeds, participant membership may enrich
 * the payload. It is not a second gate for an authorized manager.
 */
export function decideAuthorizedMaterialsContinuation(input: {
  canManage: boolean;
  participantPresent: boolean;
}): SessionManagementDecision {
  if (input.canManage || input.participantPresent) {
    return { allowed: true, status: 200, reason: "ok" };
  }
  return { allowed: false, status: 403, reason: "forbidden" };
}

export function resolveSessionManagerActorId(input: {
  participantId?: string | null;
  userId?: string | null;
  fallbackDisplayName?: string | null;
}): string {
  return (
    input.participantId?.trim() ||
    input.userId?.trim() ||
    input.fallbackDisplayName?.trim() ||
    "Admin"
  );
}

export function decideSessionMaterialsProjection(input: {
  canManage: boolean;
  participantType: ParticipantType | null;
}): SessionMaterialsProjection {
  const isManagerProjection =
    input.canManage || input.participantType === "FACILITATOR";
  return {
    canManage: input.canManage,
    isManagerProjection,
    viewerType: isManagerProjection
      ? "FACILITATOR"
      : input.participantType,
  };
}

/**
 * List/UI `canManage` must match `canManageSession`.
 * Session owner is `facilitatorId`; Case owner is not management authority.
 */
export function computeSessionListCanManage(input: {
  isAdmin: boolean;
  userId: string | null;
  facilitatorId: string | null;
  eventHostUserId: string | null;
  eventFacilitatorUserId: string | null;
  participantType: string | null;
}): boolean {
  if (!input.userId) {
    return false;
  }
  if (input.isAdmin) {
    return true;
  }
  if (input.facilitatorId && input.facilitatorId === input.userId) {
    return true;
  }
  if (input.eventHostUserId && input.eventHostUserId === input.userId) {
    return true;
  }
  if (
    input.eventFacilitatorUserId &&
    input.eventFacilitatorUserId === input.userId
  ) {
    return true;
  }
  return input.participantType === "FACILITATOR";
}

export function actorDisplayNameForSessionManager(input: {
  user: AuthUser | null;
  participantDisplayName?: string | null;
}) {
  return (
    input.user?.name?.trim() ||
    input.user?.email?.trim() ||
    input.participantDisplayName?.trim() ||
    "Admin"
  );
}

function managementErrorResponse(decision: SessionManagementDecision) {
  return NextResponse.json(
    { error: decision.reason === "unauthorized" ? "Unauthorized." : "Forbidden." },
    { status: decision.status },
  );
}

async function resolveOptionalParticipant(
  sessionId: string,
  tokens: SessionAuthTokens,
): Promise<RoomParticipantResult | null> {
  if (!hasAuthToken(tokens)) {
    return null;
  }
  return resolveRoomParticipantFromParsedBody(
    {
      joinToken: tokens.joinToken?.trim() || undefined,
      participantId: tokens.participantId?.trim() || undefined,
    },
    sessionId,
  );
}

async function resolveOwnParticipant(
  sessionId: string,
  userId: string,
): Promise<RoomParticipantResult | null> {
  const participant = await prisma.sessionParticipant.findFirst({
    where: { sessionId, userId },
    include: {
      session: {
        select: {
          id: true,
          deletedAt: true,
          facilitatorId: true,
          eventId: true,
          negotiationState: true,
          roomLifecycle: true,
          negotiationStartedAt: true,
          negotiationEndedAt: true,
          preparationDurationSeconds: true,
          durationSeconds: true,
          timerStartedAt: true,
          pausedAt: true,
          totalPausedSeconds: true,
          preparationStartedAt: true,
          preparationEndedAt: true,
          preparationTimerStartedAt: true,
          preparationPausedAt: true,
          preparationTotalPausedSeconds: true,
          status: true,
          closedByEventAt: true,
          closeReason: true,
          event: {
            select: {
              id: true,
              status: true,
              hostUserId: true,
              facilitatorUserId: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return participant as unknown as RoomParticipantResult | null;
}

export async function loadFacilitatorParticipantForManagerView(
  sessionId: string,
): Promise<RoomParticipantResult | null> {
  const participant = await prisma.sessionParticipant.findFirst({
    where: { sessionId, type: "FACILITATOR" },
    include: {
      session: {
        select: {
          id: true,
          deletedAt: true,
          facilitatorId: true,
          eventId: true,
          negotiationState: true,
          roomLifecycle: true,
          negotiationStartedAt: true,
          negotiationEndedAt: true,
          preparationDurationSeconds: true,
          durationSeconds: true,
          timerStartedAt: true,
          pausedAt: true,
          totalPausedSeconds: true,
          preparationStartedAt: true,
          preparationEndedAt: true,
          preparationTimerStartedAt: true,
          preparationPausedAt: true,
          preparationTotalPausedSeconds: true,
          status: true,
          closedByEventAt: true,
          closeReason: true,
          event: {
            select: {
              id: true,
              status: true,
              hostUserId: true,
              facilitatorUserId: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return participant as unknown as RoomParticipantResult | null;
}

export type AuthorizedSessionManagement = {
  ok: true;
  user: AuthUser | null;
  access: CurrentUserSessionAccess | null;
  participant: RoomParticipantResult | null;
  canManage: true;
  actorDisplayName: string;
};

export type DeniedSessionManagement = {
  ok: false;
  response: NextResponse;
};

export async function authorizeSessionManagementAccess(
  sessionId: string,
  tokens: SessionAuthTokens = {},
): Promise<AuthorizedSessionManagement | DeniedSessionManagement> {
  const user = await getOptionalCurrentUser();
  const access = await getCurrentUserSessionAccess(sessionId, user, {
    joinToken: tokens.joinToken ?? null,
  });
  const participant = await resolveOptionalParticipant(sessionId, tokens);
  const decision = decideSessionManagementAuthorization({
    hasAuthenticatedUser: Boolean(user),
    hasJoinToken: Boolean(tokens.joinToken?.trim()),
    access,
    resolvedParticipantType: participant?.type ?? null,
  });
  if (!decision.allowed) {
    return { ok: false, response: managementErrorResponse(decision) };
  }
  return {
    ok: true,
    user,
    access,
    participant,
    canManage: true,
    actorDisplayName: actorDisplayNameForSessionManager({
      user,
      participantDisplayName: participant?.displayName,
    }),
  };
}

export type AuthorizedSessionMaterialsAccess = {
  ok: true;
  user: AuthUser | null;
  access: CurrentUserSessionAccess | null;
  participant: RoomParticipantResult | null;
  canManage: boolean;
  canAccess: boolean;
  projection: SessionMaterialsProjection;
};

export async function authorizeSessionMaterialsAccess(
  sessionId: string,
  tokens: SessionAuthTokens = {},
): Promise<AuthorizedSessionMaterialsAccess | DeniedSessionManagement> {
  const user = await getOptionalCurrentUser();
  const access = await getCurrentUserSessionAccess(sessionId, user, {
    joinToken: tokens.joinToken ?? null,
  });
  let participant = await resolveOptionalParticipant(sessionId, tokens);
  if (!participant && user) {
    participant = await resolveOwnParticipant(sessionId, user.id);
  }

  const canManage = Boolean(access && canManageSession(access));
  const canAccess = Boolean(
    (access && canAccessSession(access)) || participant,
  );
  if (!canAccess && !canManage) {
    const decision = decideSessionManagementAuthorization({
      hasAuthenticatedUser: Boolean(user),
      hasJoinToken: Boolean(tokens.joinToken?.trim()),
      access,
      resolvedParticipantType: participant?.type ?? null,
    });
    return { ok: false, response: managementErrorResponse(decision) };
  }

  return {
    ok: true,
    user,
    access,
    participant,
    canManage,
    canAccess: canAccess || canManage,
    projection: decideSessionMaterialsProjection({
      canManage,
      participantType: participant?.type ?? null,
    }),
  };
}
