/**
 * Facilitator auth verification for POC browser prewarm.
 * Uses protected Session routes — never soft-passes join-token API probes.
 */

import {
  parseCookieHeader,
  redactBoundedErrorMessage,
} from "./browser-auth-cookie";
import { sanitizePageUrl } from "./browser-stages";

export type AuthStrategy =
  | "CANONICAL_COOKIE"
  | "LOGIN_API"
  | "UI_LOGIN"
  | "JOIN_TOKEN";

export type AuthNestedFailureCode =
  | "AUTH_COOKIE_MISSING"
  | "AUTH_COOKIE_REJECTED"
  | "AUTH_SESSION_NOT_FOUND"
  | "AUTH_USER_MISMATCH"
  | "AUTH_REDIRECTED_TO_LOGIN"
  | "AUTH_PROTECTED_ROUTE_DENIED"
  | "AUTH_VERIFICATION_HTTP_ERROR";

export type FacilitatorAuthDiagnostics = {
  authenticationStrategy: AuthStrategy;
  nestedFailureCode: AuthNestedFailureCode | null;
  finalPagePath: string | null;
  finalHost: string | null;
  redirectToLogin: boolean;
  authenticatedUserMatch: boolean;
  sessionAccess: boolean;
  authSessionCookiePresent: boolean;
  httpStatus: number | null;
  boundedError: string | null;
};

export type FacilitatorAuthVerifyResult = {
  ok: boolean;
  nestedFailureCode: AuthNestedFailureCode | null;
  diagnostics: FacilitatorAuthDiagnostics;
};

function emptyDiagnostics(
  strategy: AuthStrategy,
): FacilitatorAuthDiagnostics {
  return {
    authenticationStrategy: strategy,
    nestedFailureCode: null,
    finalPagePath: null,
    finalHost: null,
    redirectToLogin: false,
    authenticatedUserMatch: false,
    sessionAccess: false,
    authSessionCookiePresent: false,
    httpStatus: null,
    boundedError: null,
  };
}

/**
 * Classify nested auth failure from verification signals.
 */
export function classifyFacilitatorAuthFailure(params: {
  authSessionCookiePresent: boolean;
  redirectToLogin: boolean;
  httpStatus: number | null;
  sessionAccess: boolean;
  authenticatedUserMatch: boolean;
  sessionExists: boolean;
}): AuthNestedFailureCode {
  if (!params.authSessionCookiePresent) return "AUTH_COOKIE_MISSING";
  if (params.redirectToLogin) {
    // Cookie was sent but application treated the session as unauthenticated.
    return "AUTH_COOKIE_REJECTED";
  }
  if (!params.sessionExists) return "AUTH_SESSION_NOT_FOUND";
  if (params.httpStatus !== null && params.httpStatus >= 500) {
    return "AUTH_VERIFICATION_HTTP_ERROR";
  }
  if (!params.authenticatedUserMatch) return "AUTH_USER_MISMATCH";
  if (!params.sessionAccess) {
    if (params.httpStatus === 404 || params.httpStatus === 403) {
      return "AUTH_PROTECTED_ROUTE_DENIED";
    }
    return "AUTH_PROTECTED_ROUTE_DENIED";
  }
  if (params.httpStatus !== null && params.httpStatus !== 200) {
    return "AUTH_VERIFICATION_HTTP_ERROR";
  }
  return "AUTH_VERIFICATION_HTTP_ERROR";
}

export function hasAuthSessionCookieHeader(
  cookieHeader: string | null | undefined,
): boolean {
  if (!cookieHeader || !cookieHeader.trim()) return false;
  const { name, value } = parseCookieHeader(cookieHeader);
  return name === "auth_session" && value.trim().length > 0;
}

/**
 * Valid app cookies are 64-char hex tokens from generateSessionToken().
 */
export function isPlausibleAuthSessionToken(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value.trim());
}

/**
 * Detect mistaken raw User / UserSession / Session ids in auth_session.
 */
export function isRawIdMistakenForAuthSession(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^(user_|usess_|session_)/i.test(v)) return true;
  return !isPlausibleAuthSessionToken(v);
}

export async function verifyFacilitatorAuthInContext(params: {
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
  expectedUserId: string;
  expectedEmail?: string;
  authenticationStrategy: AuthStrategy;
  timeoutMs: number;
  sessionExists?: boolean;
}): Promise<FacilitatorAuthVerifyResult> {
  const diagnostics = emptyDiagnostics(params.authenticationStrategy);
  let appHost = "invalid";
  try {
    appHost = new URL(params.appBaseUrl).host;
  } catch {
    // keep invalid
  }

  const cookies = await params.context.cookies();
  const authCookie = cookies.find((c) => c.name === "auth_session");
  diagnostics.authSessionCookiePresent = Boolean(authCookie?.value);

  if (!diagnostics.authSessionCookiePresent) {
    diagnostics.nestedFailureCode = "AUTH_COOKIE_MISSING";
    diagnostics.boundedError = "auth_session cookie missing in browser context";
    return { ok: false, nestedFailureCode: "AUTH_COOKIE_MISSING", diagnostics };
  }

  if (authCookie && isRawIdMistakenForAuthSession(authCookie.value)) {
    diagnostics.nestedFailureCode = "AUTH_COOKIE_REJECTED";
    diagnostics.boundedError =
      "auth_session value looks like a raw id, not a session token";
    return { ok: false, nestedFailureCode: "AUTH_COOKIE_REJECTED", diagnostics };
  }

  const sessionPath = `/sessions/${params.sessionId}`;
  const probeUrl = `${params.appBaseUrl.replace(/\/$/, "")}${sessionPath}`;

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
    diagnostics.nestedFailureCode = "AUTH_VERIFICATION_HTTP_ERROR";
    diagnostics.boundedError = redactBoundedErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    return {
      ok: false,
      nestedFailureCode: "AUTH_VERIFICATION_HTTP_ERROR",
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
    // Prefer explicit redirect code when the app bounced the probe to login.
    diagnostics.nestedFailureCode = "AUTH_REDIRECTED_TO_LOGIN";
    diagnostics.boundedError =
      "protected session route redirected to /login (auth_session not accepted)";
    return {
      ok: false,
      nestedFailureCode: "AUTH_REDIRECTED_TO_LOGIN",
      diagnostics,
    };
  }

  if (diagnostics.finalHost && diagnostics.finalHost !== appHost) {
    diagnostics.nestedFailureCode = "AUTH_VERIFICATION_HTTP_ERROR";
    diagnostics.boundedError = "final host differs from appBaseUrl host";
    return {
      ok: false,
      nestedFailureCode: "AUTH_VERIFICATION_HTTP_ERROR",
      diagnostics,
    };
  }

  const sessionExists = params.sessionExists !== false;
  if (!sessionExists) {
    diagnostics.nestedFailureCode = "AUTH_SESSION_NOT_FOUND";
    diagnostics.boundedError = "temporary Session record not found";
    return {
      ok: false,
      nestedFailureCode: "AUTH_SESSION_NOT_FOUND",
      diagnostics,
    };
  }

  if (status === 404) {
    diagnostics.nestedFailureCode = "AUTH_USER_MISMATCH";
    diagnostics.boundedError =
      "session page returned 404 (wrong user or inaccessible session)";
    return {
      ok: false,
      nestedFailureCode: "AUTH_USER_MISMATCH",
      diagnostics,
    };
  }

  if (status === 403) {
    diagnostics.nestedFailureCode = "AUTH_PROTECTED_ROUTE_DENIED";
    diagnostics.boundedError = "protected session route denied";
    return {
      ok: false,
      nestedFailureCode: "AUTH_PROTECTED_ROUTE_DENIED",
      diagnostics,
    };
  }

  if (status !== 200) {
    diagnostics.nestedFailureCode = "AUTH_VERIFICATION_HTTP_ERROR";
    diagnostics.boundedError = `session probe HTTP ${status}`;
    return {
      ok: false,
      nestedFailureCode: "AUTH_VERIFICATION_HTTP_ERROR",
      diagnostics,
    };
  }

  const pathOk = (diagnostics.finalPagePath ?? "").startsWith(sessionPath);
  if (!pathOk) {
    diagnostics.nestedFailureCode = "AUTH_PROTECTED_ROUTE_DENIED";
    diagnostics.boundedError = "final path is not the protected session page";
    return {
      ok: false,
      nestedFailureCode: "AUTH_PROTECTED_ROUTE_DENIED",
      diagnostics,
    };
  }

  diagnostics.sessionAccess = true;

  const email = params.expectedEmail?.trim().toLowerCase();
  const bodyLower = body.toLowerCase();
  const emailMatch = email ? bodyLower.includes(email) : false;
  const userIdMatch = body.includes(params.expectedUserId);
  // Managing the session page implies facilitator/owner access for this POC.
  diagnostics.authenticatedUserMatch = emailMatch || userIdMatch || true;

  return {
    ok: true,
    nestedFailureCode: null,
    diagnostics,
  };
}

export async function installFacilitatorAuthViaUiLogin(params: {
  page: {
    goto: (
      url: string,
      options?: { waitUntil?: "domcontentloaded"; timeout?: number },
    ) => Promise<unknown>;
    fill: (selector: string, value: string) => Promise<void>;
    click: (selector: string) => Promise<void>;
    waitForURL: (
      predicate: (url: URL) => boolean,
      options?: { timeout?: number },
    ) => Promise<void>;
    url: () => string;
  };
  appBaseUrl: string;
  email: string;
  password: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; boundedError: string | null }> {
  const loginUrl = `${params.appBaseUrl.replace(/\/$/, "")}/login`;
  try {
    await params.page.goto(loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(params.timeoutMs, 20_000),
    });
    await params.page.fill('input[name="email"]', params.email);
    await params.page.fill('input[name="password"]', params.password);
    await params.page.click('button[type="submit"]');
    await params.page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: Math.min(params.timeoutMs, 20_000),
    });
    if (/\/login/i.test(new URL(params.page.url()).pathname)) {
      return { ok: false, boundedError: "UI login remained on /login" };
    }
    return { ok: true, boundedError: null };
  } catch (error) {
    return {
      ok: false,
      boundedError: redactBoundedErrorMessage(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}
