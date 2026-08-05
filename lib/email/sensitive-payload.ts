import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const EMAIL_SENSITIVE_PAYLOAD_KEY_ENV = "EMAIL_SENSITIVE_PAYLOAD_KEY";
export const EMAIL_SENSITIVE_PAYLOAD_VERSION = 1 as const;

export type PasswordResetSensitivePayload = {
  v: typeof EMAIL_SENSITIVE_PAYLOAD_VERSION;
  kind: "password-reset";
  rawToken: string;
  locale: "ru" | "en";
  variables: {
    userName: string;
    supportEmail: string;
    operatorName: string;
    reason: string;
  };
  credentialGeneration: number;
  tokenId: string;
};

export type EncryptedSensitivePayload = {
  ciphertext: string;
  nonce: string;
};

export class SensitivePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SensitivePayloadError";
  }
}

function parseKey(raw: string | undefined): Buffer {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new SensitivePayloadError(
      `${EMAIL_SENSITIVE_PAYLOAD_KEY_ENV} is required for password-reset email enqueue/delivery.`,
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(trimmed, "base64");
  } catch {
    throw new SensitivePayloadError(
      `${EMAIL_SENSITIVE_PAYLOAD_KEY_ENV} must be base64-encoded.`,
    );
  }
  if (key.length !== 32) {
    throw new SensitivePayloadError(
      `${EMAIL_SENSITIVE_PAYLOAD_KEY_ENV} must decode to exactly 32 bytes.`,
    );
  }
  return key;
}

/**
 * Resolve the dedicated AEAD key for sensitive email payloads.
 * Fail closed in production when absent/malformed.
 * Local/test may set a deterministic key via env bootstrap.
 */
export function resolveSensitivePayloadKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer {
  const raw = env[EMAIL_SENSITIVE_PAYLOAD_KEY_ENV];
  try {
    return parseKey(raw);
  } catch (error) {
    if (env.NODE_ENV === "production") {
      throw error;
    }
    // Non-production: still fail closed if explicitly empty after trim checks
    // above; parseKey already throws. Re-throw for clarity.
    throw error;
  }
}

export function encryptSensitivePayload(
  payload: PasswordResetSensitivePayload,
  env: NodeJS.ProcessEnv = process.env,
): EncryptedSensitivePayload {
  const key = resolveSensitivePayloadKey(env);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString("base64"),
    nonce: nonce.toString("base64"),
  };
}

export function decryptSensitivePayload(
  input: EncryptedSensitivePayload,
  env: NodeJS.ProcessEnv = process.env,
): PasswordResetSensitivePayload {
  const key = resolveSensitivePayloadKey(env);
  let ciphertextWithTag: Buffer;
  let nonce: Buffer;
  try {
    ciphertextWithTag = Buffer.from(input.ciphertext, "base64");
    nonce = Buffer.from(input.nonce, "base64");
  } catch {
    throw new SensitivePayloadError("Invalid sensitive payload encoding.");
  }
  if (nonce.length !== 12 || ciphertextWithTag.length <= 16) {
    throw new SensitivePayloadError("Invalid sensitive payload framing.");
  }
  const ciphertext = ciphertextWithTag.subarray(0, -16);
  const tag = ciphertextWithTag.subarray(-16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as PasswordResetSensitivePayload;
    if (
      parsed?.v !== EMAIL_SENSITIVE_PAYLOAD_VERSION ||
      parsed.kind !== "password-reset" ||
      typeof parsed.rawToken !== "string" ||
      typeof parsed.tokenId !== "string"
    ) {
      throw new SensitivePayloadError("Unexpected sensitive payload shape.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SensitivePayloadError) throw error;
    throw new SensitivePayloadError("Sensitive payload decryption failed.");
  }
}

/** Build a fragment-only reset URL. Fragment is never sent to the server. */
export function buildPasswordResetActionUrl(
  canonicalBaseUrl: string,
  rawToken: string,
): string {
  const base = new URL("/reset-password", canonicalBaseUrl);
  // Fragment must not be set via searchParams; append explicitly.
  return `${base.origin}${base.pathname}#token=${rawToken}`;
}
