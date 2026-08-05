import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  assertPasswordResetPayloadDeliveryBinding,
  buildPasswordResetActionUrl,
  createEmailMessageId,
  decryptSensitivePayload,
  EMAIL_SENSITIVE_PAYLOAD_KEY_ENV,
  EMAIL_SENSITIVE_PAYLOAD_VERSION,
  encodeSensitivePayloadAad,
  encryptSensitivePayload,
  SensitivePayloadError,
  type PasswordResetSensitivePayload,
  type SensitivePayloadBinding,
} from "@/lib/email/sensitive-payload";

function makeKey(): string {
  return randomBytes(32).toString("base64");
}

function makeEnv(key?: string): Record<string, string | undefined> {
  return { [EMAIL_SENSITIVE_PAYLOAD_KEY_ENV]: key };
}

function makeBinding(
  overrides?: Partial<SensitivePayloadBinding>,
): SensitivePayloadBinding {
  return {
    messageId: createEmailMessageId(),
    tokenId: randomBytes(8).toString("hex"),
    userId: randomBytes(8).toString("hex"),
    credentialGeneration: 1,
    recipientNormalized: "user@example.com",
    ...overrides,
  };
}

function makePayload(
  binding: SensitivePayloadBinding,
  overrides?: Partial<PasswordResetSensitivePayload>,
): PasswordResetSensitivePayload {
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
    credentialGeneration: binding.credentialGeneration,
    tokenId: binding.tokenId,
    userId: binding.userId,
    ...overrides,
  };
}

test("encrypt then decrypt round-trips the full payload with AAD", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding();
  const payload = makePayload(binding);
  const encrypted = encryptSensitivePayload(payload, binding, env);
  const decrypted = decryptSensitivePayload(encrypted, binding, env);
  assert.deepEqual(decrypted, payload);
});

test("decrypted rawToken matches original", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding();
  const payload = makePayload(binding);
  const encrypted = encryptSensitivePayload(payload, binding, env);
  const decrypted = decryptSensitivePayload(encrypted, binding, env);
  assert.equal(decrypted.rawToken, payload.rawToken);
});

test("ciphertext does not contain plaintext rawToken", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding();
  const payload = makePayload(binding);
  const encrypted = encryptSensitivePayload(payload, binding, env);
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
  const binding = makeBinding();
  const payload = makePayload(binding, { rawToken: "deadbeef".repeat(8) });
  const encrypted = encryptSensitivePayload(payload, binding, env);
  const combined = encrypted.ciphertext + encrypted.nonce;
  assert.ok(!combined.includes("deadbeef"), "token must not appear in any encoded form");
});

test("wrong key fails decryption with SensitivePayloadError", () => {
  const encryptEnv = makeEnv(makeKey());
  const decryptEnv = makeEnv(makeKey());
  const binding = makeBinding();
  const payload = makePayload(binding);
  const encrypted = encryptSensitivePayload(payload, binding, encryptEnv);
  assert.throws(
    () => decryptSensitivePayload(encrypted, binding, decryptEnv),
    SensitivePayloadError,
  );
});

test("missing key throws SensitivePayloadError", () => {
  const binding = makeBinding();
  assert.throws(
    () => encryptSensitivePayload(makePayload(binding), binding, {}),
    SensitivePayloadError,
  );
  assert.throws(
    () =>
      decryptSensitivePayload(
        { ciphertext: "dGVzdA==", nonce: "dGVzdA==" },
        binding,
        {},
      ),
    SensitivePayloadError,
  );
});

test("key shorter than 32 bytes throws SensitivePayloadError", () => {
  const shortKey = randomBytes(16).toString("base64");
  const binding = makeBinding();
  assert.throws(
    () => encryptSensitivePayload(makePayload(binding), binding, makeEnv(shortKey)),
    SensitivePayloadError,
  );
});

test("tampered ciphertext fails authentication", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding();
  const payload = makePayload(binding);
  const encrypted = encryptSensitivePayload(payload, binding, env);
  const raw = Buffer.from(encrypted.ciphertext, "base64");
  raw[0] ^= 0xff;
  const tampered = { ...encrypted, ciphertext: raw.toString("base64") };
  assert.throws(
    () => decryptSensitivePayload(tampered, binding, env),
    SensitivePayloadError,
  );
});

test("tampered nonce fails authentication", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding();
  const encrypted = encryptSensitivePayload(makePayload(binding), binding, env);
  const rawNonce = Buffer.from(encrypted.nonce, "base64");
  rawNonce[0] ^= 0xff;
  const tampered = { ...encrypted, nonce: rawNonce.toString("base64") };
  assert.throws(
    () => decryptSensitivePayload(tampered, binding, env),
    SensitivePayloadError,
  );
});

test("AAD mismatch (copied ciphertext to other message) fails", () => {
  const env = makeEnv(makeKey());
  const bindingA = makeBinding({ messageId: "msg-a", tokenId: "tok-a" });
  const bindingB = makeBinding({
    messageId: "msg-b",
    tokenId: "tok-b",
    userId: bindingA.userId,
    credentialGeneration: bindingA.credentialGeneration,
    recipientNormalized: bindingA.recipientNormalized,
  });
  const encrypted = encryptSensitivePayload(makePayload(bindingA), bindingA, env);
  assert.throws(
    () => decryptSensitivePayload(encrypted, bindingB, env),
    SensitivePayloadError,
  );
});

test("recipient binding mismatch fails decryption", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding({ recipientNormalized: "a@example.com" });
  const encrypted = encryptSensitivePayload(makePayload(binding), binding, env);
  assert.throws(
    () =>
      decryptSensitivePayload(
        encrypted,
        { ...binding, recipientNormalized: "b@example.com" },
        env,
      ),
    SensitivePayloadError,
  );
});

test("encodeSensitivePayloadAad is deterministic", () => {
  const binding = makeBinding({
    messageId: "mid",
    tokenId: "tid",
    userId: "uid",
    credentialGeneration: 3,
    recipientNormalized: "User@Example.COM",
  });
  const a = encodeSensitivePayloadAad(binding).toString("utf8");
  const b = encodeSensitivePayloadAad(binding).toString("utf8");
  assert.equal(a, b);
  assert.ok(a.includes('"purpose":"PASSWORD_RESET"'));
  assert.ok(a.includes('"recipientNormalized":"user@example.com"'));
  assert.ok(!a.includes("rawToken"));
});

test("each encryption produces a unique nonce (probabilistic)", () => {
  const env = makeEnv(makeKey());
  const binding = makeBinding();
  const payload = makePayload(binding);
  const nonces = new Set(
    Array.from(
      { length: 20 },
      () => encryptSensitivePayload(payload, binding, env).nonce,
    ),
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
  const binding = makeBinding();
  assert.throws(
    () => decryptSensitivePayload({ ciphertext: "", nonce: "" }, binding, env),
    SensitivePayloadError,
  );
  assert.throws(
    () =>
      decryptSensitivePayload(
        { ciphertext: "aGVsbG8=", nonce: "aA==" },
        binding,
        env,
      ),
    SensitivePayloadError,
  );
});

test("assertPasswordResetPayloadDeliveryBinding rejects mismatched message id", async () => {
  const binding = makeBinding();
  const payload = makePayload(binding);
  await assert.rejects(
    () =>
      assertPasswordResetPayloadDeliveryBinding({
        payload,
        binding,
        messageId: "other-message",
        relatedTokenId: binding.tokenId,
        messageUserId: binding.userId,
        recipientEmailNormalized: binding.recipientNormalized,
      }),
    SensitivePayloadError,
  );
});
