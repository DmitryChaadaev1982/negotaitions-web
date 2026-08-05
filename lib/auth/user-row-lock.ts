import type { Prisma } from "@/app/generated/prisma/client";

export type LockedUserCredentialRow = {
  id: string;
  credentialGeneration: number;
  status: string;
};

/**
 * Acquire a PostgreSQL row lock on User for credential/session linearization.
 * Must run inside an open Prisma transaction. Uses parameterized SQL only.
 */
export async function lockUserRowForUpdate(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LockedUserCredentialRow | null> {
  const rows = await tx.$queryRaw<LockedUserCredentialRow[]>`
    SELECT id, "credentialGeneration", status
    FROM "User"
    WHERE id = ${userId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}
