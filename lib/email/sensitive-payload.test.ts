import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  buildPasswordResetActionUrl,
  decryptSensitivePayload,
  EMAIL_SENSITIVE_PAYLOAD_KEY_ENV,
  EMAIL_SENSITIVE_PAYLOAD_VERSION,
  encryptSensitivePayload,
  SensitivePayloadError,
  type PasswordResetSensitivePayload,
} from "@/lib/email/sensitive-payload";

function makeKey(): string {
  return randomBytes(32).toString("base64");
}

function makeEnv(key?: string): Record<string, string | undefined> {
  return { [EMAIL_SENSITIVE_PAYLOAD_KEY_ENV]: key };
}

function makePayload(overrides?: Partial<PasswordResetSensitivePayload>): PasswordResetSensitivePayload {
  return {
    v: EMAIL_SENSITIVE_PAYLOAD_VERSION,
    kind: "password-reset",
    rawToken: randomBytes(32).toString("hex"),
    locale: "en",
    variables: {
      userName: "Test User",
      supportEmail: "support@example.com",
      operatorName: "Test Operator",
      reason: "test",
    },
    credentialGeneration: 1,
    tokenId: randomBytes(8).toString("hex"),
    ...overrides,
  };
}

test("encrypt then decrypt round-trips the full payload", () => {
  const env = makeEnv(makeKey());
  const payload = makePayload();
  const encrypted = encryptSensitivePayload(payload, env);
  const decrypted = decryptSensitivePayload(encrypted, env);
  assert.deepEqual(decrypted, payload);
});

test("decrypted rawToken matches original", () => {
  const env = makeEnv(makeKey());
  const payload = makePayload();
  const encrypted = encryptSensitivePayload(payload, env);
  const decrypted = decryptSensitivePayload(encrypted, env);
  assert.equal(decrypted.rawToken, payload.rawToken);
});

test("ciphertext does not contain plaintext rawToken", () => {
  const env = makeEnv(makeKey());
  const payload = makePayload();
  const encrypted = encryptSensitivePayload(payload, env);
  const ciphertextDecoded = Buffer.from(encrypted.ciphertext, "base64").toString("utf8");
  assert.ok(
    !ciphertextDecoded.includes(payload.rawToken),
    "raw token must not appear in ciphertext bytes",
  );
  assert.ok(
    !encrypted.ciphertext.includes(payload.rawToken),
    "raw token must not appear in ciphertext base64",
  );
  assert.ok(
    !encrypted.nonce.includes(payload.rawToken),
    "raw token must not appear in nonce",
  );
});

test("ciphertext does not contain JSON-plaintext of the token", () => {
  const env = makeEnv(makeKey());
  const payload = makePayload({ rawToken: "deadbeef".repeat(8) });
  const encrypted = encryptSensitivePayload(payload, env);
  const combined = encrypted.ciphertext + encrypted.nonce;
  assert.ok(!combined.includes("deadbeef"), "token must not appear in any encoded form");
});

test("wrong key fails decryption with SensitivePayloadError", () => {
  const encryptEnv = makeEnv(makeKey());
  const decryptEnv = makeEnv(makeKey());
  const payload = makePayload();
  const encrypted = encryptSensitivePayload(payload, encryptEnv);
  assert.throws(
    () => decryptSensitivePayload(encrypted, decryptEnv),
    SensitivePayloadError,
  );
});

test("missing key throws SensitivePayloadError", () => {
  assert.throws(
    () => encryptSensitivePayload(makePayload(), {}),
    SensitivePayloadError,
  );
  assert.throws(
    () => decryptSensitivePayload({ ciphertext: "dGVzdA==", nonce: "dGVzdA==" }, {}),
    SensitivePayloadError,
  );
});

test("key shorter than 32 bytes throws SensitivePayloadError", () => {
  const shortKey = randomBytes(16).toString("base64");
  assert.throws(
    () => encryptSensitivePayload(makePayload(), makeEnv(shortKey)),
    SensitivePayloadError,
  );
});

test("tampered ciphertext fails authentication", () => {
  const env = makeEnv(makeKey());
  const payload = makePayload();
  const encrypted = encryptSensitivePayload(payload, env);
  const raw = Buffer.from(encrypted.ciphertext, "base64");
  raw[0] ^= 0xff;
  const tampered = { ...encrypted, ciphertext: raw.toString("base64") };
  assert.throws(() => decryptSensitivePayload(tampered, env), SensitivePayloadError);
});

test("tampered nonce fails authentication", () => {
  const env = makeEnv(makeKey());
  const encrypted = encryptSensitivePayload(makePayload(), env);
  const rawNonce = Buffer.from(encrypted.nonce, "base64");
  rawNonce[0] ^= 0xff;
  const tampered = { ...encrypted, nonce: rawNonce.toString("base64") };
  assert.throws(() => decryptSensitivePayload(tampered, env), SensitivePayloadError);
});

test("each encryption produces a unique nonce (probabilistic)", () => {
  const env = makeEnv(makeKey());
  const payload = makePayload();
  const nonces = new Set(
    Array.from({ length: 20 }, () => encryptSensitivePayload(payload, env).nonce),
  );
  assert.equal(nonces.size, 20, "nonces must be unique per encryption");
});

test("buildPasswordResetActionUrl produces fragment-only URL", () => {
  const url = buildPasswordResetActionUrl(
    "https://negotaitions.ru",
    "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
  );
  assert.match(url, /^https:\/\/negotaitions\.ru\/reset-password#token=/);
  assert.ok(!url.includes("?token="), "token must be in fragment, not query");
  const parsed = new URL(url);
  assert.equal(parsed.search, "", "URL must have no query string");
  assert.match(parsed.hash, /^#token=/);
});

test("buildPasswordResetActionUrl with local origin produces correct fragment", () => {
  const token = randomBytes(32).toString("hex");
  const url = buildPasswordResetActionUrl("https://local.negotaitions.ru", token);
  assert.ok(url.startsWith("https://local.negotaitions.ru/reset-password#token="));
  assert.ok(url.endsWith(token));
  assert.ok(!url.includes("?"));
});

test("invalid framing fields throw SensitivePayloadError", () => {
  const env = makeEnv(makeKey());
  assert.throws(
    () => decryptSensitivePayload({ ciphertext: "", nonce: "" }, env),
    SensitivePayloadError,
  );
  assert.throws(
    () => decryptSensitivePayload({ ciphertext: "aGVsbG8=", nonce: "aA==" }, env),
    SensitivePayloadError,
  );
});
