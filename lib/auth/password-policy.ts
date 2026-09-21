/**
 * Server-side policy for a newly chosen account password.
 *
 * This checkpoint keeps the current rule: at least 8 characters, and the
 * confirmation must match when it is supplied. Composition, history, and
 * blocklist checks are not part of this policy.
 */
export const PASSWORD_MIN_LENGTH = 8;

export type NewPasswordPolicyCode = "too_short" | "mismatch";

export type NewPasswordPolicyResult =
  | { ok: true }
  | { ok: false; codes: NewPasswordPolicyCode[] };

/**
 * Validate a new password. Omit `confirmation` to check length only.
 * An empty password fails the minimum-length rule.
 */
export function validateNewPassword(input: {
  password: string;
  confirmation?: string;
}): NewPasswordPolicyResult {
  const codes: NewPasswordPolicyCode[] = [];
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    codes.push("too_short");
  }
  if (
    input.confirmation !== undefined &&
    input.password !== input.confirmation
  ) {
    codes.push("mismatch");
  }
  if (codes.length > 0) return { ok: false, codes };
  return { ok: true };
}
