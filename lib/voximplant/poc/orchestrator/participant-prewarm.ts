/**
 * Canonical participant prewarm helpers (guest-closed invite-claim model).
 * joinToken is not a guest identity — requires the participant's own auth_session.
 */

import {
  buildUrlBoundAuthCookie,
  parseCookieHeader,
  redactBoundedErrorMessage,
} from "./browser-auth-cookie";
import {
  hasAuthSessionCookieHeader,
  isRawIdMistakenForAuthSession,
} from "./browser-auth-verify";
import { sanitizePageUrl, type BrowserFailureCode } from "./browser-stages";
import type { PocPrewarmFixture } from "./prewarm-fixture";

export type ParticipantPrewarmVerifyResult = {
  ok: boolean;
  failureCode: BrowserFailureCode | null;
  finalPagePath: string | null;
  finalHost: string | null;
  redirectToLogin: boolean;
  roomLoaded: boolean;
  durableAccountRoomUrl: string;
  boundedError: string | null;
};

export function extractJoinTokenFromRoomUrl(roomUrl: string): string | null {
  try {
    const parsed = new URL(roomUrl);
    const token = parsed.searchParams.get("joinToken")?.trim() ?? "";
    return token || null;
  } catch {
    return null;
  }
}

export function buildParticipantAccountRoomUrl(params: {
  appBaseUrl: string;
  sessionId: string;
}): string {
  return `${params.appBaseUrl.replace(/\/$/, "")}/room/${params.sessionId}`;
}

export function classifyParticipantNavigation(params: {
  finalUrl: string;
  appBaseUrl: string;
  sessionId: string;
  joinTokenPresentInStartUrl: boolean;
}): ParticipantPrewarmVerifyResult {
  const durableAccountRoomUrl = buildParticipantAccountRoomUrl({
    appBaseUrl: params.appBaseUrl,
    sessionId: params.sessionId,
  });
  let finalPagePath: string | null = null;
  let finalHost: string | null = null;
  try {
    finalPagePath = sanitizePageUrl(params.finalUrl);
    finalHost = new URL(params.finalUrl).host;
  } catch {
    finalPagePath = "/[invalid-url]";
  }

  const redirectToLogin = /\/login/i.test(finalPagePath ?? "");
  if (!params.joinTokenPresentInStartUrl) {
    return {
      ok: false,
      failureCode: "PARTICIPANT_TOKEN_MISSING",
      finalPagePath,
      finalHost,
      redirectToLogin,
      roomLoaded: false,
      durableAccountRoomUrl,
      boundedError: "participant room URL missing joinToken",
    };
  }

  if (redirectToLogin) {
    return {
      ok: false,
      failureCode: "PARTICIPANT_REDIRECTED_TO_LOGIN",
      finalPagePath,
      finalHost,
      redirectToLogin: true,
      roomLoaded: false,
      durableAccountRoomUrl,
      boundedError:
        "join-token navigation redirected to /login (participant auth_session missing or rejected)",
    };
  }

  const onRoom = (finalPagePath ?? "").startsWith(`/room/${params.sessionId}`);
  if (!onRoom) {
    return {
      ok: false,
      failureCode: "PARTICIPANT_ROOM_NOT_LOADED",
      finalPagePath,
      finalHost,
      redirectToLogin: false,
      roomLoaded: false,
      durableAccountRoomUrl,
      boundedError: "participant did not land on the session room path",
    };
  }

  // After invite-claim, durable context is account-mode /room/{sessionId}.
  const stillHasJoinToken = /\bjoinToken=/i.test(params.finalUrl);
  if (stillHasJoinToken) {
    // Soft: some navigations may keep the query briefly; prefer account path.
    // Treat as established if path is the room for this session.
  }

  let appHost = "invalid";
  try {
    appHost = new URL(params.appBaseUrl).host;
  } catch {
    // keep
  }
  if (finalHost && finalHost !== appHost) {
    return {
      ok: false,
      failureCode: "PARTICIPANT_SESSION_ACCESS_DENIED",
      finalPagePath,
      finalHost,
      redirectToLogin: false,
      roomLoaded: false,
      durableAccountRoomUrl,
      boundedError: "participant final host differs from appBaseUrl host",
    };
  }

  return {
    ok: true,
    failureCode: null,
    finalPagePath,
    finalHost,
    redirectToLogin: false,
    roomLoaded: true,
    durableAccountRoomUrl,
    boundedError: null,
  };
}

export function buildParticipantAuthCookieInstall(params: {
  participantAuthCookie: string;
  appBaseUrl: string;
}) {
  return buildUrlBoundAuthCookie({
    cookieHeader: params.participantAuthCookie,
    appBaseUrl: params.appBaseUrl,
  });
}

export function classifyParticipantAccessFailure(params: {
  requestObserved: boolean;
  aborted: boolean;
  timedOut: boolean;
  redirected: boolean;
  httpStatus: number | null;
}): BrowserFailureCode {
  if (!params.requestObserved && params.timedOut) {
    return "PARTICIPANT_ACCESS_RESPONSE_TIMEOUT";
  }
  if (!params.requestObserved) return "PARTICIPANT_ACCESS_NOT_REQUESTED";
  if (params.aborted) return "PARTICIPANT_ACCESS_REQUEST_ABORTED";
  if (params.redirected) return "PARTICIPANT_ACCESS_REDIRECTED";
  if (params.httpStatus === 401 || params.httpStatus === 403) {
    return "PARTICIPANT_ACCESS_DENIED";
  }
  if (params.timedOut) return "PARTICIPANT_ACCESS_RESPONSE_TIMEOUT";
  return "PARTICIPANT_ACCESS_DENIED";
}

export type ParticipantAuthVerifyDiagnostics = {
  finalPagePath: string | null;
  finalHost: string | null;
  redirectToLogin: boolean;
  authenticatedUserMatch: boolean;
  sessionAccess: boolean;
  isFacilitatorIdentity: boolean;
  authSessionCookiePresent: boolean;
  httpStatus: number | null;
  boundedError: string | null;
};

export type ParticipantAuthVerifyResult = {
  ok: boolean;
  failureCode: BrowserFailureCode | null;
  diagnostics: ParticipantAuthVerifyDiagnostics;
};

/**
 * Classify retained run fixtures that predate participant UserSession auth.
 * Raw auth_session tokens cannot be reconstructed from DB hashes without a write.
 */
export function classifyParticipantFixtureAuthCompleteness(params: {
  fixture: PocPrewarmFixture | null;
  joinTokenPresent: boolean;
}): {
  ok: boolean;
  failureCode: BrowserFailureCode | null;
  reason: string | null;
} {
  const cookie = params.fixture?.participantAuthCookie;
  if (hasAuthSessionCookieHeader(cookie)) {
    const raw = parseCookieHeader(cookie!).value;
    if (isRawIdMistakenForAuthSession(raw)) {
      return {
        ok: false,
        failureCode: "PARTICIPANT_AUTH_COOKIE_REJECTED",
        reason: "participantAuthCookie value is not a plausible session token",
      };
    }
    if (!params.fixture?.participantUserId) {
      return {
        ok: false,
        failureCode: "PARTICIPANT_AUTH_ARTIFACT_MISSING",
        reason: "participantUserId missing alongside participantAuthCookie",
      };
    }
    return { ok: true, failureCode: null, reason: null };
  }

  if (params.joinTokenPresent && params.fixture) {
    return {
      ok: false,
      failureCode: "LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE",
      reason:
        "legacy prewarm fixture has joinToken but no participantAuthCookie; cannot reconstruct UserSession cookie without a DB write",
    };
  }

  return {
    ok: false,
    failureCode: "PARTICIPANT_AUTH_ARTIFACT_MISSING",
    reason: "participantAuthCookie missing from fixture",
  };
}

/**
 * Verify participant durable auth on the protected room (not facilitator session page).
 * Never logs cookie/token values.
 */
export async function verifyParticipantAuthInContext(params: {
  context: {
    cookies: () => Promise<Array<{ name: string; value: string }>>;
    request: {
      get: (
        url: string,
        options?: { timeout?: number },
      ) => Promise<{
        status: () => number;
        url: () => string;
        text: () => Promise<string>;
      }>;
    };
  };
  appBaseUrl: string;
  sessionId: string;
  expectedParticipantUserId: string;
  expectedParticipantEmail?: string;
  facilitatorUserId?: string;
  facilitatorAuthCookie?: string | null;
  timeoutMs: number;
  sessionExists?: boolean;
}): Promise<ParticipantAuthVerifyResult> {
  const diagnostics: ParticipantAuthVerifyDiagnostics = {
    finalPagePath: null,
    finalHost: null,
    redirectToLogin: false,
    authenticatedUserMatch: false,
    sessionAccess: false,
    isFacilitatorIdentity: false,
    authSessionCookiePresent: false,
    httpStatus: null,
    boundedError: null,
  };

  let appHost = "invalid";
  try {
    appHost = new URL(params.appBaseUrl).host;
  } catch {
    // keep
  }

  const cookies = await params.context.cookies();
  const authCookie = cookies.find((c) => c.name === "auth_session");
  diagnostics.authSessionCookiePresent = Boolean(authCookie?.value);

  if (!diagnostics.authSessionCookiePresent) {
    diagnostics.boundedError = "auth_session cookie missing in participant context";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_ARTIFACT_MISSING",
      diagnostics,
    };
  }

  if (authCookie && isRawIdMistakenForAuthSession(authCookie.value)) {
    diagnostics.boundedError =
      "participant auth_session value looks like a raw id, not a session token";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_COOKIE_REJECTED",
      diagnostics,
    };
  }

  if (
    hasAuthSessionCookieHeader(params.facilitatorAuthCookie) &&
    authCookie?.value === parseCookieHeader(params.facilitatorAuthCookie!).value
  ) {
    diagnostics.isFacilitatorIdentity = true;
    diagnostics.boundedError =
      "participant context carries facilitator auth_session";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_USER_MISMATCH",
      diagnostics,
    };
  }

  if (params.sessionExists === false) {
    diagnostics.boundedError = "temporary Session record not found";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_SESSION_NOT_FOUND",
      diagnostics,
    };
  }

  const roomPath = `/room/${params.sessionId}`;
  const probeUrl = `${params.appBaseUrl.replace(/\/$/, "")}${roomPath}`;

  let status: number;
  let finalUrl: string;
  let body = "";
  try {
    const resp = await params.context.request.get(probeUrl, {
      timeout: Math.min(params.timeoutMs, 20_000),
    });
    status = resp.status();
    finalUrl = resp.url();
    body = await resp.text().catch(() => "");
  } catch (error) {
    diagnostics.boundedError = redactBoundedErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    return {
      ok: false,
      failureCode: "PARTICIPANT_SESSION_ACCESS_DENIED",
      diagnostics,
    };
  }

  diagnostics.httpStatus = status;
  diagnostics.finalPagePath = sanitizePageUrl(finalUrl);
  try {
    diagnostics.finalHost = new URL(finalUrl).host;
  } catch {
    diagnostics.finalHost = appHost;
  }

  const redirectedToLogin = /\/login/i.test(diagnostics.finalPagePath ?? "");
  diagnostics.redirectToLogin = redirectedToLogin;
  if (redirectedToLogin) {
    diagnostics.boundedError =
      "protected room redirected to /login (participant auth_session not accepted)";
    return {
      ok: false,
      failureCode: "PARTICIPANT_REDIRECTED_TO_LOGIN",
      diagnostics,
    };
  }

  if (diagnostics.finalHost && diagnostics.finalHost !== appHost) {
    diagnostics.boundedError = "final host differs from appBaseUrl host";
    return {
      ok: false,
      failureCode: "PARTICIPANT_SESSION_ACCESS_DENIED",
      diagnostics,
    };
  }

  if (status === 404) {
    diagnostics.boundedError = "room returned 404 (session missing or inaccessible)";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_SESSION_NOT_FOUND",
      diagnostics,
    };
  }

  if (status === 401 || status === 403) {
    diagnostics.boundedError = "participant denied on protected room";
    return {
      ok: false,
      failureCode: "PARTICIPANT_SESSION_ACCESS_DENIED",
      diagnostics,
    };
  }

  if (status !== 200) {
    diagnostics.boundedError = `room probe HTTP ${status}`;
    return {
      ok: false,
      failureCode: "PARTICIPANT_SESSION_ACCESS_DENIED",
      diagnostics,
    };
  }

  const pathOk = (diagnostics.finalPagePath ?? "").startsWith(roomPath);
  if (!pathOk) {
    diagnostics.boundedError = "final path is not the protected room page";
    return {
      ok: false,
      failureCode: "PARTICIPANT_SESSION_ACCESS_DENIED",
      diagnostics,
    };
  }

  diagnostics.sessionAccess = true;

  const email = params.expectedParticipantEmail?.trim().toLowerCase() ?? "";
  const bodyLower = body.toLowerCase();
  const emailMatch = email ? bodyLower.includes(email) : false;
  const userIdMatch = body.includes(params.expectedParticipantUserId);
  diagnostics.authenticatedUserMatch = emailMatch || userIdMatch;

  if (
    params.facilitatorUserId &&
    params.facilitatorUserId === params.expectedParticipantUserId
  ) {
    diagnostics.isFacilitatorIdentity = true;
    diagnostics.boundedError =
      "participant identity equals facilitator identity";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_USER_MISMATCH",
      diagnostics,
    };
  }

  // Soft identity: room HTML may omit email; cookie+session access is primary.
  // Hard-fail only when a conflicting facilitator identity marker is present.
  if (
    params.facilitatorUserId &&
    body.includes(params.facilitatorUserId) &&
    !userIdMatch &&
    !emailMatch
  ) {
    diagnostics.isFacilitatorIdentity = true;
    diagnostics.authenticatedUserMatch = false;
    diagnostics.boundedError =
      "room content matches facilitator identity, not participant";
    return {
      ok: false,
      failureCode: "PARTICIPANT_AUTH_USER_MISMATCH",
      diagnostics,
    };
  }

  return {
    ok: true,
    failureCode: null,
    diagnostics,
  };
}
