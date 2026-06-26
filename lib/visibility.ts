/**
 * Central visibility helpers for events and sessions.
 *
 * Rules (Part 4):
 *
 * Event visible to user if ANY is true:
 *   1. user is host/creator (hostUserId)
 *   2. user is selected facilitator (facilitatorUserId)
 *   3. user is EventParticipant
 *   4. user is SessionParticipant in any event session
 *   5. user has EventInvite for event
 *   6. event.visibility === PUBLIC and event is open/joinable
 *   7. user is admin
 *
 * Public completed/closed events: visible only to participants/facilitator/host/admin.
 *
 * Session visible to user if ANY is true:
 *   1. user is SessionParticipant
 *   2. user is event host/facilitator (hostUserId or facilitatorUserId)
 *   3. session belongs to PUBLIC event and is open/joinable
 *   4. standalone session.visibility === PUBLIC and is open/joinable
 *   5. user has SessionInvite
 *   6. user is session facilitator (facilitatorId)
 *   7. user is admin
 */

import { TrainingEventStatus } from "@/app/generated/prisma/client";

/** Event statuses that are considered "open / joinable" */
const OPEN_EVENT_STATUSES: TrainingEventStatus[] = [
  TrainingEventStatus.LOBBY_OPEN,
  TrainingEventStatus.SESSION_CREATED,
];

export function isEventOpenAndJoinable(status: TrainingEventStatus): boolean {
  return OPEN_EVENT_STATUSES.includes(status);
}

/**
 * Prisma WHERE clause fragment for events visible to a given authenticated user.
 * Pass `null` for admin / unscoped queries.
 */
export function eventVisibilityWhere(userId: string | null) {
  if (userId === null) {
    // Admin / no filter — return only deleted filter
    return { deletedAt: null };
  }

  return {
    deletedAt: null,
    OR: [
      // host/creator
      { hostUserId: userId },
      // selected facilitator
      { facilitatorUserId: userId },
      // event participant (authenticated account)
      { participants: { some: { userId } } },
      // session participant in any event session
      { sessions: { some: { participants: { some: { userId } } } } },
      // invited user
      { invites: { some: { userId } } },
      // PUBLIC event that is still open/joinable
      {
        visibility: "PUBLIC" as const,
        status: { in: OPEN_EVENT_STATUSES },
      },
    ],
  };
}

/**
 * Prisma WHERE clause fragment for sessions visible to a given user.
 * Pass `null` for admin / unscoped queries.
 * Combine with your existing `activeSessionWhere` (deletedAt: null).
 */
export function sessionVisibilityWhere(userId: string | null) {
  if (userId === null) {
    return {};
  }

  return {
    OR: [
      // session participant (account)
      { participants: { some: { userId } } },
      // session facilitator
      { facilitatorId: userId },
      // event host
      { event: { hostUserId: userId } },
      // event facilitator
      { event: { facilitatorUserId: userId } },
      // standalone PUBLIC session that is open (not completed/finished)
      {
        eventId: null,
        visibility: "PUBLIC" as const,
        deletedAt: null,
        status: { not: "COMPLETED" },
        negotiationState: { notIn: ["FINISHED"] },
        closedByEventAt: null,
      },
      // event-linked session where the event is PUBLIC and open
      {
        eventId: { not: null },
        visibility: "PUBLIC" as const,
        deletedAt: null,
        status: { not: "COMPLETED" },
        negotiationState: { notIn: ["FINISHED"] },
        closedByEventAt: null,
        event: {
          visibility: "PUBLIC" as const,
          status: { in: OPEN_EVENT_STATUSES },
          deletedAt: null,
        },
      },
      // session invite
      { sessionInvites: { some: { userId } } },
    ],
  };
}
