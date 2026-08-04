export type PasswordResetConfig = {
  ttlMinutes: number;
  cooldownSeconds: number;
  maxPerAccountPerHour: number;
};

function parseBoundedInteger(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${key}. Expected integer between ${min} and ${max}.`);
  }
  return parsed;
}

export function getPasswordResetConfig(): PasswordResetConfig {
  return {
    ttlMinutes: parseBoundedInteger(
      "PASSWORD_RESET_TOKEN_TTL_MINUTES",
      30,
      5,
      1440,
    ),
    cooldownSeconds: parseBoundedInteger(
      "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
      60,
      10,
      3600,
    ),
    maxPerAccountPerHour: parseBoundedInteger(
      "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
      5,
      1,
      100,
    ),
  };
}
