/**
 * Client-safe password policy bounds.
 *
 * Length is Unicode code points. This module has no blocklist and no
 * filesystem access. Server validation lives in `password-policy.ts`.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordCodePointLength(password: string): number {
  return Array.from(password).length;
}
