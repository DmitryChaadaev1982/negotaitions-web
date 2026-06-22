export function getAppName() {
  return process.env.APP_NAME?.trim() || "NegotAItions";
}

export function getAppUrl() {
  return process.env.APP_URL?.trim() || "http://localhost:3000";
}

export function getJoinUrl(joinToken: string) {
  return `${getAppUrl()}/join/${joinToken}`;
}
