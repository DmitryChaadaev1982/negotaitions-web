/**
 * Post-login redirect target validation.
 *
 * A `returnUrl` is only ever used for an internal redirect, so it is resolved
 * against an opaque canonical internal origin and accepted only when the
 * resolved origin is unchanged. Prefix checks alone are not sufficient: a path
 * such as `/\example.com` is normalised by browsers into a scheme-relative
 * authority and would leave the trusted origin.
 */

const CANONICAL_INTERNAL_ORIGIN = "https://internal.invalid";
const MAX_RETURN_URL_LENGTH = 2048;
const MAX_DECODE_PASSES = 3;

// C0/C1 controls plus every Unicode whitespace form a browser may strip.
const FORBIDDEN_CHARACTERS =
  /[\u0000-\u0020\u007F-\u009F\u00A0\u1680\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF]/;

/**
 * Repeatedly decodes so that encoded separators such as `%2f%2f` or `%5c`
 * cannot hide an authority behind the leading slash. Malformed encoding is
 * rejected rather than tolerated.
 */
function fullyDecode(value: string): string | null {
  let current = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

export function sanitizeReturnUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_RETURN_URL_LENGTH) return null;
  if (FORBIDDEN_CHARACTERS.test(value)) return null;
  if (value.includes("\\")) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Malformed percent-encoding anywhere is rejected rather than tolerated,
  // because different normalisers disagree about how to repair it.
  if (fullyDecode(value) === null) return null;

  let resolved: URL;
  try {
    resolved = new URL(value, CANONICAL_INTERNAL_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== CANONICAL_INTERNAL_ORIGIN) return null;
  if (resolved.username || resolved.password) return null;

  // The path is the only part a browser can reinterpret as an authority, so it
  // is checked after full decoding. Query and fragment keep their encoding:
  // `?q=a%20b` is legitimate and must survive.
  const decodedPath = fullyDecode(resolved.pathname);
  if (decodedPath === null) return null;
  if (FORBIDDEN_CHARACTERS.test(decodedPath)) return null;
  if (!decodedPath.startsWith("/")) return null;
  // Rejects `//host`, `/\host`, and their encoded variants such as `/%2f%2f`.
  if (/^\/[/\\]/.test(decodedPath) || decodedPath.includes("\\")) return null;

  // Rebuild from the resolved components so only a normalised internal path,
  // query string, and fragment survive.
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

export function isSafeReturnUrl(raw: string | null | undefined): boolean {
  return sanitizeReturnUrl(raw) !== null;
}
