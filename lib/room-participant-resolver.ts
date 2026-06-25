/**
 * Shared server-side helper for resolving the SessionParticipant from a room API request.
 *
 * Supports two authentication modes:
 *
 *   1. joinToken (guest flow): finds participant by joinToken unique index.
 *   2. participantId + cookie (account flow): verifies that the authenticated user
 *      owns the SessionParticipant with the given id in the given session.
 *
 * Call this from any room API route that previously called
 * getSessionParticipantByJoinToken(joinToken, sessionId).
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
    return getSessionParticipantByJoinToken(joinToken, sessionId);
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
    return getSessionParticipantByJoinToken(joinToken, sessionId);
  }

  if (participantId) {
    return resolveByParticipantId(participantId, sessionId);
  }

  return null;
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
    return getSessionParticipantByJoinToken(parsed.joinToken, sessionId);
  }
  if (parsed.participantId) {
    return resolveByParticipantId(parsed.participantId, sessionId);
  }
  return null;
}
