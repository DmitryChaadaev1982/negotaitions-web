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

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

export type RoomParticipantResult = Awaited<
  ReturnType<typeof getSessionParticipantByJoinToken>
>;

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

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant) {
    return null;
  }

  // If already claimed by another user, deny access.
  if (participant.userId && participant.userId !== user.id) {
    return null;
  }

  return participant;
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

  const adminUser = isAdmin(user);

  // Look up the participant + associated session (same shape as getSessionParticipantByJoinToken)
  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId },
    include: {
      session: {
        select: {
          id: true,
          eventId: true,
          negotiationState: true,
          negotiationStartedAt: true,
          preparationDurationSeconds: true,
          durationSeconds: true,
          status: true,
          closedByEventAt: true,
          closeReason: true,
          event: {
            select: {
              id: true,
              status: true,
              hostUserId: true,
            },
          },
        },
      },
    },
  });

  if (!participant) {
    return null;
  }

  // Verify the participant belongs to the expected session
  if (participant.sessionId !== sessionId) {
    return null;
  }

  // Check ownership: userId match, admin bypass, or event host bypass
  const isOwner = participant.userId === user.id;
  const isEventHost =
    participant.session.event?.hostUserId === user.id;

  if (!isOwner && !adminUser && !isEventHost) {
    return null;
  }

  // Cast to the same return type as getSessionParticipantByJoinToken
  return participant as unknown as RoomParticipantResult;
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
