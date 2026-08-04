import assert from "node:assert/strict";
import test from "node:test";

import { getPasswordResetConfig } from "@/lib/auth/password-reset-config";
import { ProcessLocalPasswordResetLimiter } from "@/lib/auth/password-reset-rate-limit";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  isPasswordResetTokenShape,
} from "@/lib/auth/password-reset-token";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  operation: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("password reset tokens are opaque 32-byte values stored by hash", () => {
  const first = generatePasswordResetToken();
  const second = generatePasswordResetToken();
  assert.equal(first.length, 64);
  assert.equal(isPasswordResetTokenShape(first), true);
  assert.notEqual(first, second);
  assert.match(hashPasswordResetToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPasswordResetToken(first), first);
  assert.equal(isPasswordResetTokenShape("not-a-token"), false);
});

test("password reset config has bounded secure defaults", () => {
  const defaults = withEnv(
    {
      PASSWORD_RESET_TOKEN_TTL_MINUTES: undefined,
      PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: undefined,
      PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: undefined,
    },
    () => getPasswordResetConfig(),
  );
  assert.deepEqual(defaults, {
    ttlMinutes: 30,
    cooldownSeconds: 60,
    maxPerAccountPerHour: 5,
  });
  assert.deepEqual(
    withEnv(
      {
        PASSWORD_RESET_TOKEN_TTL_MINUTES: "45",
        PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: "90",
        PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: "7",
      },
      () => getPasswordResetConfig(),
    ),
    {
      ttlMinutes: 45,
      cooldownSeconds: 90,
      maxPerAccountPerHour: 7,
    },
  );
  assert.throws(() =>
    withEnv({ PASSWORD_RESET_TOKEN_TTL_MINUTES: "1" }, () =>
      getPasswordResetConfig(),
    ),
  );
  assert.throws(() =>
    withEnv({ PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: "0" }, () =>
      getPasswordResetConfig(),
    ),
  );
});

test("process-local limiter layers email and HMAC IP windows", () => {
  const byEmail = new ProcessLocalPasswordResetLimiter(2, 10, 10);
  assert.equal(
    byEmail.consume({ normalizedEmail: "user@example.com", now: 1 }),
    true,
  );
  assert.equal(
    byEmail.consume({ normalizedEmail: "user@example.com", now: 2 }),
    false,
  );
  assert.equal(
    byEmail.consume({ normalizedEmail: "user@example.com", now: 10_001 }),
    true,
  );
  assert.equal(
    byEmail.consume({ normalizedEmail: "user@example.com", now: 20_002 }),
    false,
  );
  assert.equal(
    byEmail.consume({
      normalizedEmail: "user@example.com",
      now: 60 * 60 * 1000 + 2,
    }),
    true,
  );

  const byIp = new ProcessLocalPasswordResetLimiter(10, 2);
  const common = { rawIp: "192.0.2.5", hmacSecret: "test-secret" };
  assert.equal(
    byIp.consume({ ...common, normalizedEmail: "one@example.com", now: 1 }),
    true,
  );
  assert.equal(
    byIp.consume({ ...common, normalizedEmail: "two@example.com", now: 2 }),
    true,
  );
  assert.equal(
    byIp.consume({ ...common, normalizedEmail: "three@example.com", now: 3 }),
    false,
  );
});
