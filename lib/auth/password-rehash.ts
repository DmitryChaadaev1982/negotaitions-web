import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
import { prisma } from "@/lib/prisma";

import {
  classifyPasswordVerifier,
  hashPassword,
  isLegacyBcryptRehashEligible,
  verifyPassword,
} from "./crypto";
import { createUserSession } from "./session";

export type PasswordRehashResult = "upgraded" | "skipped" | "lost-cas" | "failed";

type PasswordRehashTestHooks = {
  /** Runs after the replacement hash is prepared and before the CAS write. */
  beforeCompareAndSet?: () => Promise<void> | void;
  /** Forces the CAS write to fail without changing the stored verifier. */
  failWrite?: boolean;
};

let rehashHooks: PasswordRehashTestHooks = {};

/** Test-only barrier injection. Never call from production paths. */
export function setPasswordRehashHooksForTests(
  hooks: PasswordRehashTestHooks,
): void {
  if (parseServerRuntimeSetting("NODE_ENV") === "production") {
    throw new Error("Password rehash test hooks are unavailable in production.");
  }
  rehashHooks = hooks;
}

export function clearPasswordRehashHooksForTests(): void {
  rehashHooks = {};
}

/**
 * Best-effort replacement of an accepted non-target verifier with the locked
 * Argon2id profile. This is not a password change: generation, sessions,
 * history, reset tokens, and password-changed mail stay untouched.
 *
 * The write is an optimistic compare-and-set on the exact verified hash and
 * generation. A concurrent credential change makes the update match nothing.
 * A database error is swallowed by the caller of the login helper.
 */
export async function upgradeVerifiedPasswordVerifier(params: {
  userId: string;
  verifiedPassword: string;
  verifiedPasswordHash: string;
  verifiedCredentialGeneration: number;
}): Promise<PasswordRehashResult> {
  const classification = classifyPasswordVerifier(params.verifiedPasswordHash);
  if (classification === "argon2id-current" || classification === "unknown") {
    return "skipped";
  }
  if (
    classification === "bcrypt-legacy" &&
    !isLegacyBcryptRehashEligible(
      params.verifiedPassword,
      params.verifiedPasswordHash,
    )
  ) {
    return "skipped";
  }

  const stillValid = await verifyPassword(
    params.verifiedPassword,
    params.verifiedPasswordHash,
  );
  if (!stillValid) return "skipped";

  try {
    const newHash = await hashPassword(params.verifiedPassword);
    await rehashHooks.beforeCompareAndSet?.();
    if (rehashHooks.failWrite) {
      throw new Error("Induced password rehash write failure.");
    }
    const updated = await prisma.user.updateMany({
      where: {
        id: params.userId,
        passwordHash: params.verifiedPasswordHash,
        credentialGeneration: params.verifiedCredentialGeneration,
      },
      data: {
        passwordHash: newHash,
      },
    });
    return updated.count === 1 ? "upgraded" : "lost-cas";
  } catch {
    return "failed";
  }
}

/**
 * Create the login session first. The verifier upgrade runs only after that
 * commit and cannot fail the session.
 */
export async function establishLoginSessionAndMaybeRehash(params: {
  userId: string;
  verifiedPassword: string;
  verifiedPasswordHash: string;
  verifiedCredentialGeneration: number;
  userAgent?: string;
}): Promise<void> {
  await createUserSession(params.userId, {
    userAgent: params.userAgent,
    expectedCredentialGeneration: params.verifiedCredentialGeneration,
  });
  await upgradeVerifiedPasswordVerifier({
    userId: params.userId,
    verifiedPassword: params.verifiedPassword,
    verifiedPasswordHash: params.verifiedPasswordHash,
    verifiedCredentialGeneration: params.verifiedCredentialGeneration,
  });
}
