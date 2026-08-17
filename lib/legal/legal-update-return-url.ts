import { sanitizeReturnUrl } from "@/lib/auth/return-url";
import { LEGAL_UPDATE_PATH } from "@/lib/legal/release";

const CREDENTIAL_QUERY_KEYS = new Set([
  "jointoken",
  "hosttoken",
  "participanttoken",
  "publicjoincode",
]);

const MAX_CREDENTIAL_NESTING = 3;

/**
 * True when a would-be return destination carries an invite/claim secret in
 * the path, a credential query key, or a nested internal path value such as
 * `returnUrl=/join/SECRET`. Those values must never be copied into
 * `/legal-update` or legal-document URLs.
 */
export function isCredentialBearingReturnUrl(pathWithQuery: string): boolean {
  return isCredentialBearingReturnUrlInner(pathWithQuery, 0);
}

function isCredentialBearingReturnUrlInner(
  pathWithQuery: string,
  depth: number,
): boolean {
  if (depth > MAX_CREDENTIAL_NESTING) return true;

  let parsed: URL;
  try {
    parsed = new URL(pathWithQuery, "https://internal.invalid");
  } catch {
    return true;
  }

  const pathname = parsed.pathname.toLowerCase();
  if (pathname === "/join" || pathname.startsWith("/join/")) return true;
  if (pathname === "/events/join" || pathname.startsWith("/events/join/")) {
    return true;
  }

  for (const key of parsed.searchParams.keys()) {
    if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) return true;
  }

  for (const value of parsed.searchParams.values()) {
    const nested = value.trim();
    if (
      nested.startsWith("/") &&
      isCredentialBearingReturnUrlInner(nested, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Origin-safe internal path that does not carry invite/claim credentials.
 * Shared by legal-update post-consent return and legal-document return.
 */
export function sanitizeNonCredentialReturnUrl(
  raw: string | null | undefined,
): string | null {
  const sanitized = sanitizeReturnUrl(raw);
  if (!sanitized) return null;
  if (isCredentialBearingReturnUrl(sanitized)) return null;
  return sanitized;
}

/**
 * Same origin-safe rules as `sanitizeReturnUrl`, plus rejection of
 * token-bearing join/lobby destinations. Credential-bearing values become
 * `null` so callers fall back to `/dashboard`.
 */
export function sanitizeLegalUpdateReturnUrl(
  raw: string | null | undefined,
): string | null {
  const sanitized = sanitizeNonCredentialReturnUrl(raw);
  if (!sanitized) return null;
  if (sanitized === LEGAL_UPDATE_PATH || sanitized.startsWith(`${LEGAL_UPDATE_PATH}?`)) {
    return null;
  }
  return sanitized;
}

export function buildLegalUpdateRedirectPath(
  returnUrl?: string | null,
): string {
  const safe = sanitizeLegalUpdateReturnUrl(returnUrl);
  if (!safe) return LEGAL_UPDATE_PATH;
  return `${LEGAL_UPDATE_PATH}?returnUrl=${encodeURIComponent(safe)}`;
}
