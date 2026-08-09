import assert from "node:assert/strict";
import test from "node:test";

import { getEmailConfig } from "@/lib/email/config";

/**
 * Canonical base-URL allowlist tests (M-04).
 *
 * parseCanonicalBaseUrl is unexported (it is an internal function of
 * lib/email/config.ts), so we test the observable behaviour through the
 * getEmailConfig() public API by injecting EMAIL_CANONICAL_BASE_URL via
 * process.env and verifying that valid values are accepted and invalid values
 * throw.
 *
 * This avoids coupling to internal implementation detail while still giving
 * deterministic proof that the allowlist is enforced at the right boundary.
 */

const VALID_PRODUCTION_ORIGIN = "https://negotaitions.ru";
const VALID_LOCAL_ORIGIN = "https://local.negotaitions.ru";

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

function canonicalBaseUrlAccepted(url: string): boolean {
  return withEnv(
    {
      NODE_ENV: "development",
      EMAIL_CANONICAL_BASE_URL: url,
      EMAIL_PROVIDER: "disabled",
      EMAIL_DELIVERY_ENABLED: "false",
    },
    () => {
      try {
        getEmailConfig();
        return true;
      } catch {
        return false;
      }
    },
  );
}

function canonicalBaseUrlThrows(url: string): boolean {
  return !canonicalBaseUrlAccepted(url);
}

test("approved production origin is accepted in non-production", () => {
  assert.ok(canonicalBaseUrlAccepted(VALID_PRODUCTION_ORIGIN));
});

test("approved local origin is accepted in non-production", () => {
  assert.ok(canonicalBaseUrlAccepted(VALID_LOCAL_ORIGIN));
});

test("arbitrary https host is rejected (not on allowlist)", () => {
  assert.ok(canonicalBaseUrlThrows("https://evil.example.com"));
});

test("http origin is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("http://negotaitions.ru"));
});

test("origin with path is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://negotaitions.ru/some/path"));
});

test("origin with explicit non-standard port is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://negotaitions.ru:8443"));
  assert.ok(canonicalBaseUrlThrows("https://negotaitions.ru:4443"));
  // Port 443 is the default HTTPS port — url.port returns "" for it and is therefore
  // accepted (same as omitting the port). This is correct per the allowlist rules.
});

test("origin with search params is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://negotaitions.ru?foo=bar"));
});

test("origin with fragment is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://negotaitions.ru#section"));
});

test("origin with trailing-dot hostname is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://negotaitions.ru."));
});

test("empty string URL fails closed instead of restoring an origin", () => {
  assert.ok(canonicalBaseUrlThrows(""));
});

test("not-a-URL string is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("not-a-url"));
});

test("origin with username/password is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://user:pass@negotaitions.ru"));
});

test("www subdomain is rejected (not on allowlist)", () => {
  assert.ok(canonicalBaseUrlThrows("https://www.negotaitions.ru"));
});

test("subdomain of local is rejected", () => {
  assert.ok(canonicalBaseUrlThrows("https://other.local.negotaitions.ru"));
});
