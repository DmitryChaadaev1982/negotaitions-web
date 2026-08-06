import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

export type PasswordResetConfig = {
  ttlMinutes: number;
  cooldownSeconds: number;
  maxPerAccountPerHour: number;
};

export function getPasswordResetConfig(): PasswordResetConfig {
  return {
    ttlMinutes: parseServerRuntimeSetting(
      "PASSWORD_RESET_TOKEN_TTL_MINUTES",
    ) as number,
    cooldownSeconds: parseServerRuntimeSetting(
      "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
    ) as number,
    maxPerAccountPerHour: parseServerRuntimeSetting(
      "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
    ) as number,
  };
}
