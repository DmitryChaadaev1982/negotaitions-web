/**
 * Client-safe password policy bounds.
 *
 * Length is Unicode code points, not UTF-16 code units. This module has no
 * blocklist and no filesystem access. Server validation lives in
 * `password-policy.ts`. Live checks cover these bounds and confirmation
 * match only. Common-password and previous-password results are projected
 * from a server outcome; this module never contains the blocklist or history.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordChecklistStatus = "neutral" | "met" | "unmet";

export type PasswordChecklist = {
  minLength: PasswordChecklistStatus;
  maxLength: PasswordChecklistStatus;
  match: PasswordChecklistStatus;
};

export function passwordCodePointLength(password: string): number {
  return Array.from(password).length;
}

/**
 * Live checklist for a password the user is still typing.
 *
 * An empty password leaves the length rules neutral. Confirmation stays
 * neutral until that field has input. This function does not know whether a
 * password is common or previously used.
 */
export function evaluatePasswordChecklist(input: {
  password: string;
  confirmation: string;
}): PasswordChecklist {
  const length = passwordCodePointLength(input.password);
  const passwordStarted = length > 0;
  const confirmationStarted = passwordCodePointLength(input.confirmation) > 0;

  return {
    minLength: !passwordStarted
      ? "neutral"
      : length >= PASSWORD_MIN_LENGTH
        ? "met"
        : "unmet",
    maxLength: !passwordStarted
      ? "neutral"
      : length <= PASSWORD_MAX_LENGTH
        ? "met"
        : "unmet",
    match: !confirmationStarted
      ? "neutral"
      : input.password === input.confirmation
        ? "met"
        : "unmet",
  };
}

const NEUTRAL_SERVER_CHECKS = {
  common: "neutral",
  reused: "neutral",
} as const;

/**
 * Project a server password result onto the two rules the browser cannot
 * check. A result applies only to the password that was submitted. A common
 * rejection leaves previous-use unchecked, because history is evaluated after
 * the denylist. A reuse rejection means the denylist already passed.
 */
export function projectPasswordServerChecks(input: {
  password: string;
  submittedPassword: string | null;
  success?: boolean;
  error?: string | null;
}): { common: PasswordChecklistStatus; reused: PasswordChecklistStatus } {
  if (
    input.submittedPassword == null ||
    input.password !== input.submittedPassword
  ) {
    return { ...NEUTRAL_SERVER_CHECKS };
  }
  if (input.success) {
    return { common: "met", reused: "met" };
  }
  if (input.error === "auth.passwordCommon") {
    return { common: "unmet", reused: "neutral" };
  }
  if (input.error === "auth.passwordReused") {
    return { common: "met", reused: "unmet" };
  }
  return { ...NEUTRAL_SERVER_CHECKS };
}
