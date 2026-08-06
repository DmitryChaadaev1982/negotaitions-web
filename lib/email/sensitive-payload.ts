import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  hashPasswordResetToken,
  isPasswordResetTokenShape,
} from "../auth/password-reset-token";
import {
  readServerRuntimeSettingRaw,
  SERVER_RUNTIME_SETTINGS,
} from "../config/server-runtime-settings";
import { normalizeEmailAddress } from "./address";

export const EMAIL_SENSITIVE_PAYLOAD_KEY_ENV =
  SERVER_RUNTIME_SETTINGS.EMAIL_SENSITIVE_PAYLOAD_KEY.key;
export const EMAIL_SENSITIVE_PAYLOAD_VERSION = 1 as const;
export const EMAIL_SENSITIVE_PAYLOAD_AAD_VERSION = 1 as const;
export const EMAIL_SENSITIVE_PAYLOAD_PURPOSE = "PASSWORD_RESET" as const;

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
  userId: string;
};

/**
 * Authenticated additional data binding ciphertext to its intended delivery
 * identity. Field order in {@link encodeSensitivePayloadAad} is fixed.
 */
export type SensitivePayloadBinding = {
  messageId: string;
  tokenId: string;
  userId: string;
  credentialGeneration: number;
  /** Normalized recipient (trim + lower-case). Never a secret. */
  recipientNormalized: string;
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

/** Application-generated EmailMessage id used before insert (AAD bootstrap). */
export function createEmailMessageId(): string {
  const time = Date.now().toString(36);
  const entropy = randomBytes(10).toString("hex");
  return `c${time}${entropy}`;
}

function isCanonicalBase64(value: string, expectedByteLength?: number): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  if (value.length % 4 !== 0) return false;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64");
  } catch {
    return false;
  }
  if (decoded.toString("base64") !== value) return false;
  if (typeof expectedByteLength === "number" && decoded.length !== expectedByteLength) {
    return false;
  }
  return true;
}

function parseKey(raw: string | undefined): Buffer {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new SensitivePayloadError(
      `${EMAIL_SENSITIVE_PAYLOAD_KEY_ENV} is required for password-reset email enqueue/delivery.`,
    );
  }
  if (!isCanonicalBase64(trimmed)) {
    throw new SensitivePayloadError(
      `${EMAIL_SENSITIVE_PAYLOAD_KEY_ENV} must be canonical base64.`,
    );
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new SensitivePayloadError(
      `${EMAIL_SENSITIVE_PAYLOAD_KEY_ENV} must decode to exactly 32 bytes.`,
    );
  }
  return key;
}

/**
 * Resolve the dedicated AEAD key for sensitive email payloads.
 * Fail closed when absent/malformed.
 */
export function resolveSensitivePayloadKey(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Buffer {
  return parseKey(
    readServerRuntimeSettingRaw("EMAIL_SENSITIVE_PAYLOAD_KEY", env) ?? undefined,
  );
}

/**
 * Canonical, versioned AAD encoding. Fixed key order — never ambiguous concat.
 * Secrets and raw tokens must never appear here.
 */
export function encodeSensitivePayloadAad(binding: SensitivePayloadBinding): Buffer {
  const recipientNormalized = normalizeEmailAddress(binding.recipientNormalized);
  const canonical = {
    v: EMAIL_SENSITIVE_PAYLOAD_AAD_VERSION,
    purpose: EMAIL_SENSITIVE_PAYLOAD_PURPOSE,
    messageId: binding.messageId,
    tokenId: binding.tokenId,
    userId: binding.userId,
    credentialGeneration: binding.credentialGeneration,
    recipientNormalized,
    payloadKind: "password-reset" as const,
  };
  return Buffer.from(JSON.stringify(canonical), "utf8");
}

export function encryptSensitivePayload(
  payload: PasswordResetSensitivePayload,
  binding: SensitivePayloadBinding,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): EncryptedSensitivePayload {
  if (
    payload.tokenId !== binding.tokenId ||
    payload.userId !== binding.userId ||
    payload.credentialGeneration !== binding.credentialGeneration
  ) {
    throw new SensitivePayloadError("Sensitive payload fields do not match binding.");
  }
  const key = resolveSensitivePayloadKey(env);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(encodeSensitivePayloadAad(binding));
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
  binding: SensitivePayloadBinding,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PasswordResetSensitivePayload {
  const key = resolveSensitivePayloadKey(env);
  if (!isCanonicalBase64(input.ciphertext) || !isCanonicalBase64(input.nonce, 12)) {
    throw new SensitivePayloadError("Invalid sensitive payload encoding.");
  }
  const ciphertextWithTag = Buffer.from(input.ciphertext, "base64");
  const nonce = Buffer.from(input.nonce, "base64");
  if (nonce.length !== 12 || ciphertextWithTag.length <= 16) {
    throw new SensitivePayloadError("Invalid sensitive payload framing.");
  }
  const ciphertext = ciphertextWithTag.subarray(0, -16);
  const tag = ciphertextWithTag.subarray(-16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(encodeSensitivePayloadAad(binding));
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
      typeof parsed.tokenId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.credentialGeneration !== "number"
    ) {
      throw new SensitivePayloadError("Unexpected sensitive payload shape.");
    }
    if (
      parsed.tokenId !== binding.tokenId ||
      parsed.userId !== binding.userId ||
      parsed.credentialGeneration !== binding.credentialGeneration
    ) {
      throw new SensitivePayloadError("Decrypted payload does not match binding.");
    }
    if (!isPasswordResetTokenShape(parsed.rawToken)) {
      throw new SensitivePayloadError("Unexpected sensitive payload token shape.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof SensitivePayloadError) throw error;
    throw new SensitivePayloadError("Sensitive payload decryption failed.");
  }
}

/**
 * Resolve the only recipient value that may cross the provider boundary.
 * The indexed association must itself be canonical because AAD normalization
 * intentionally treats case/outer whitespace as the same identity. The
 * nullable delivery field may be normalized, but it must resolve to that
 * authenticated identity; the canonical result is what the provider receives.
 */
export function resolvePasswordResetProviderRecipient(params: {
  recipientEmail: string | null | undefined;
  recipientEmailNormalized: string;
  authenticatedRecipientNormalized: string;
}): string {
  try {
    const durableNormalized = normalizeEmailAddress(
      params.recipientEmailNormalized,
    );
    if (durableNormalized !== params.recipientEmailNormalized) {
      throw new SensitivePayloadError(
        "Recipient association is not canonical.",
      );
    }
    const authenticatedNormalized = normalizeEmailAddress(
      params.authenticatedRecipientNormalized,
    );
    if (durableNormalized !== authenticatedNormalized) {
      throw new SensitivePayloadError("Recipient identity mismatch.");
    }
    if (!params.recipientEmail) {
      throw new SensitivePayloadError("Recipient delivery field is missing.");
    }
    const providerRecipient = normalizeEmailAddress(params.recipientEmail);
    if (providerRecipient !== authenticatedNormalized) {
      throw new SensitivePayloadError("Recipient identity mismatch.");
    }
    return providerRecipient;
  } catch (error) {
    if (error instanceof SensitivePayloadError) throw error;
    throw new SensitivePayloadError("Recipient association is invalid.");
  }
}

function timingSafeEqualHex(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  if (leftBuf.length !== rightBuf.length) {
    // Keep a constant-ish compare against a derived buffer to avoid leaking length
    // via early return timing of unequal hashes of equal expected size.
    const dig = createHash("sha256").update(leftBuf).digest();
    timingSafeEqual(dig, dig);
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

/**
 * After GCM authentication, re-validate the decrypted token against the durable
 * PasswordResetToken row and message association before provider.send.
 */
export async function assertPasswordResetPayloadDeliveryBinding(params: {
  payload: PasswordResetSensitivePayload;
  binding: SensitivePayloadBinding;
  messageId: string;
  relatedTokenId: string | null | undefined;
  messageUserId: string | null | undefined;
  recipientEmailNormalized: string;
}): Promise<void> {
  if (params.binding.messageId !== params.messageId) {
    throw new SensitivePayloadError("Message identity mismatch.");
  }
  if (!params.relatedTokenId || params.relatedTokenId !== params.payload.tokenId) {
    throw new SensitivePayloadError("Token identity mismatch.");
  }
  if (!params.messageUserId || params.messageUserId !== params.payload.userId) {
    throw new SensitivePayloadError("User identity mismatch.");
  }
  if (
    normalizeEmailAddress(params.recipientEmailNormalized) !==
    normalizeEmailAddress(params.binding.recipientNormalized)
  ) {
    throw new SensitivePayloadError("Recipient identity mismatch.");
  }

  const token = await (await import("@/lib/prisma")).prisma.passwordResetToken.findUnique({
    where: { id: params.payload.tokenId },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
    },
  });
  if (!token || token.userId !== params.payload.userId) {
    throw new SensitivePayloadError("Token row association mismatch.");
  }

  const computedHash = hashPasswordResetToken(params.payload.rawToken);
  if (!timingSafeEqualHex(computedHash, token.tokenHash)) {
    throw new SensitivePayloadError("Token hash mismatch.");
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
