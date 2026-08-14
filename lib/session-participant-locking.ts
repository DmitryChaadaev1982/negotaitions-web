import { Prisma } from "@/app/generated/prisma/client";

type SessionParticipantLockClient = Pick<
  Prisma.TransactionClient,
  "$queryRaw"
>;

export const SESSION_PARTICIPANT_LOCK_ORDER = "id ASC";

export function orderSessionParticipantIds(
  participantIds: readonly string[],
): string[] {
  return [...new Set(participantIds)].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Locks every current participant for a session in the canonical row order.
 * Callers must keep any subsequent participant-row writes in the same order.
 */
export async function lockSessionParticipantsForSession(
  tx: SessionParticipantLockClient,
  sessionId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT id
    FROM "SessionParticipant"
    WHERE "sessionId" = ${sessionId}
    ORDER BY id ASC
    FOR UPDATE
  `);
}

/**
 * Locks a role/membership mutation batch in the canonical row order.
 */
export async function lockSessionParticipantsById(
  tx: SessionParticipantLockClient,
  sessionId: string,
  participantIds: readonly string[],
): Promise<void> {
  const orderedParticipantIds = orderSessionParticipantIds(participantIds);
  if (orderedParticipantIds.length === 0) {
    return;
  }

  await tx.$queryRaw(Prisma.sql`
    SELECT id
    FROM "SessionParticipant"
    WHERE "sessionId" = ${sessionId}
      AND id IN (${Prisma.join(orderedParticipantIds)})
    ORDER BY id ASC
    FOR UPDATE
  `);
}
