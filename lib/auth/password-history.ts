import type { Prisma } from "@/app/generated/prisma/client";

import { verifyPassword } from "./crypto";

/** Retained previous credential secrets. The current verifier is separate. */
export const PASSWORD_HISTORY_DEPTH = 5;

export class PasswordReusedError extends Error {
  readonly code = "password_reused" as const;

  constructor() {
    super("password_reused");
    this.name = "PasswordReusedError";
  }
}

/**
 * True when the candidate matches any encoded verifier.
 * Bcrypt's 72-byte prefix is accepted as a match: a longer candidate that
 * shares that prefix is rejected rather than treated as a distinct secret.
 */
export async function passwordMatchesAnyVerifier(
  password: string,
  verifiers: readonly string[],
): Promise<boolean> {
  for (const verifier of verifiers) {
    if (await verifyPassword(password, verifier)) return true;
  }
  return false;
}

/**
 * Keep the newest rows by retiredCredentialGeneration. createdAt is not the
 * order authority. Caller holds the credential transaction and User row lock.
 */
export async function prunePasswordHistory(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const count = await tx.passwordHistory.count({ where: { userId } });
  if (count <= PASSWORD_HISTORY_DEPTH) return;
  const retained = await tx.passwordHistory.findMany({
    where: { userId },
    orderBy: { retiredCredentialGeneration: "desc" },
    take: PASSWORD_HISTORY_DEPTH,
    select: { id: true },
  });
  await tx.passwordHistory.deleteMany({
    where: {
      userId,
      id: { notIn: retained.map((row) => row.id) },
    },
  });
}
