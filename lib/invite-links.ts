export function buildEventJoinPath(eventId: string) {
  return `/events/${eventId}/join`;
}

export function buildEventPublicJoinPath(publicJoinCode: string) {
  return `/events/join/${publicJoinCode}`;
}

export function buildBrowserInviteUrl(browserOrigin: string, invitationPath: string) {
  if (!invitationPath.startsWith("/") || invitationPath.startsWith("//")) {
    throw new Error("Invitation path must be root-relative");
  }

  return new URL(invitationPath, new URL(browserOrigin).origin).toString();
}
