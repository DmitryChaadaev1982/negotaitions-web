import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintClientIpValue,
  getTrustedClientIdentity,
  normalizeClientIp,
  UNKNOWN_CLIENT_IP_BUCKET,
} from "@/lib/auth/client-ip";
import { TRUSTED_CLIENT_IP_HEADER } from "@/lib/auth/trusted-proxy";
import { ProcessLocalPasswordResetLimiter } from "@/lib/auth/password-reset-rate-limit";

const SECRET = "stage-313cp-test-secret";

function headers(init?: Record<string, string>): Headers {
  return new Headers(init);
}

test("normalizeClientIp accepts IPv4, IPv6, and IPv4-mapped IPv6", () => {
  assert.equal(normalizeClientIp("192.0.2.10"), "192.0.2.10");
  assert.equal(normalizeClientIp(" 192.0.2.10 "), "192.0.2.10");
  assert.equal(
    normalizeClientIp("2001:db8::1"),
    "2001:db8::1",
  );
  assert.equal(normalizeClientIp("[2001:db8::1]"), "2001:db8::1");
  assert.equal(normalizeClientIp("::ffff:192.0.2.10"), "192.0.2.10");
});

test("normalizeClientIp rejects lists, ports, hostnames, and malformed input", () => {
  assert.equal(normalizeClientIp("192.0.2.1, 198.51.100.1"), null);
  assert.equal(normalizeClientIp("192.0.2.1:443"), null);
  assert.equal(normalizeClientIp("example.com"), null);
  assert.equal(normalizeClientIp("not-an-ip"), null);
  assert.equal(normalizeClientIp(""), null);
  assert.equal(normalizeClientIp("  "), null);
});

test("trusted proxy disabled ignores all forwarding headers", () => {
  const unknown = fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, SECRET);
  const cases: Array<Record<string, string>> = [
    { "x-forwarded-for": "198.51.100.1" },
    { "x-real-ip": "198.51.100.2" },
    { forwarded: "for=198.51.100.3" },
    { "cf-connecting-ip": "198.51.100.4" },
    { "true-client-ip": "198.51.100.5" },
    { [TRUSTED_CLIENT_IP_HEADER]: "198.51.100.6" },
  ];
  for (const init of cases) {
    const identity = getTrustedClientIdentity(headers(init), {
      env: { TRUSTED_PROXY_ENABLED: "false", AUTH_SECRET: SECRET },
      hmacSecret: SECRET,
    });
    assert.equal(identity.source, "unknown");
    assert.equal(identity.fingerprint, unknown);
  }
});

test("trusted proxy enabled accepts only the dedicated header", () => {
  const expected = fingerprintClientIpValue("192.0.2.55", SECRET);
  const identity = getTrustedClientIdentity(
    headers({
      [TRUSTED_CLIENT_IP_HEADER]: "192.0.2.55",
      "x-forwarded-for": "198.51.100.9",
      "x-real-ip": "198.51.100.8",
    }),
    {
      env: { TRUSTED_PROXY_ENABLED: "true", AUTH_SECRET: SECRET },
      hmacSecret: SECRET,
    },
  );
  assert.equal(identity.source, "trusted-header");
  assert.equal(identity.fingerprint, expected);

  const spoofOnly = getTrustedClientIdentity(
    headers({ "x-forwarded-for": "198.51.100.9" }),
    {
      env: { TRUSTED_PROXY_ENABLED: "true", AUTH_SECRET: SECRET },
      hmacSecret: SECRET,
    },
  );
  assert.equal(spoofOnly.source, "unknown");
});

test("trusted proxy rejects multi-value dedicated header and invalid env", () => {
  const unknown = fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, SECRET);
  const multi = getTrustedClientIdentity(
    headers({ [TRUSTED_CLIENT_IP_HEADER]: "192.0.2.1, 192.0.2.2" }),
    {
      env: { TRUSTED_PROXY_ENABLED: "true", AUTH_SECRET: SECRET },
      hmacSecret: SECRET,
    },
  );
  assert.equal(multi.source, "unknown");
  assert.equal(multi.fingerprint, unknown);

  const invalidEnv = getTrustedClientIdentity(headers(), {
    env: { TRUSTED_PROXY_ENABLED: "maybe", AUTH_SECRET: SECRET },
    hmacSecret: SECRET,
  });
  assert.equal(invalidEnv.source, "unknown");
});

test("spoofed forwarding headers cannot create distinct rate-limit identities", () => {
  const limiter = new ProcessLocalPasswordResetLimiter(10, 2);
  const unknown = fingerprintClientIpValue(UNKNOWN_CLIENT_IP_BUCKET, SECRET);
  const first = limiter.consume({
    normalizedEmail: "one@example.com",
    clientIpFingerprint: unknown,
    now: 1,
  });
  const second = limiter.consume({
    normalizedEmail: "two@example.com",
    clientIpFingerprint: unknown,
    now: 2,
  });
  const third = limiter.consume({
    normalizedEmail: "three@example.com",
    clientIpFingerprint: unknown,
    now: 3,
  });
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(third, false);

  const trusted = fingerprintClientIpValue("192.0.2.77", SECRET);
  const trustedLimiter = new ProcessLocalPasswordResetLimiter(10, 2);
  assert.equal(
    trustedLimiter.consume({
      normalizedEmail: "a@example.com",
      clientIpFingerprint: trusted,
      now: 1,
    }),
    true,
  );
  assert.equal(
    trustedLimiter.consume({
      normalizedEmail: "b@example.com",
      clientIpFingerprint: trusted,
      now: 2,
    }),
    true,
  );
  assert.equal(
    trustedLimiter.consume({
      normalizedEmail: "c@example.com",
      clientIpFingerprint: fingerprintClientIpValue("198.51.100.1", SECRET),
      now: 3,
    }),
    true,
  );
});
