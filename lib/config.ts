const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_PUBLIC_INVITE_URL = "https://negotaitions.ru";

function toParsedUrl(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function isLocalOrLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("127.")) {
    return true;
  }
  return false;
}

function resolveSafePublicInviteOrigin(raw: string | null | undefined) {
  const parsed = toParsedUrl(raw);
  if (!parsed) {
    return null;
  }
  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    return null;
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return null;
  }
  if (isLocalOrLoopbackHostname(parsed.hostname)) {
    return null;
  }
  return parsed.origin;
}

export function getAppName() {
  return process.env.APP_NAME?.trim() || "NegotAItions";
}

export function getAppUrl() {
  return process.env.APP_URL?.trim() || DEFAULT_APP_URL;
}

export function getPublicAppUrl() {
  const configuredOrigin =
    resolveSafePublicInviteOrigin(process.env.APP_URL) ??
    resolveSafePublicInviteOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    resolveSafePublicInviteOrigin(process.env.EMAIL_CANONICAL_BASE_URL);
  return configuredOrigin ?? DEFAULT_PUBLIC_INVITE_URL;
}

export function buildSessionMaterialsPath(joinToken: string) {
  return `/join/${joinToken}`;
}

export function buildAccountSessionMaterialsPath(sessionId: string) {
  return `/sessions/${sessionId}/materials`;
}

export function buildAccountObserverSessionMaterialsPath(sessionId: string) {
  return `/sessions/${sessionId}/observer-materials`;
}

export function buildSessionMaterialsUrl(joinToken: string) {
  return `${getPublicAppUrl()}${buildSessionMaterialsPath(joinToken)}`;
}

/** @deprecated Use buildSessionMaterialsUrl */
export function getJoinUrl(joinToken: string) {
  return buildSessionMaterialsUrl(joinToken);
}

export function buildSessionRoomPath(sessionId: string, joinToken: string) {
  const params = new URLSearchParams({ joinToken });
  return `/room/${sessionId}?${params.toString()}`;
}

export function buildAccountSessionRoomPath(sessionId: string) {
  return `/room/${sessionId}`;
}

export function buildSessionRoomUrl(sessionId: string, joinToken: string) {
  return `${getAppUrl()}${buildSessionRoomPath(sessionId, joinToken)}`;
}

export function getEventJoinUrl(eventId: string) {
  return `${getPublicAppUrl()}/events/${eventId}/join`;
}

export function getEventPublicJoinUrl(publicJoinCode: string) {
  return `${getPublicAppUrl()}/events/join/${publicJoinCode}`;
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
