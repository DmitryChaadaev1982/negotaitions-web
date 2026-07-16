/**
 * Shared server-side helper for resolving the SessionParticipant from a room API request.
 *
 * Phase 6.4.1: guest access is fully closed. joinToken is now an invite-claim secret
 * only; it cannot be used as a runtime guest identity.
 *
 * Supports two authentication modes:
 *
 *   1. joinToken (invite-claim, authenticated): finds participant by joinToken, then
 *      verifies the caller is authenticated and owns (or may claim) the participant.
 *   2. participantId + cookie (account flow): verifies that the authenticated user
 *      owns the SessionParticipant with the given id in the given session.
 *
 * In both cases a valid httpOnly session cookie is required. Unauthenticated callers
 * receive null, which causes API routes to return 401/403.
 */

import { Prisma } from "@/app/generated/prisma/client";
import { ParticipantType } from "@/app/generated/prisma/enums";
import { getOptionalCurrentUser, type AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { generateJoinToken } from "@/lib/join-token";
import { prisma } from "@/lib/prisma";
import { resolveSessionParticipantType } from "@/lib/session-facilitator";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import {
  canCreateLateObserverParticipant,
  type LateObserverCreationDenyReason,
} from "@/lib/session-room-access";
import { sessionVisibilityWhere } from "@/lib/visibility";

export type RoomParticipantResult = NonNullable<
  Awaited<ReturnType<typeof getSessionParticipantByJoinToken>>
>;

export type EnsureAccountRoomParticipantDeniedCode =
  | "INACTIVE_USER"
  | "SESSION_NOT_FOUND"
  | "EVENT_MEMBERSHIP_REQUIRED"
  | "LATE_OBSERVER_CREATION_DENIED";

export type EnsureAccountRoomParticipantResult =
  | {
      kind: "participant";
      participant: RoomParticipantResult;
    }
  | {
      kind: "denied";
      code: EnsureAccountRoomParticipantDeniedCode;
      reason: LateObserverCreationDenyReason | null;
      redirectTo: string | null;
    };

const roomParticipantInclude = {
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
} satisfies Prisma.SessionParticipantInclude;

function isActiveAccountUser(user: AuthUser) {
  return isAdmin(user) || user.status === "ACTIVE";
}

function displayNameForUser(user: AuthUser) {
  return user.name?.trim() || user.email.split("@")[0] || "User";
}

function isSerializableConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function findParticipantForAccount(sessionId: string, userId: string) {
  return prisma.sessionParticipant.findFirst({
    where: { sessionId, userId },
    include: roomParticipantInclude,
    orderBy: { createdAt: "asc" },
  });
}

async function findEventParticipantIdForUser(params: {
  eventId: string;
  userId: string;
}) {
  const eventParticipant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: params.eventId,
      userId: params.userId,
    },
    select: { id: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return eventParticipant?.id ?? null;
}

async function resolveEffectiveTypeForSessionParticipant(params: {
  sessionId: string;
  sessionFacilitatorId: string | null;
  participantId: string;
  participantType: ParticipantType;
}) {
  if (params.participantType !== ParticipantType.FACILITATOR) {
    return params.participantType;
  }

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId: params.sessionId },
    select: {
      id: true,
      type: true,
      userId: true,
      createdAt: true,
    },
  });

  return resolveSessionParticipantType(
    { id: params.participantId, type: params.participantType },
    participants,
    params.sessionFacilitatorId,
  );
}

/**
 * Account room entry point: resolve the current user's own SessionParticipant.
 *
 * This must never fall back to the first/facilitator participant row. If the
 * account is authorized for the room but has no row yet, create a user-bound
 * participant so LiveKit, presence, and roster state all target the caller.
 */
export async function ensureAccountRoomParticipant(
  sessionId: string,
  user: AuthUser,
): Promise<EnsureAccountRoomParticipantResult> {
  if (!isActiveAccountUser(user)) {
    return {
      kind: "denied",
      code: "INACTIVE_USER",
      reason: null,
      redirectTo: null,
    };
  }

  const existing = await findParticipantForAccount(sessionId, user.id);
  if (existing) {
    if (!existing.eventParticipantId && existing.session.eventId) {
      const linkedEventParticipantId = await findEventParticipantIdForUser({
        eventId: existing.session.eventId,
        userId: user.id,
      });
      if (linkedEventParticipantId) {
        const linkedParticipant = await prisma.sessionParticipant.update({
          where: { id: existing.id },
          data: { eventParticipantId: linkedEventParticipantId },
          include: roomParticipantInclude,
        });
        return {
          kind: "participant",
          participant: linkedParticipant as unknown as RoomParticipantResult,
        };
      }
    }

    const effectiveType = await resolveEffectiveTypeForSessionParticipant({
      sessionId,
      sessionFacilitatorId: existing.session.facilitatorId ?? null,
      participantId: existing.id,
      participantType: existing.type,
    });

    if (
      existing.type === ParticipantType.FACILITATOR &&
      effectiveType !== existing.type
    ) {
      const updated = await prisma.sessionParticipant.update({
        where: { id: existing.id },
        data: { type: effectiveType },
        include: roomParticipantInclude,
      });
      return {
        kind: "participant",
        participant: updated as unknown as RoomParticipantResult,
      };
    }
    return {
      kind: "participant",
      participant: existing as unknown as RoomParticipantResult,
    };
  }

  const adminUser = isAdmin(user);
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      deletedAt: null,
      ...(adminUser
        ? {}
        : (sessionVisibilityWhere(user.id, user.email) as Prisma.SessionWhereInput)),
    },
    select: {
      id: true,
      eventId: true,
    },
  });

  if (!session) {
    return {
      kind: "denied",
      code: "SESSION_NOT_FOUND",
      reason: null,
      redirectTo: null,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const participantOrDenied = await prisma.$transaction(
        async (tx) => {
          const existingInTransaction = await tx.sessionParticipant.findFirst({
            where: { sessionId, userId: user.id },
            include: roomParticipantInclude,
            orderBy: { createdAt: "asc" },
          });

          if (existingInTransaction) {
            if (
              !existingInTransaction.eventParticipantId &&
              existingInTransaction.session.eventId
            ) {
              const linkedEventParticipant = await tx.eventParticipant.findFirst({
                where: {
                  eventId: existingInTransaction.session.eventId,
                  userId: user.id,
                },
                select: { id: true },
                orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              });
              if (linkedEventParticipant) {
                const linkedParticipant = await tx.sessionParticipant.update({
                  where: { id: existingInTransaction.id },
                  data: { eventParticipantId: linkedEventParticipant.id },
                  include: roomParticipantInclude,
                });
                return {
                  kind: "participant" as const,
                  participant: linkedParticipant as unknown as RoomParticipantResult,
                };
              }
            }
            return {
              kind: "participant" as const,
              participant: existingInTransaction as unknown as RoomParticipantResult,
            };
          }

          const sessionForCreation = await tx.session.findUnique({
            where: { id: sessionId },
            select: {
              id: true,
              eventId: true,
              facilitatorId: true,
              status: true,
              negotiationState: true,
              roomLifecycle: true,
              deletedAt: true,
              closeReason: true,
              closedByEventAt: true,
              event: {
                select: {
                  status: true,
                  hostUserId: true,
                  facilitatorUserId: true,
                },
              },
            },
          });

          if (!sessionForCreation) {
            return {
              kind: "denied" as const,
              code: "SESSION_NOT_FOUND" as const,
              reason: null,
              redirectTo: null,
            };
          }

          const linkedEventParticipant = sessionForCreation.eventId
            ? await tx.eventParticipant.findFirst({
                where: {
                  eventId: sessionForCreation.eventId,
                  userId: user.id,
                },
                select: { id: true },
                orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              })
            : null;

          const isEventOwner =
            sessionForCreation.facilitatorId === user.id ||
            sessionForCreation.event?.hostUserId === user.id ||
            sessionForCreation.event?.facilitatorUserId === user.id;
          const isAuthorizedEventMember = Boolean(
            adminUser || isEventOwner || linkedEventParticipant,
          );

          if (sessionForCreation.eventId && !isAuthorizedEventMember) {
            return {
              kind: "denied" as const,
              code: "EVENT_MEMBERSHIP_REQUIRED" as const,
              reason: null,
              redirectTo: null,
            };
          }

          const lateObserverDecision = canCreateLateObserverParticipant({
            event: {
              status: sessionForCreation.event?.status ?? null,
            },
            user: {
              isAuthenticated: true,
              isAuthorizedMember: sessionForCreation.eventId
                ? isAuthorizedEventMember
                : true,
            },
            session: {
              sessionId,
              eventId: sessionForCreation.eventId,
              status: sessionForCreation.status,
              negotiationState: sessionForCreation.negotiationState,
              roomLifecycle: sessionForCreation.roomLifecycle,
              deletedAt: sessionForCreation.deletedAt,
              closeReason: sessionForCreation.closeReason,
              closedByEventAt: sessionForCreation.closedByEventAt,
              eventStatus: sessionForCreation.event?.status ?? null,
            },
            existingSessionParticipant: false,
          });
          if (!lateObserverDecision.allowed) {
            return {
              kind: "denied" as const,
              code: "LATE_OBSERVER_CREATION_DENIED" as const,
              reason: lateObserverDecision.reason,
              redirectTo: lateObserverDecision.accessDecision?.redirectTo ?? null,
            };
          }

          const shouldEnterAsFacilitator =
            sessionForCreation.facilitatorId === user.id ||
            sessionForCreation.event?.hostUserId === user.id ||
            sessionForCreation.event?.facilitatorUserId === user.id;
          // Non-facilitators join as observers by default; facilitator can later promote
          // them to participant roles from the role management panel.
          const participantType = shouldEnterAsFacilitator ? "FACILITATOR" : "OBSERVER";
          const displayName = displayNameForUser(user);

          const createdParticipant = await tx.sessionParticipant.create({
            data: {
              sessionId,
              userId: user.id,
              eventParticipantId: linkedEventParticipant?.id ?? null,
              displayName,
              type: participantType,
              joinToken: generateJoinToken(),
              joinedAt: new Date(),
              lastSeenAt: new Date(),
            },
            include: roomParticipantInclude,
          });
          return {
            kind: "participant" as const,
            participant: createdParticipant as unknown as RoomParticipantResult,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return participantOrDenied;
    } catch (error) {
      if (isSerializableConflict(error) && attempt === 0) {
        continue;
      }
      throw error;
    }
  }

  const fallback = await findParticipantForAccount(
    sessionId,
    user.id,
  );
  if (!fallback) {
    return {
      kind: "denied",
      code: "SESSION_NOT_FOUND",
      reason: null,
      redirectTo: null,
    };
  }
  return {
    kind: "participant",
    participant: fallback as unknown as RoomParticipantResult,
  };
}

/**
 * Resolve a room participant from a JSON request body.
 *
 * Accepts either:
 *   { joinToken: string }   — guest flow
 *   { participantId: string } — account flow (requires valid session cookie)
 *
 * Returns null if authentication fails.
 */
export async function resolveRoomParticipantFromBody(
  body: Record<string, unknown>,
  sessionId: string,
): Promise<RoomParticipantResult | null> {
  const joinToken =
    typeof body.joinToken === "string" ? body.joinToken.trim() : null;
  const participantId =
    typeof body.participantId === "string" ? body.participantId.trim() : null;

  if (joinToken) {
    return resolveByJoinToken(joinToken, sessionId);
  }

  if (participantId) {
    return resolveByParticipantId(participantId, sessionId);
  }

  return null;
}

/**
 * Resolve a room participant from URL search params (for GET requests).
 *
 * Accepts either:
 *   ?joinToken=xxx   — guest flow
 *   ?participantId=xxx — account flow (requires valid session cookie)
 *
 * Returns null if authentication fails.
 */
export async function resolveRoomParticipantFromQuery(
  url: URL,
  sessionId: string,
): Promise<RoomParticipantResult | null> {
  const joinToken = url.searchParams.get("joinToken")?.trim() ?? null;
  const participantId = url.searchParams.get("participantId")?.trim() ?? null;

  if (joinToken) {
    return resolveByJoinToken(joinToken, sessionId);
  }

  if (participantId) {
    return resolveByParticipantId(participantId, sessionId);
  }

  return null;
}

/**
 * Phase 6.4.1 — joinToken invite-claim lookup (authentication required).
 *
 * joinToken is no longer a guest identity; it is an invite secret that binds to
 * an authenticated account. Requirements:
 *   - Caller must be authenticated (valid httpOnly session cookie).
 *   - If participant.userId is already set, it must match the current user's id.
 *   - If participant.userId is null (unclaimed), any authenticated ACTIVE user may use
 *     the token (the actual claim/bind happens in /join/[joinToken] or /room/[sessionId]).
 *
 * Returns null for unauthenticated callers; API routes then return 401/403.
 */
async function resolveByJoinToken(
  joinToken: string,
  sessionId: string,
): Promise<RoomParticipantResult | null> {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return null;
  }

  if (!isActiveAccountUser(user)) {
    return null;
  }

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant) {
    return null;
  }

  // If already claimed by another user, deny access.
  if (participant.userId && participant.userId !== user.id) {
    return null;
  }

  const effectiveType = await resolveEffectiveTypeForSessionParticipant({
    sessionId,
    sessionFacilitatorId: participant.session.facilitatorId ?? null,
    participantId: participant.id,
    participantType: participant.type,
  });

  return {
    ...participant,
    type: effectiveType,
  } as RoomParticipantResult;
}

/**
 * Account-mode lookup: verify cookie user owns the given participantId in this session.
 *
 * Security model:
 *   - participantId is a non-secret DB row UUID
 *   - Authentication comes from the httpOnly session cookie
 *   - We verify: user.id matches SessionParticipant.userId OR user is admin/host
 */
async function resolveByParticipantId(
  participantId: string,
  sessionId: string,
): Promise<RoomParticipantResult | null> {
  const user = await getOptionalCurrentUser();
  if (!user) {
    return null;
  }

  if (!isActiveAccountUser(user)) {
    return null;
  }

  // Look up the participant + associated session (same shape as getSessionParticipantByJoinToken)
  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId },
    include: roomParticipantInclude,
  });

  if (!participant) {
    return null;
  }

  // Verify the participant belongs to the expected session
  if (participant.sessionId !== sessionId) {
    return null;
  }

  // Check ownership: account APIs must target the caller's own participant row.
  const isOwner = participant.userId === user.id;
  if (!isOwner) {
    return null;
  }

  // Cast to the same return type as getSessionParticipantByJoinToken
  const effectiveType = await resolveEffectiveTypeForSessionParticipant({
    sessionId,
    sessionFacilitatorId: participant.session.facilitatorId ?? null,
    participantId: participant.id,
    participantType: participant.type,
  });

  return {
    ...participant,
    type: effectiveType,
  } as unknown as RoomParticipantResult;
}

/**
 * Helper: extract joinToken OR participantId from a Zod-parsed body.
 * Returns the resolved participant or null.
 */
export async function resolveRoomParticipantFromParsedBody(
  parsed: { joinToken?: string | null; participantId?: string | null },
  sessionId: string,
): Promise<RoomParticipantResult | null> {
  if (parsed.joinToken) {
    return resolveByJoinToken(parsed.joinToken, sessionId);
  }
  if (parsed.participantId) {
    return resolveByParticipantId(parsed.participantId, sessionId);
  }
  return null;
}
