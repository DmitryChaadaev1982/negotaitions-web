import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Current new-password hash. Verification does not rehash or bump credentials. */
export const PASSWORD_HASH_ALGORITHM = "bcrypt" as const;
export const PASSWORD_BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_BCRYPT_COST);
}

/**
 * Verify a stored password hash.
 * Existing bcrypt hashes verify, including cost 10 and cost 12.
 * Success does not rewrite the hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
