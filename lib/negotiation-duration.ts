export const DEFAULT_NEGOTIATION_DURATION_SECONDS = 900;

export const MIN_NEGOTIATION_DURATION_MINUTES = 1;
export const MAX_NEGOTIATION_DURATION_MINUTES = 180;

export function minutesToSeconds(minutes: number) {
  return minutes * 60;
}

export function secondsToDisplayMinutes(seconds: number) {
  return Math.round(seconds / 60);
}

export function formatSecondsAsMmSs(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function resolveDefaultDurationSeconds(
  caseDefaultSeconds: number | null | undefined,
) {
  if (
    typeof caseDefaultSeconds === "number" &&
    caseDefaultSeconds >= minutesToSeconds(MIN_NEGOTIATION_DURATION_MINUTES)
  ) {
    return caseDefaultSeconds;
  }

  return DEFAULT_NEGOTIATION_DURATION_SECONDS;
}

export function resolveSessionDurationSeconds(
  sessionSeconds: number | null | undefined,
  caseDefaultSeconds: number | null | undefined,
) {
  if (
    typeof sessionSeconds === "number" &&
    sessionSeconds >= minutesToSeconds(MIN_NEGOTIATION_DURATION_MINUTES)
  ) {
    return sessionSeconds;
  }

  return resolveDefaultDurationSeconds(caseDefaultSeconds);
}
