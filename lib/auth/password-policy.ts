import { isCommonPassword } from "@/lib/auth/common-password-blocklist";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordCodePointLength,
} from "@/lib/auth/password-policy-constants";

export {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordCodePointLength,
} from "@/lib/auth/password-policy-constants";

/**
 * Server-side policy for a newly chosen account password.
 *
 * Minimum 10 and maximum 128 Unicode code points. No composition rules.
 * The password is not trimmed, lowercased, or NFKC-normalized before it is
 * hashed. Blocklist comparison uses a separate normalized copy.
 * History reuse is enforced later, inside the credential transaction.
 */
export type NewPasswordPolicyCode =
  | "too_short"
  | "too_long"
  | "common_password"
  | "mismatch";

export type PasswordPolicyCode = NewPasswordPolicyCode | "password_reused";

export type NewPasswordPolicyResult =
  | { ok: true }
  | { ok: false; codes: NewPasswordPolicyCode[] };

const POLICY_PRIORITY: readonly NewPasswordPolicyCode[] = [
  "too_short",
  "too_long",
  "common_password",
  "mismatch",
];

const POLICY_MESSAGE_KEYS: Record<PasswordPolicyCode, string> = {
  too_short: "auth.passwordTooShort",
  too_long: "auth.passwordTooLong",
  common_password: "auth.passwordCommon",
  password_reused: "auth.passwordReused",
  mismatch: "auth.passwordMismatch",
};

export class PasswordPolicyError extends Error {
  readonly codes: NewPasswordPolicyCode[];

  constructor(codes: NewPasswordPolicyCode[]) {
    super("password_policy");
    this.name = "PasswordPolicyError";
    this.codes = codes;
  }
}

/**
 * Validate a new password. Omit `confirmation` to skip the match check.
 * An empty password fails the minimum-length rule.
 */
export function validateNewPassword(input: {
  password: string;
  confirmation?: string;
}): NewPasswordPolicyResult {
  const codes: NewPasswordPolicyCode[] = [];
  const length = passwordCodePointLength(input.password);
  if (length < PASSWORD_MIN_LENGTH) codes.push("too_short");
  else if (length > PASSWORD_MAX_LENGTH) codes.push("too_long");
  if (isCommonPassword(input.password)) codes.push("common_password");
  if (
    input.confirmation !== undefined &&
    input.password !== input.confirmation
  ) {
    codes.push("mismatch");
  }
  if (codes.length > 0) return { ok: false, codes };
  return { ok: true };
}

export function assertNewPasswordPolicy(password: string): void {
  const result = validateNewPassword({ password });
  if (!result.ok) throw new PasswordPolicyError(result.codes);
}

export function primaryPasswordPolicyCode(
  codes: readonly NewPasswordPolicyCode[],
): NewPasswordPolicyCode | null {
  return POLICY_PRIORITY.find((code) => codes.includes(code)) ?? null;
}

export function passwordPolicyMessageKey(code: PasswordPolicyCode): string {
  return POLICY_MESSAGE_KEYS[code];
}

export function passwordPolicyFailureKey(
  codes: readonly NewPasswordPolicyCode[],
): string | null {
  const code = primaryPasswordPolicyCode(codes);
  return code ? passwordPolicyMessageKey(code) : null;
}
