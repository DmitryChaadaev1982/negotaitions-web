/**
 * Deterministic provider-fault seam for the room/lobby media handoff tests.
 *
 * Real Voximplant transport failures cannot be produced on demand, and the
 * reverse tunnel that exposed this defect is not available in CI. This seam
 * replaces only the provider transport operations with scripted outcomes; the
 * route navigation, explicit-leave state machine, React lifecycle, lobby shell,
 * retry coordinator, error classification and connection-status UI all stay
 * under test.
 *
 * It is inert unless the server is running with `EXTERNAL_SERVICES_MODE=mock`,
 * which only the E2E Playwright web server sets. Nothing here is reachable from
 * a browser query parameter.
 */

export const VOX_PROVIDER_FAULT_MODES = [
  "off",
  "transport-408",
  "gateway-unavailable",
  "ice-restart-timeout",
  "delayed-connect",
  "delayed-disconnect",
  "terminal-auth",
  "recover-after-first-failure",
  "gateway-ws-close-connected",
  "healthy-media",
  "media-acquisition",
] as const;

export type VoxProviderFaultMode = (typeof VOX_PROVIDER_FAULT_MODES)[number];

/**
 * The gateway-close line captured verbatim from a Session that had been sitting
 * in `DEBRIEF_OPEN` long enough for the WebSDK's gateway socket to drop.
 *
 * The transport id is the only part that varies between occurrences. The
 * trailing payload is the browser event the SDK serialized: `CloseEvent`
 * exposes `code`, `reason` and `wasClean` as prototype accessors, so
 * `JSON.stringify` keeps only `isTrusted`. Classification is asserted against
 * this exact string so it can never drift from what the SDK really emits.
 */
export const GATEWAY_WEBSOCKET_CLOSE_SDK_LOG =
  '[WEBSDK] [GW Transport] WS transport 1f4c9a20-7d33-4c31-9a6f-2b0f8f0c6d51 closed with error {"isTrusted":true}';

export function isVoxProviderFaultMode(value: unknown): value is VoxProviderFaultMode {
  return (
    typeof value === "string" &&
    (VOX_PROVIDER_FAULT_MODES as readonly string[]).includes(value)
  );
}

/**
 * Message templates copied verbatim from the WebSDK output captured on the
 * reported transition, so classification is exercised against real strings.
 */
const SYNTHETIC_MESSAGES: Record<string, string> = {
  "transport-408":
    "[WEBSDK] [Connection] Transport creation failed with error TransportTimeoutError: Transport establishing failed with code 408. Rejected due to time",
  "gateway-unavailable":
    "[WEBSDK] [Connection] ConnectionNetworkError: Failed to connect to gateway. No transport established",
  "ice-restart-timeout":
    '[WEBSDK] [ReInviteQueue_conference_simulated] Action failed: actionName: "IceRestartAction" reason: Action run failed to timeout',
  "terminal-auth": "[WEBSDK] [Login] AuthError: invalid one time key",
  // The recovery scenario must fail with a genuinely retryable transport error.
  "recover-after-first-failure":
    "[WEBSDK] [Connection] Transport creation failed with error TransportTimeoutError: Transport establishing failed with code 408. Rejected due to time",
  "gateway-ws-close-connected": GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
};

export function createSyntheticProviderError(mode: VoxProviderFaultMode): Error {
  const message = SYNTHETIC_MESSAGES[mode] ?? `[WEBSDK] [Connection] Simulated fault: ${mode}`;
  return new Error(message);
}

export type VoxProviderFaultPlan = {
  mode: VoxProviderFaultMode;
  /** Attempts that must fail before the stub reports a connection. */
  failingAttempts: number;
  /** Artificial latency applied before the connect step resolves. */
  connectDelayMs: number;
  /** Artificial latency applied to the teardown of the previous surface. */
  disconnectDelayMs: number;
  /** True when the plan can never reach a connected state. */
  alwaysFails: boolean;
};

export function resolveVoxProviderFaultPlan(
  mode: VoxProviderFaultMode,
): VoxProviderFaultPlan {
  const base: VoxProviderFaultPlan = {
    mode,
    failingAttempts: 0,
    connectDelayMs: 0,
    disconnectDelayMs: 0,
    alwaysFails: false,
  };

  switch (mode) {
    case "off":
    // The gateway-close scenario replays an SDK log line into an already
    // running room; it scripts no connect outcome of its own.
    case "gateway-ws-close-connected":
    case "healthy-media":
    case "media-acquisition":
      return base;
    case "transport-408":
    case "gateway-unavailable":
    case "ice-restart-timeout":
      // Recoverable classes: fail the whole bounded budget so the surface must
      // stay usable and end in a controlled degraded/terminal state.
      return { ...base, alwaysFails: true };
    case "terminal-auth":
      return { ...base, alwaysFails: true };
    case "recover-after-first-failure":
      return { ...base, failingAttempts: 1 };
    case "delayed-connect":
      return { ...base, connectDelayMs: 1500 };
    case "delayed-disconnect":
      return { ...base, disconnectDelayMs: 2500 };
  }
}

/** True when this attempt must throw the scripted provider error. */
export function shouldFailAttempt(plan: VoxProviderFaultPlan, attempt: number): boolean {
  if (plan.mode === "off") return false;
  if (plan.alwaysFails) return true;
  return attempt <= plan.failingAttempts;
}
