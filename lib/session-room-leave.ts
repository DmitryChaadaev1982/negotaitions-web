const SESSION_LEFT_FLAG_PREFIX = "negotiations.session-left:";

export function markSessionLeftFlag(sessionId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.setItem(`${SESSION_LEFT_FLAG_PREFIX}${sessionId}`, "1");
}

export function hasSessionLeftFlag(sessionId: string): boolean {
  if (typeof sessionStorage === "undefined") {
    return false;
  }
  return sessionStorage.getItem(`${SESSION_LEFT_FLAG_PREFIX}${sessionId}`) === "1";
}

export function clearSessionLeftFlag(sessionId: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  sessionStorage.removeItem(`${SESSION_LEFT_FLAG_PREFIX}${sessionId}`);
}

const sessionLeftSubscribe = () => () => {};

export function getSessionLeftFlagSnapshot(sessionId: string): boolean {
  return hasSessionLeftFlag(sessionId);
}

export { sessionLeftSubscribe };
