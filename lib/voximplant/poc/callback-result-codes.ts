/**
 * Sanitized POC callback result codes (flag-gated route only).
 * Never include secrets, signatures, raw headers, or capability URLs.
 */
export const POC_CALLBACK_RESULT_CODES = [
  "POC_CALLBACK_DISABLED",
  "CALLBACK_SECRET_MISSING",
  "INVALID_CALLBACK_SIGNATURE",
  "CALLBACK_TIMESTAMP_EXPIRED",
  "CALLBACK_NONCE_REPLAYED",
  "CALLBACK_PAYLOAD_INVALID",
  "CALLBACK_STATE_WRITE_FAILED",
  "CALLBACK_ACCEPTED",
  "POC_STATE_MISSING",
  "METHOD_NOT_ALLOWED",
] as const;

export type PocCallbackResultCode = (typeof POC_CALLBACK_RESULT_CODES)[number];

const VERIFY_ERROR_MAP: Record<string, PocCallbackResultCode> = {
  invalid_signature: "INVALID_CALLBACK_SIGNATURE",
  expired_timestamp: "CALLBACK_TIMESTAMP_EXPIRED",
  replayed_nonce: "CALLBACK_NONCE_REPLAYED",
  unknown_event_type: "CALLBACK_PAYLOAD_INVALID",
  unsupported_version: "CALLBACK_PAYLOAD_INVALID",
  missing_operation_id: "CALLBACK_PAYLOAD_INVALID",
  missing_nonce: "CALLBACK_PAYLOAD_INVALID",
  missing_signature: "INVALID_CALLBACK_SIGNATURE",
  invalid_timestamp: "CALLBACK_PAYLOAD_INVALID",
  body_hash_mismatch: "INVALID_CALLBACK_SIGNATURE",
  invalid_json: "CALLBACK_PAYLOAD_INVALID",
  invalid_payload: "CALLBACK_PAYLOAD_INVALID",
  unexpected_scenario_identity: "CALLBACK_PAYLOAD_INVALID",
  poc_state_missing: "POC_STATE_MISSING",
  poc_callback_disabled: "POC_CALLBACK_DISABLED",
  callback_secret_not_configured: "CALLBACK_SECRET_MISSING",
};

export function mapCallbackErrorCode(raw: string): PocCallbackResultCode {
  if ((POC_CALLBACK_RESULT_CODES as readonly string[]).includes(raw)) {
    return raw as PocCallbackResultCode;
  }
  return VERIFY_ERROR_MAP[raw] ?? "CALLBACK_PAYLOAD_INVALID";
}
