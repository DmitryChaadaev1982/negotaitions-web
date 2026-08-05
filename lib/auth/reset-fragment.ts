const TOKEN_SHAPE = /^[a-f0-9]{64}$/i;

/**
 * Parse a previously copied URL fragment. Exactly one field is accepted and it
 * must be one non-empty token parameter. Callers must scrub the live fragment
 * before invoking this function.
 */
export function parseResetTokenFragment(rawFragment: string): string | null {
  const encoded = rawFragment.startsWith("#")
    ? rawFragment.slice(1)
    : rawFragment;
  if (!encoded) return null;

  try {
    const params = new URLSearchParams(encoded);
    const entries = [...params.entries()];
    if (entries.length !== 1 || entries[0]?.[0] !== "token") return null;
    const token = entries[0][1];
    if (!token || !TOKEN_SHAPE.test(token)) return null;
    return token.toLowerCase();
  } catch {
    return null;
  }
}
