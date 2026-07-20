/**
 * Typed browser join stages and failure codes for the server-stop POC.
 * Never include tokens, cookies, or capability URLs in stage payloads.
 */

export const BROWSER_STAGES = [
  "BROWSER_NOT_LAUNCHED",
  "BROWSER_LAUNCHED",
  "AUTH_CONTEXT_CREATED",
  "AUTH_ACCEPTED",
  "ROOM_NAVIGATION_STARTED",
  "ROOM_PAGE_LOADED",
  "ACCESS_REQUEST_SENT",
  "ACCESS_REQUEST_SUCCEEDED",
  "POC_CONFERENCE_SELECTED",
  "VOX_SDK_INITIALIZED",
  "VOX_LOGIN_SUCCEEDED",
  "CALL_STARTED",
  "CALL_CONNECTED",
  "CONFERENCE_JOINED",
  "JOIN_CONFIRMED",
] as const;

export type BrowserStage = (typeof BROWSER_STAGES)[number];

export type BrowserFailureCode =
  | "BROWSER_JOIN_FAILED"
  | "BROWSER_PREWARM_FAILED"
  | "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS"
  | "MEDIA_SESSION_EXPIRED_DURING_JOIN"
  | "ACCESS_SELECTED_DEFAULT_CONFERENCE"
  | "BROWSER_AUTH_FAILED"
  | "ROOM_PAGE_FAILED"
  | "ACCESS_ROUTE_FAILED"
  | "ACCESS_ROUTE_UNAUTHORIZED"
  | "ACCESS_ROUTE_FORBIDDEN"
  | "ACCESS_ROUTE_NOT_FOUND"
  | "ACCESS_ROUTE_SERVER_ERROR"
  | "VOX_SDK_INIT_FAILED"
  | "VOX_LOGIN_FAILED"
  | "VOX_CALL_FAILED"
  | "VOX_CALL_TIMEOUT"
  | "CONFERENCE_JOIN_TIMEOUT"
  | "MEDIA_PERMISSION_FAILED"
  | "FACILITATOR_AUTH_FAILED"
  | "PARTICIPANT_AUTH_FAILED";

export type BrowserRole = "facilitator" | "participant";

export type AccessSelectionEvidence = {
  requestPath: string;
  httpStatus: number | null;
  applicationErrorCode: string | null;
  requestedSessionId: string;
  linkedSessionIdMatch: boolean | null;
  activeRunId: string | null;
  selectedConferenceName: string | null;
  selectionSource: "POC_STATE" | "DEFAULT_SESSION_NAME" | null;
  runtimeStatus: string | null;
  expiryDecision: "ACTIVE" | "EXPIRED" | "UNKNOWN" | null;
};

export type BrowserContextEvidence = {
  role: BrowserRole;
  reachedStage: BrowserStage;
  firstFailedStage: BrowserStage | null;
  failureCode: BrowserFailureCode | null;
  authAccepted: boolean;
  roomPageLoaded: boolean;
  accessRequested: boolean;
  access: AccessSelectionEvidence | null;
  pageUrlPath: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequestPaths: string[];
  mediaPermissionOk: boolean | null;
  sdkInitialized: boolean | null;
  callConnected: boolean | null;
  joined: boolean;
  accessRequestedAt: string | null;
  callConnectedAt: string | null;
};

export function stageIndex(stage: BrowserStage): number {
  return BROWSER_STAGES.indexOf(stage);
}

export function advanceStage(
  current: BrowserStage,
  next: BrowserStage,
): BrowserStage {
  return stageIndex(next) >= stageIndex(current) ? next : current;
}

export function emptyBrowserContextEvidence(
  role: BrowserRole,
  sessionId: string,
): BrowserContextEvidence {
  return {
    role,
    reachedStage: "BROWSER_NOT_LAUNCHED",
    firstFailedStage: null,
    failureCode: null,
    authAccepted: false,
    roomPageLoaded: false,
    accessRequested: false,
    access: {
      requestPath: `/api/sessions/${sessionId}/voximplant/access`,
      httpStatus: null,
      applicationErrorCode: null,
      requestedSessionId: sessionId,
      linkedSessionIdMatch: null,
      activeRunId: null,
      selectedConferenceName: null,
      selectionSource: null,
      runtimeStatus: null,
      expiryDecision: null,
    },
    pageUrlPath: null,
    consoleErrors: [],
    pageErrors: [],
    failedRequestPaths: [],
    mediaPermissionOk: null,
    sdkInitialized: null,
    callConnected: null,
    joined: false,
    accessRequestedAt: null,
    callConnectedAt: null,
  };
}

export function markFailed(
  evidence: BrowserContextEvidence,
  stage: BrowserStage,
  code: BrowserFailureCode,
): BrowserContextEvidence {
  return {
    ...evidence,
    reachedStage: evidence.reachedStage,
    firstFailedStage: evidence.firstFailedStage ?? stage,
    failureCode: evidence.failureCode ?? code,
  };
}

export function classifyAccessHttpStatus(
  status: number,
): BrowserFailureCode {
  if (status === 401) return "ACCESS_ROUTE_UNAUTHORIZED";
  if (status === 403) return "ACCESS_ROUTE_FORBIDDEN";
  if (status === 404) return "ACCESS_ROUTE_NOT_FOUND";
  if (status >= 500) return "ACCESS_ROUTE_SERVER_ERROR";
  return "ACCESS_ROUTE_FAILED";
}

export function classifyBrowserFailure(params: {
  facilitator: BrowserContextEvidence;
  participant: BrowserContextEvidence;
  mediaSessionExpiredBeforeAccess: boolean;
  mediaSessionExpiredDuringJoin: boolean;
}): BrowserFailureCode {
  if (params.mediaSessionExpiredBeforeAccess) {
    return "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS";
  }
  if (params.mediaSessionExpiredDuringJoin) {
    return "MEDIA_SESSION_EXPIRED_DURING_JOIN";
  }

  const codes = [
    params.facilitator.failureCode,
    params.participant.failureCode,
  ].filter(Boolean) as BrowserFailureCode[];

  if (codes.includes("FACILITATOR_AUTH_FAILED")) return "FACILITATOR_AUTH_FAILED";
  if (codes.includes("PARTICIPANT_AUTH_FAILED")) return "PARTICIPANT_AUTH_FAILED";
  if (codes.includes("BROWSER_AUTH_FAILED")) return "BROWSER_AUTH_FAILED";
  if (codes.includes("MEDIA_PERMISSION_FAILED")) return "MEDIA_PERMISSION_FAILED";
  if (codes.includes("ROOM_PAGE_FAILED")) return "ROOM_PAGE_FAILED";
  if (codes.includes("ACCESS_SELECTED_DEFAULT_CONFERENCE")) {
    return "ACCESS_SELECTED_DEFAULT_CONFERENCE";
  }
  if (codes.includes("ACCESS_ROUTE_UNAUTHORIZED")) return "ACCESS_ROUTE_UNAUTHORIZED";
  if (codes.includes("ACCESS_ROUTE_FORBIDDEN")) return "ACCESS_ROUTE_FORBIDDEN";
  if (codes.includes("ACCESS_ROUTE_NOT_FOUND")) return "ACCESS_ROUTE_NOT_FOUND";
  if (codes.includes("ACCESS_ROUTE_SERVER_ERROR")) return "ACCESS_ROUTE_SERVER_ERROR";
  if (codes.includes("ACCESS_ROUTE_FAILED")) return "ACCESS_ROUTE_FAILED";
  if (codes.includes("VOX_SDK_INIT_FAILED")) return "VOX_SDK_INIT_FAILED";
  if (codes.includes("VOX_LOGIN_FAILED")) return "VOX_LOGIN_FAILED";
  if (codes.includes("VOX_CALL_FAILED")) return "VOX_CALL_FAILED";
  if (codes.includes("VOX_CALL_TIMEOUT")) return "VOX_CALL_TIMEOUT";
  if (codes.includes("CONFERENCE_JOIN_TIMEOUT")) return "CONFERENCE_JOIN_TIMEOUT";
  return codes[0] ?? "BROWSER_JOIN_FAILED";
}

/** Sanitize a page URL to path + query keys only (no token values). */
export function sanitizePageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const keys = [...parsed.searchParams.keys()].sort();
    const redacted = keys.length
      ? `?${keys.map((k) => `${k}=[redacted]`).join("&")}`
      : "";
    return `${parsed.pathname}${redacted}`;
  } catch {
    return "/[invalid-url]";
  }
}

export function sanitizeConsoleMessage(message: string): string {
  return message
    .replace(/joinToken=[^&\s"']+/gi, "joinToken=[redacted]")
    .replace(/auth_session=[^;\s"']+/gi, "auth_session=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s"'<>]*\/request\/[^\s"'<>]+/gi, "[redacted-control-url]");
}
