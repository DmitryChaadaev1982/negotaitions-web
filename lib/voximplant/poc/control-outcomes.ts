/**
 * Typed POC control / evidence outcomes.
 *
 * HTTP 2xx on media_session_access_secure_url means TRANSPORT_ACCEPTED only.
 * It does not mean scenario identity verified, command executed, recorder
 * stopped, or provider terminal state reached.
 */

export const POC_TRANSPORT_OUTCOMES = [
  "TRANSPORT_ACCEPTED",
  "TRANSPORT_REJECTED",
  "TRANSPORT_TIMEOUT",
  "MEDIA_SESSION_EXPIRED",
] as const;

export type PocTransportOutcome = (typeof POC_TRANSPORT_OUTCOMES)[number];

export const POC_COMMAND_OUTCOMES = [
  "COMMAND_ACCEPTED",
  "COMMAND_REJECTED",
  "PROVIDER_TERMINAL",
] as const;

export type PocCommandOutcome = (typeof POC_COMMAND_OUTCOMES)[number];

export const POC_PING_OUTCOMES = [
  "PING_COMMAND_CONFIRMED",
  "PING_CALLBACK_TIMEOUT",
  "PING_CALLBACK_REJECTED",
  /** Transport-only diagnostic (--no-wait). Explicitly non-terminal. */
  "PING_TRANSPORT_ONLY",
] as const;

export type PocPingOutcome = (typeof POC_PING_OUTCOMES)[number];

export function isHttpTransportAccepted(status: number | null): boolean {
  return status != null && status >= 200 && status < 300;
}
