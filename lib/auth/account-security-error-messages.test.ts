import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticatedPasswordChangeErrorKey,
  isInteractiveTransactionError,
  PASSWORD_CHANGE_FAILED_KEY,
  PASSWORD_CHANGE_RETRY_KEY,
  PASSWORD_RESET_INVALID_KEY,
  PASSWORD_RESET_RETRY_KEY,
  passwordResetErrorKey,
} from "@/lib/auth/account-security-error-messages";
import { StaleCredentialError } from "@/lib/auth/credential-concurrency";
import { CredentialDispatchFenceError } from "@/lib/auth/credential-dispatch-fence";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

/** Shape of a Prisma known-request error without importing the client class. */
function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code, clientVersion: "7.8.0" });
}

test("only the interactive-transaction class is identified as transient Prisma failure", () => {
  assert.equal(isInteractiveTransactionError(prismaError("P2028")), true);
  for (const code of ["P2002", "P2025", "P2034", "P1001", "P2028 "]) {
    assert.equal(isInteractiveTransactionError(prismaError(code)), false);
  }
  for (const value of [null, undefined, "P2028", 2028, new Error("P2028")]) {
    assert.equal(isInteractiveTransactionError(value), false);
  }
});

test("fence contention during password change maps to the retry message", () => {
  assert.equal(
    authenticatedPasswordChangeErrorKey(
      new CredentialDispatchFenceError("CREDENTIAL_DISPATCH_FENCE_TIMEOUT"),
    ),
    PASSWORD_CHANGE_RETRY_KEY,
  );
  assert.equal(
    authenticatedPasswordChangeErrorKey(
      new CredentialDispatchFenceError("CREDENTIAL_DISPATCH_FENCE_ABORTED"),
    ),
    PASSWORD_CHANGE_RETRY_KEY,
  );
  assert.equal(
    authenticatedPasswordChangeErrorKey(prismaError("P2028")),
    PASSWORD_CHANGE_RETRY_KEY,
  );
});

test("stale credentials and unclassified password-change failures stay terminal", () => {
  assert.equal(
    authenticatedPasswordChangeErrorKey(new StaleCredentialError()),
    PASSWORD_CHANGE_FAILED_KEY,
  );
  for (const error of [
    prismaError("P2002"),
    prismaError("P2034"),
    new Error("boom"),
    null,
    undefined,
  ]) {
    assert.equal(
      authenticatedPasswordChangeErrorKey(error),
      PASSWORD_CHANGE_FAILED_KEY,
    );
  }
});

test("transient reset failures retry while token failures stay invalid", () => {
  assert.equal(
    passwordResetErrorKey(prismaError("P2028")),
    PASSWORD_RESET_RETRY_KEY,
  );
  assert.equal(
    passwordResetErrorKey(
      new CredentialDispatchFenceError("CREDENTIAL_DISPATCH_FENCE_TIMEOUT"),
    ),
    PASSWORD_RESET_RETRY_KEY,
  );
  for (const error of [
    prismaError("P2002"),
    prismaError("P2025"),
    prismaError("P2034"),
    new Error("invalid token"),
    null,
    undefined,
  ]) {
    assert.equal(passwordResetErrorKey(error), PASSWORD_RESET_INVALID_KEY);
  }
});

test("retry and terminal messages exist in both locales without internal detail", () => {
  const keys = [
    "passwordChangeFailed",
    "passwordChangeRetry",
    "passwordResetInvalid",
    "passwordResetRetry",
  ] as const;
  const forbidden =
    /database|postgres|prisma|transaction|advisory|lock|timeout|token|user id|база|транзакц|блокиров|таймаут|токен/i;
  for (const dictionary of [en, ru]) {
    for (const key of keys) {
      const message = dictionary.auth[key];
      assert.equal(typeof message, "string");
      assert.ok(message.trim().length > 0);
      assert.ok(!forbidden.test(message), `${key} leaks internal detail`);
    }
  }
});
