import { CredentialDispatchFenceError } from "@/lib/auth/credential-dispatch-fence";

/**
 * User-facing error selection for account-security mutations.
 *
 * Transient serialization failures must not present a terminal message that
 * tells the account owner the operation can never succeed. Only a narrow,
 * explicitly transient class is retryable; every other failure keeps its
 * existing terminal message.
 *
 * Returned keys are i18n keys only. No database, lock, user, token, timeout, or
 * transaction detail is ever exposed to the client.
 */

export const PASSWORD_CHANGE_FAILED_KEY = "auth.passwordChangeFailed";
export const PASSWORD_CHANGE_RETRY_KEY = "auth.passwordChangeRetry";
export const PASSWORD_RESET_INVALID_KEY = "auth.passwordResetInvalid";
export const PASSWORD_RESET_RETRY_KEY = "auth.passwordResetRetry";

/** Prisma interactive-transaction timeout / already-closed error class. */
export const PRISMA_INTERACTIVE_TRANSACTION_ERROR_CODE = "P2028";

/**
 * Identify the Prisma interactive-transaction error class without `instanceof`
 * against a client class that may not be loaded on this path. Only P2028 is
 * treated as transient; no other Prisma error code is retryable.
 */
export function isInteractiveTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code ===
      PRISMA_INTERACTIVE_TRANSACTION_ERROR_CODE
  );
}

/** Bounded fence contention and interactive-transaction expiry are retryable. */
export function isTransientAccountSecurityFailure(error: unknown): boolean {
  return (
    error instanceof CredentialDispatchFenceError ||
    isInteractiveTransactionError(error)
  );
}

export function authenticatedPasswordChangeErrorKey(error: unknown): string {
  return isTransientAccountSecurityFailure(error)
    ? PASSWORD_CHANGE_RETRY_KEY
    : PASSWORD_CHANGE_FAILED_KEY;
}

/**
 * A rolled-back reset transaction leaves the token unconsumed, so retrying is
 * correct. Invalid, expired, consumed, and revoked tokens never reach this
 * mapping: `resetPasswordWithToken` returns `false` for them instead of
 * throwing.
 */
export function passwordResetErrorKey(error: unknown): string {
  return isTransientAccountSecurityFailure(error)
    ? PASSWORD_RESET_RETRY_KEY
    : PASSWORD_RESET_INVALID_KEY;
}
