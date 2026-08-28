/**
 * Ordinary managed Playwright validation must not inherit
 * VIDEO_PROVIDER=voximplant from the operator .env.
 *
 * Intentional live Vox runs opt in with PLAYWRIGHT_VIDEO_PROVIDER=voximplant.
 * Do not treat VIDEO_PROVIDER itself as the override — that is the leak.
 */
export const PLAYWRIGHT_VIDEO_PROVIDER_OVERRIDE_ENV =
  "PLAYWRIGHT_VIDEO_PROVIDER" as const;
export const MANAGED_PLAYWRIGHT_DEFAULT_VIDEO_PROVIDER = "livekit" as const;

export type ManagedPlaywrightVideoProvider = "livekit" | "voximplant";

export function resolveManagedPlaywrightVideoProvider(
  env: Record<string, string | undefined> = process.env,
): ManagedPlaywrightVideoProvider {
  const explicit = env[PLAYWRIGHT_VIDEO_PROVIDER_OVERRIDE_ENV]?.trim().toLowerCase();
  if (explicit === "voximplant") {
    return "voximplant";
  }
  return MANAGED_PLAYWRIGHT_DEFAULT_VIDEO_PROVIDER;
}
