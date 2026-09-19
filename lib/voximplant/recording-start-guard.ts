export function shouldSkipStartRelayForStatus(
  status: string | null | undefined,
): boolean {
  return status === "STARTING" || status === "RECORDING";
}

/**
 * Layer-3 media/conference recovery must never dispatch recording START or STOP.
 * Duplicate-start prevention for STARTING/RECORDING remains the live control path.
 */
export const LAYER3_RECOVERY_MUST_NOT_DISPATCH_RECORDING = {
  start: false,
  stop: false,
} as const;
