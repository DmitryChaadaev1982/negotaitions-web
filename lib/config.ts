export function getAppName() {
  return process.env.APP_NAME?.trim() || "NegotAItions";
}

export function getAppUrl() {
  return process.env.APP_URL?.trim() || "http://localhost:3000";
}

export function buildSessionMaterialsPath(joinToken: string) {
  return `/join/${joinToken}`;
}

export function buildSessionMaterialsUrl(joinToken: string) {
  return `${getAppUrl()}${buildSessionMaterialsPath(joinToken)}`;
}

/** @deprecated Use buildSessionMaterialsUrl */
export function getJoinUrl(joinToken: string) {
  return buildSessionMaterialsUrl(joinToken);
}

export function buildSessionRoomPath(sessionId: string, joinToken: string) {
  const params = new URLSearchParams({ joinToken });
  return `/room/${sessionId}?${params.toString()}`;
}

export function buildSessionRoomUrl(sessionId: string, joinToken: string) {
  return `${getAppUrl()}${buildSessionRoomPath(sessionId, joinToken)}`;
}

export function getEventJoinUrl(eventId: string) {
  return `${getAppUrl()}/events/${eventId}/join`;
}

export function getEventPublicJoinUrl(publicJoinCode: string) {
  return `${getAppUrl()}/events/join/${publicJoinCode}`;
}

export function getEventLobbyUrl(
  eventId: string,
  token: { hostToken?: string; participantToken?: string },
) {
  const params = new URLSearchParams();
  if (token.hostToken) {
    params.set("hostToken", token.hostToken);
  }
  if (token.participantToken) {
    params.set("participantToken", token.participantToken);
  }
  const query = params.toString();
  return `/events/${eventId}/lobby${query ? `?${query}` : ""}`;
}
