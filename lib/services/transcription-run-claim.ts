import { Prisma } from "@/app/generated/prisma/client";

/**
 * Serializes transcription admission for one Session.
 *
 * The lock is held only while the caller checks the current Transcript and
 * writes its QUEUED claim. The provider call runs after the transaction
 * commits, so a competing request observes the active status and exits.
 */
export async function lockSessionTranscriptionClaim(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id
    FROM "Session" s
    WHERE s.id = ${sessionId}
      AND s."deletedAt" IS NULL
    FOR UPDATE OF s
  `);

  return rows.length === 1;
}
