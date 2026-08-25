/**
 * Bounded, sanitized Session-room provider recovery logs.
 * Never log tokens, access URLs, secrets, raw SDP, or credentials.
 */

export type ProviderRecoveryLogEvent =
  | "provider_disconnect"
  | "recovery_started"
  | "recovery_succeeded"
  | "recovery_failed"
  | "endpoint_resync";

export type ProviderRecoveryLogFields = {
  surface: string;
  sessionId?: string | null;
  generation: number;
  event: ProviderRecoveryLogEvent;
  classification?: string | null;
  reason?: string | null;
};

const SENSITIVE =
  /(token|secret|password|authorization|oneTimeKey|sdp|accessUrl|credential)/i;

export function formatProviderRecoveryLog(fields: ProviderRecoveryLogFields): string {
  const parts = [
    `surface=${fields.surface}`,
    fields.sessionId ? `sessionId=${fields.sessionId}` : null,
    `generation=${fields.generation}`,
    `event=${fields.event}`,
    fields.classification ? `classification=${fields.classification}` : null,
    fields.reason ? `reason=${sanitizeRecoveryReason(fields.reason)}` : null,
  ].filter((part): part is string => Boolean(part));
  return `[vox-provider-recovery] ${parts.join(" ")}`;
}

export function sanitizeRecoveryReason(reason: string): string {
  if (SENSITIVE.test(reason)) return "redacted";
  return reason.slice(0, 180);
}

export function logProviderRecovery(fields: ProviderRecoveryLogFields): void {
  console.info(formatProviderRecoveryLog(fields));
}
