/**
 * Room authentication token type for VideoRoomPage and all room APIs.
 *
 * Phase 6.4.1: guest access is fully closed. The only supported runtime identity
 * is account mode (authenticated user + httpOnly session cookie).
 *
 * For ACCOUNT users (logged in via httpOnly session cookie):
 *   { type: "account", participantId: string }
 *   - participantId is a non-secret DB record UUID — safe to embed in client HTML
 *   - Authentication is via the httpOnly cookie + DB ownership check server-side
 *   - joinToken is NEVER exposed in HTML, props, or URL
 *
 * { type: "joinToken" } is retained as a type variant for backward compatibility
 * with any in-flight requests from previously cached clients, but all server-side
 * handlers now require an authenticated user even when joinToken is provided.
 * No new UI code should produce a "joinToken" auth token.
 *
 * Phase 5/6 rule: For account users, never put joinToken in:
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
