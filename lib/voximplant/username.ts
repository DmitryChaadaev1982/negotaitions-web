import { createHash } from "node:crypto";

/**
 * Canonical application-generated Voximplant username.
 *
 * Production identity runtime (`lib/voximplant/identity.ts`) re-exports this
 * function. Do not reimplement the hash elsewhere.
 */
export function buildVoximplantUsernameForUser(userId: string): string {
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 16);
  return `ng_u_${digest}`;
}

export const GENERATED_VOXIMPLANT_USERNAME_PATTERN = /^ng_u_[0-9a-f]{16}$/;

export function isGeneratedVoximplantUsername(
  username: string | null | undefined,
): boolean {
  return Boolean(username && GENERATED_VOXIMPLANT_USERNAME_PATTERN.test(username));
}
