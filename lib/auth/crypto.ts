import {
  hash as argon2Hash,
  verify as argon2Verify,
  type Options,
} from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * New password hashes are Argon2id. Locked after the Stage 2A local benchmark
 * on Node v24.17.0, win32 x64, Intel Core i7-10700F: sequential medians for a
 * 16-character password were t=2 at 17 ms, t=3 at 23 ms, and t=4 at 30 ms.
 * The procedure raises timeCost while the median stays under 50 ms, and stops
 * at 4. Memory stays 19456 KiB and parallelism stays 1. Six verifies plus one
 * hash measured about 222 ms, inside the 2 second check and the 5000 ms
 * credential fence. Do not retune these constants without a new benchmark.
 */
export const PASSWORD_HASH_ALGORITHM = "argon2id" as const;
export const ARGON2ID_MEMORY_KIB = 19456;
export const ARGON2ID_TIME_COST = 4;
export const ARGON2ID_PARALLELISM = 1;
export const ARGON2ID_TAG_BYTES = 32;
export const ARGON2ID_SALT_BYTES = 16;
export const BCRYPT_REHASH_ELIGIBILITY_MAX_UTF8_BYTES = 72;

const BCRYPT_VERIFIER = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const ARGON2ID_VERIFIER =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export type PasswordVerifierClassification =
  | "argon2id-current"
  | "argon2id-rehash"
  | "bcrypt-legacy"
  | "unknown";

type ParsedArgon2id = {
  memoryKiB: number;
  timeCost: number;
  parallelism: number;
  saltBytes: number;
  tagBytes: number;
};

function unpaddedBase64ByteLength(segment: string): number | null {
  if (segment.length === 0 || segment.length % 4 === 1) return null;
  const padLength = (4 - (segment.length % 4)) % 4;
  const decoded = Buffer.from(`${segment}${"=".repeat(padLength)}`, "base64");
  if (decoded.toString("base64").replace(/=+$/u, "") !== segment) return null;
  return decoded.length;
}

function parseArgon2idVerifier(encodedVerifier: string): ParsedArgon2id | null {
  const match = ARGON2ID_VERIFIER.exec(encodedVerifier);
  if (!match) return null;
  const saltBytes = unpaddedBase64ByteLength(match[4]);
  const tagBytes = unpaddedBase64ByteLength(match[5]);
  if (saltBytes == null || tagBytes == null) return null;
  return {
    memoryKiB: Number(match[1]),
    timeCost: Number(match[2]),
    parallelism: Number(match[3]),
    saltBytes,
    tagBytes,
  };
}

function isCurrentArgon2idProfile(parsed: ParsedArgon2id): boolean {
  return (
    parsed.memoryKiB === ARGON2ID_MEMORY_KIB &&
    parsed.timeCost === ARGON2ID_TIME_COST &&
    parsed.parallelism === ARGON2ID_PARALLELISM &&
    parsed.saltBytes === ARGON2ID_SALT_BYTES &&
    parsed.tagBytes === ARGON2ID_TAG_BYTES
  );
}

/**
 * Classify a stored verifier. Unknown, empty, and non-target Argon2 variants
 * are not rehashable. This function does not verify a password and does not write.
 */
export function classifyPasswordVerifier(
  encodedVerifier: string,
): PasswordVerifierClassification {
  if (typeof encodedVerifier !== "string" || encodedVerifier.length === 0) {
    return "unknown";
  }
  if (BCRYPT_VERIFIER.test(encodedVerifier)) return "bcrypt-legacy";
  const parsed = parseArgon2idVerifier(encodedVerifier);
  if (!parsed) return "unknown";
  return isCurrentArgon2idProfile(parsed)
    ? "argon2id-current"
    : "argon2id-rehash";
}

/**
 * True when the stored verifier is accepted but is not the locked Argon2id
 * profile. Bcrypt is legacy even when a later candidate is longer than 72
 * UTF-8 bytes. Transparent conversion of that case is refused separately by
 * isLegacyBcryptRehashEligible. Login performs the upgrade in
 * password-rehash.ts after the session commit.
 */
export function needsPasswordRehash(encodedVerifier: string): boolean {
  const classification = classifyPasswordVerifier(encodedVerifier);
  return (
    classification === "bcrypt-legacy" || classification === "argon2id-rehash"
  );
}

/**
 * Transparent bcrypt-to-Argon2id conversion may proceed only when the
 * stored verifier is bcrypt and the submitted candidate's UTF-8 length is at
 * most 72 bytes. A longer candidate can verify under bcrypt's prefix semantics
 * without proving the suffix, so it must not be rebound to Argon2id.
 */
export function isLegacyBcryptRehashEligible(
  candidate: string,
  encodedVerifier: string,
): boolean {
  if (classifyPasswordVerifier(encodedVerifier) !== "bcrypt-legacy") return false;
  if (typeof candidate !== "string") return false;
  return (
    Buffer.byteLength(candidate, "utf8") <=
    BCRYPT_REHASH_ELIGIBILITY_MAX_UTF8_BYTES
  );
}

/** New hashes are Argon2id at the locked profile. No pepper and no bcrypt. */
export async function hashPassword(password: string): Promise<string> {
  const options: Options = {
    // Argon2id. Numeric because the package exports a const enum.
    algorithm: 2,
    // PHC v=19 / 0x13.
    version: 1,
    memoryCost: ARGON2ID_MEMORY_KIB,
    timeCost: ARGON2ID_TIME_COST,
    parallelism: ARGON2ID_PARALLELISM,
    outputLen: ARGON2ID_TAG_BYTES,
  };
  return argon2Hash(password, options);
}

/**
 * Verify a stored password hash.
 * Accepted forms are bcrypt $2a$/$2b$/$2y$ and PHC $argon2id$.
 * Unknown, empty, malformed, $argon2i$, and $argon2d$ verifiers fail closed.
 * A verifier exception also fails closed. Success does not itself rewrite
 * the hash; opportunistic upgrade is a separate post-session step.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  try {
    if (typeof password !== "string" || typeof hash !== "string" || hash.length === 0) {
      return false;
    }
    if (BCRYPT_VERIFIER.test(hash)) {
      return await bcrypt.compare(password, hash);
    }
    if (parseArgon2idVerifier(hash)) {
      return await argon2Verify(hash, password);
    }
    return false;
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
