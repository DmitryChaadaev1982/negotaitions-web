import type { Prisma } from "@/app/generated/prisma/client";

type SessionDb = Prisma.TransactionClient;

/** Delete every account session row for the user. */
export async function revokeAllUserSessions(
  tx: SessionDb,
  userId: string,
): Promise<void> {
  await tx.userSession.deleteMany({ where: { userId } });
}

/** Delete every account session row except the caller's current session. */
export async function revokeOtherUserSessions(
  tx: SessionDb,
  userId: string,
  currentSessionTokenHash: string,
): Promise<void> {
  await tx.userSession.deleteMany({
    where: {
      userId,
      sessionTokenHash: { not: currentSessionTokenHash },
    },
  });
}
