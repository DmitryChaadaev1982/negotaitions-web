/**
 * Stage 3.12B-W1 — which ways of leaving a Session room are deliberate.
 *
 * Presence in an Event is derived from `SessionRoomConnection`, and that row has
 * exactly two ways to stop being active:
 *
 * - `EXPLICIT_LEAVE` — the participant used a product action that means "I am
 *   leaving this room". The server writes `disconnectedAt` at that moment, so
 *   the Event lobby shows `TEMPORARILY_AWAY` on its next poll and reaches
 *   `OFFLINE` one grace period after the real departure.
 * - `LEASE_EXPIRY` — the participant vanished without saying so. No terminal
 *   timestamp exists, and the only durable evidence is the heartbeat lease, so
 *   presence necessarily follows `expiresAt`.
 *
 * The second list must stay a list. Treating route unmount as an intentional
 * leave would turn a refresh into a departure and break rejoin, so unmount is
 * deliberately absent from both sides: it is not a product action, and it is
 * covered by the lease.
 */

/** Product actions that deliberately exit the Session room. */
export const SESSION_EXIT_ACTIONS = [
  "event-lobby",
  "dashboard",
  "sessions-overview",
  "session-materials",
  "rejoin",
  "leave-room",
] as const;

export type SessionExitAction = (typeof SESSION_EXIT_ACTIONS)[number];

/** Ways presence ends without the participant asking to leave. */
export const SESSION_DISAPPEARANCE_EVENTS = [
  "page-refresh",
  "tab-close",
  "browser-crash",
  "network-loss",
  "device-sleep",
  "route-unmount",
] as const;

export type SessionDisappearanceEvent =
  (typeof SESSION_DISAPPEARANCE_EVENTS)[number];

export type SessionExitTrigger = SessionExitAction | SessionDisappearanceEvent;

export type SessionExitDisposition = "EXPLICIT_LEAVE" | "LEASE_EXPIRY";

/** Fixed destinations of the room's non-contextual exits. */
export const SESSION_EXIT_DESTINATIONS = {
  dashboard: "/dashboard",
  sessionsOverview: "/sessions",
  rejoin: "/rejoin",
} as const;

export function isSessionExitAction(
  trigger: SessionExitTrigger,
): trigger is SessionExitAction {
  return (SESSION_EXIT_ACTIONS as readonly string[]).includes(trigger);
}

/**
 * How a given way of leaving must terminate the room connection. Exhaustive by
 * construction: anything not on the intentional list falls back to the lease.
 */
export function resolveSessionExitDisposition(
  trigger: SessionExitTrigger,
): SessionExitDisposition {
  return isSessionExitAction(trigger) ? "EXPLICIT_LEAVE" : "LEASE_EXPIRY";
}
