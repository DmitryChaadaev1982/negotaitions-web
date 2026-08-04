import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_HEX_LENGTH = TOKEN_BYTES * 2;

export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function isPasswordResetTokenShape(value: string): boolean {
  return value.length === TOKEN_HEX_LENGTH && /^[a-f0-9]+$/i.test(value);
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
