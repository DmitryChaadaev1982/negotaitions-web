import { createHash } from "node:crypto";

/**
 * Sanitized fingerprint for a media session control URL.
 * Never returns or logs the full URL.
 */
export function fingerprintControlUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "empty";

  let host = "unknown-host";
  let pathHint = "";
  try {
    const parsed = new URL(trimmed);
    host = parsed.host || "unknown-host";
    const segments = parsed.pathname.split("/").filter(Boolean);
    pathHint = segments.length > 0 ? segments[0]!.slice(0, 12) : "";
  } catch {
    host = "invalid-url";
  }

  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  return pathHint
    ? `sha256:${digest}@${host}/${pathHint}…`
    : `sha256:${digest}@${host}`;
}

/** Redact known control-URL fields from arbitrary objects before logging. */
export function redactControlUrlFields<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/media[_-]?session[_-]?access/i.test(value) || /\/session\//i.test(value)) {
      return fingerprintControlUrl(value) as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactControlUrlFields(item)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (
        /mediaSessionAccess|media_session_access|controlUrl|control_url/i.test(key) &&
        typeof nested === "string"
      ) {
        out[key] = fingerprintControlUrl(nested);
        out[`${key}Fingerprint`] = fingerprintControlUrl(nested);
      } else {
        out[key] = redactControlUrlFields(nested);
      }
    }
    return out as T;
  }
  return value;
}
