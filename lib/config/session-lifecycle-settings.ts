import {
  parseServerRuntimeSetting,
  readServerRuntimeSettingRaw,
} from "@/lib/config/server-runtime-settings";

export const DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS = 60_000;
export const DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS = 7_200_000;
export const DEFAULT_SESSION_ABANDONED_CLOSE_MS = 10_800_000;

export type SessionLifecycleDurations = {
  debriefEmptyCloseMs: number;
  debriefMaxDurationMs: number;
  abandonedCloseMs: number;
};

function readEmptyCloseMs(): number {
  try {
    const parsed = parseServerRuntimeSetting("SESSION_DEBRIEF_EMPTY_CLOSE_MS");
    return typeof parsed === "number"
      ? parsed
      : DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS;
  } catch {
    return DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS;
  }
}

function readLegacyEmptyCloseMs(): number {
  try {
    const parsed = parseServerRuntimeSetting("DEBRIEF_AUTO_CLOSE_GRACE_MS");
    return typeof parsed === "number"
      ? parsed
      : DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS;
  } catch {
    return DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS;
  }
}

/**
 * Empty-Debrief business timeout.
 *
 * Precedence is deterministic and non-ambiguous:
 * 1. `SESSION_DEBRIEF_EMPTY_CLOSE_MS` wins when explicitly set
 *    (including when invalid — fail-closed to the default, never the alias).
 * 2. Legacy `DEBRIEF_AUTO_CLOSE_GRACE_MS` supplies a value only when the
 *    canonical variable is absent.
 * 3. Otherwise the reviewed default is 60_000.
 */
export function getSessionDebriefEmptyCloseMs(): number {
  if (readServerRuntimeSettingRaw("SESSION_DEBRIEF_EMPTY_CLOSE_MS")) {
    return readEmptyCloseMs();
  }
  if (readServerRuntimeSettingRaw("DEBRIEF_AUTO_CLOSE_GRACE_MS")) {
    return readLegacyEmptyCloseMs();
  }
  return DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS;
}

export function getSessionDebriefMaxDurationMs(): number {
  try {
    const parsed = parseServerRuntimeSetting("SESSION_DEBRIEF_MAX_DURATION_MS");
    return typeof parsed === "number"
      ? parsed
      : DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS;
  } catch {
    return DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS;
  }
}

export function getSessionAbandonedCloseMs(): number {
  try {
    const parsed = parseServerRuntimeSetting("SESSION_ABANDONED_CLOSE_MS");
    return typeof parsed === "number"
      ? parsed
      : DEFAULT_SESSION_ABANDONED_CLOSE_MS;
  } catch {
    return DEFAULT_SESSION_ABANDONED_CLOSE_MS;
  }
}

export function getSessionLifecycleDurations(): SessionLifecycleDurations {
  return {
    debriefEmptyCloseMs: getSessionDebriefEmptyCloseMs(),
    debriefMaxDurationMs: getSessionDebriefMaxDurationMs(),
    abandonedCloseMs: getSessionAbandonedCloseMs(),
  };
}
