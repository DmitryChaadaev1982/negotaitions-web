export function getAppName() {
  return process.env.APP_NAME?.trim() || "NegotAItions";
}

export function getAppUrl() {
  return process.env.APP_URL?.trim() || "http://localhost:3000";
}

export function getJoinUrl(joinToken: string) {
  return `${getAppUrl()}/join/${joinToken}`;
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
  return `${getAppUrl()}/events/${eventId}/lobby?${params.toString()}`;
}
