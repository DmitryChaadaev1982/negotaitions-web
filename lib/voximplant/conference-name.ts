/**
 * Canonical Voximplant conference naming for the negotiation room.
 *
 * Runtime conference name format: negotiation-{sessionId}
 * All server-side builders and scenario parsers must use these helpers.
 */

export const VOXIMPLANT_CONFERENCE_NAME_PREFIX = "negotiation-";

/** Build the shared Voximplant conference name for a negotiation session. */
export function buildVoximplantConferenceName(sessionId: string): string {
  return `${VOXIMPLANT_CONFERENCE_NAME_PREFIX}${sessionId}`;
}

/**
 * Parse sessionId from a canonical Voximplant conference name.
 * Returns null when the name does not match the expected prefix.
 */
export function parseSessionIdFromVoximplantConferenceName(
  conferenceName: string,
): string | null {
  if (!conferenceName || typeof conferenceName !== "string") {
    return null;
  }
  if (!conferenceName.startsWith(VOXIMPLANT_CONFERENCE_NAME_PREFIX)) {
    return null;
  }
  const sessionId = conferenceName.slice(VOXIMPLANT_CONFERENCE_NAME_PREFIX.length);
  return sessionId || null;
}
