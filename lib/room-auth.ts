/**
 * Room authentication token type for VideoRoomPage and all room APIs.
 *
 * For ACCOUNT users (logged in via httpOnly session cookie):
 *   { type: "account", participantId: string }
 *   - participantId is a non-secret DB record UUID — safe to embed in client HTML
 *   - Authentication is via the httpOnly cookie + DB ownership check server-side
 *   - joinToken is NEVER exposed in HTML, props, or URL
 *
 * For GUEST users (token-based, no account):
 *   { type: "joinToken", value: string }
 *   - joinToken flow unchanged; token appears in URL and client props as before
 *
 * Phase 5 rule: For account users, never put joinToken in:
 *   - __NEXT_DATA__ / SSR HTML props
 *   - React component props (client components)
 *   - URL query string
 *   - localStorage or sessionStorage
 *   - Any data attribute or hidden script tag
 */
export type RoomAuthToken =
  | { type: "joinToken"; value: string }
  | { type: "account"; participantId: string };

/**
 * Build the JSON body fields for a POST/PATCH room API request.
 * Consumers spread this into their request body.
 */
export function roomAuthBody(
  auth: RoomAuthToken,
): Record<string, string> {
  if (auth.type === "joinToken") {
    return { joinToken: auth.value };
  }
  return { participantId: auth.participantId };
}

/**
 * Build the query-string suffix for a GET room API request.
 * Example: `?${roomAuthQuery(auth)}`
 */
export function roomAuthQuery(auth: RoomAuthToken): string {
  if (auth.type === "joinToken") {
    return `joinToken=${encodeURIComponent(auth.value)}`;
  }
  return `participantId=${encodeURIComponent(auth.participantId)}`;
}
