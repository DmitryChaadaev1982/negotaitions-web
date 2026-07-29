export function shouldSkipStartRelayForStatus(
  status: string | null | undefined,
): boolean {
  return status === "STARTING" || status === "RECORDING";
}
