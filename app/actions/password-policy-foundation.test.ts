import assert from "node:assert/strict";
import test from "node:test";

import { registerUser } from "@/app/actions/auth";
import { resetPassword } from "@/app/actions/password-reset";

test("FOUND-02 registration uses the canonical policy owner", async () => {
  const short = new FormData();
  short.set("name", "Ada");
  short.set("email", "ada-foundation@example.com");
  short.set("password", "1234567");
  short.set("confirmPassword", "1234567");
  const shortResult = await registerUser({}, short);
  assert.deepEqual(shortResult.errors?.password, ["auth.passwordTooShort"]);

  const mismatch = new FormData();
  mismatch.set("name", "Ada");
  mismatch.set("email", "ada-foundation@example.com");
  mismatch.set("password", "stage2b-ok-1");
  mismatch.set("confirmPassword", "stage2b-ok-2");
  const mismatchResult = await registerUser({}, mismatch);
  assert.equal(mismatchResult.errors?.password, undefined);
  assert.deepEqual(mismatchResult.errors?.confirmPassword, [
    "auth.passwordMismatch",
  ]);

  const longEnough = new FormData();
  longEnough.set("password", "stage2b-ok-1");
  longEnough.set("confirmPassword", "stage2b-ok-1");
  const longEnoughResult = await registerUser({}, longEnough);
  assert.equal(
    longEnoughResult.errors?.password?.includes("auth.passwordTooShort") ??
      false,
    false,
  );
  assert.ok(longEnoughResult.errors?.name);
});

test("FOUND-03 email reset uses the canonical policy owner", async () => {
  const short = new FormData();
  short.set("token", "not-a-real-token");
  short.set("password", "");
  short.set("confirmPassword", "");
  assert.deepEqual(await resetPassword({}, short), {
    error: "auth.passwordTooShort",
  });

  const mismatch = new FormData();
  mismatch.set("token", "not-a-real-token");
  mismatch.set("password", "stage2b-ok-1");
  mismatch.set("confirmPassword", "stage2b-ok-2");
  assert.deepEqual(await resetPassword({}, mismatch), {
    error: "auth.passwordMismatch",
  });

  const common = new FormData();
  common.set("token", "not-a-real-token");
  common.set("password", "password123");
  common.set("confirmPassword", "password123");
  assert.deepEqual(await resetPassword({}, common), {
    error: "auth.passwordCommon",
  });

  const tooLong = new FormData();
  tooLong.set("token", "not-a-real-token");
  tooLong.set("password", "x".repeat(129));
  tooLong.set("confirmPassword", "x".repeat(129));
  assert.deepEqual(await resetPassword({}, tooLong), {
    error: "auth.passwordTooLong",
  });
});
