import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

/**
 * Bounded response-time floor for public forgot-password intake.
 *
 * Perfect network-level timing equality is impossible; this only prevents
 * branch-specific work from being directly reflected in response duration
 * under ordinary conditions. The floor is short to avoid amplifying DoS.
 */

export type TimingFloorSleeper = (ms: number) => Promise<void>;

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getForgotPasswordTimingFloorMs(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  return parseServerRuntimeSetting(
    "PASSWORD_RESET_RESPONSE_FLOOR_MS",
    env,
  ) as number;
}

export async function withResponseTimingFloor<T>(params: {
  floorMs: number;
  startedAtMs: number;
  operation: () => Promise<T>;
  sleep?: TimingFloorSleeper;
  now?: () => number;
}): Promise<T> {
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? Date.now;
  try {
    return await params.operation();
  } finally {
    const elapsed = now() - params.startedAtMs;
    const remaining = Math.max(0, params.floorMs - elapsed);
    if (remaining > 0) {
      await sleep(remaining);
    }
  }
}
