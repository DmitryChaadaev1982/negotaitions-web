import { fingerprintControlUrl } from "@/lib/voximplant/poc/url-fingerprint";

const CAPABILITY_URL_KEYS = new Set([
  "accessurl",
  "accesssecureurl",
  "mediasessionaccessurl",
  "mediasessionaccesssecureurl",
  "media_session_access_url",
  "media_session_access_secure_url",
  "controlurl",
  "control_url",
]);

const SIGNATURE_KEYS = new Set([
  "signature",
  "x-neg-poc-signature",
  "x-neg-poc-callback-signature",
  "x-voximplant-signature",
]);

const HEADER_MAP_KEYS = new Set([
  "headers",
  "requestheaders",
  "responseheaders",
  "header",
]);

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function looksLikeCapabilityUrl(value: string): boolean {
  if (/media[_-]?session[_-]?access/i.test(value)) return true;
  if (/\/session\//i.test(value) && /^https?:\/\//i.test(value)) return true;
  if (/accessSecureURL|accessURL/i.test(value)) return true;
  return false;
}

function redactString(value: string): string {
  if (looksLikeCapabilityUrl(value)) {
    return fingerprintControlUrl(value);
  }
  // Hex HMAC signatures are typically 64 chars.
  if (/^[a-f0-9]{64}$/i.test(value.trim())) {
    return "[redacted-signature]";
  }
  return value;
}

/**
 * Sanitize Voximplant / POC diagnostic objects before logging.
 *
 * Never paste raw Application.Started events: they contain accessURL and
 * accessSecureURL. Redact both capability URLs (fingerprint only), signatures,
 * and complete header maps.
 */
export function sanitizePocDiagnosticLog<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return redactString(value) as unknown as T;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePocDiagnosticLog(item)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const norm = normalizeKey(key);
      if (HEADER_MAP_KEYS.has(norm)) {
        out[key] = "[redacted-header-map]";
        continue;
      }
      if (SIGNATURE_KEYS.has(norm) || norm.endsWith("signature")) {
        out[key] = "[redacted-signature]";
        continue;
      }
      if (CAPABILITY_URL_KEYS.has(norm) && typeof nested === "string") {
        const fp = fingerprintControlUrl(nested);
        out[key] = fp;
        out[`${key}Fingerprint`] = fp;
        continue;
      }
      // Nested Application.Started-like shapes often use camelCase accessURL.
      if (
        (norm === "accessurl" || norm === "accesssecureurl") &&
        typeof nested === "string"
      ) {
        out[key] = fingerprintControlUrl(nested);
        continue;
      }
      out[key] = sanitizePocDiagnosticLog(nested);
    }
    return out as T;
  }
  return value;
}

/**
 * Fixture matching the structure observed in a real Voximplant
 * Application.Started log (capability URLs present).
 */
export function buildObservedApplicationStartedLogFixture(params: {
  accessURL: string;
  accessSecureURL: string;
  conferenceName?: string;
}): Record<string, unknown> {
  return {
    name: "Application.Started",
    accessURL: params.accessURL,
    accessSecureURL: params.accessSecureURL,
    conferenceName: params.conferenceName ?? "neg-poc-server-stop-1",
    headers: {
      "Content-Type": "application/json",
      "X-Neg-Poc-Signature": "a".repeat(64),
      Authorization: "Bearer should-not-leak",
    },
    signature: "b".repeat(64),
  };
}
