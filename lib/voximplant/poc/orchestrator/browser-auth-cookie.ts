/**
 * URL-bound Playwright auth cookies for POC browser prewarm.
 * Never log or persist cookie values, join tokens, or full tokenized URLs.
 */

import { sanitizeConsoleMessage } from "./browser-stages";

export type CookieBindingMode = "URL_BOUND" | "DOMAIN_BOUND";

/** Playwright cookie using the URL-bound form (no domain/path fields). */
export type UrlBoundPlaywrightCookie = {
  name: string;
  value: string;
  url: string;
  httpOnly: boolean;
  sameSite: "Lax";
  secure: boolean;
};

export type AuthCookieInstallDiagnostics = {
  role: "facilitator" | "participant";
  failingOperation: string;
  errorName: string;
  errorMessage: string;
  cookieBindingMode: CookieBindingMode;
  appBaseUrlHost: string;
  secure: boolean;
};

export function parseCookieHeader(cookieHeader: string): {
  name: string;
  value: string;
} {
  const [name, ...rest] = cookieHeader.split("=");
  return { name: name?.trim() || "auth_session", value: rest.join("=") };
}

export function redactBoundedErrorMessage(
  message: string,
  maxLen = 240,
): string {
  return sanitizeConsoleMessage(message).slice(0, maxLen);
}

/**
 * Build a Playwright-valid URL-bound cookie.
 * Do not combine `url` with `domain`/`path` — Playwright rejects that shape.
 */
export function buildUrlBoundAuthCookie(params: {
  cookieHeader: string;
  appBaseUrl: string;
}): {
  cookie: UrlBoundPlaywrightCookie;
  bindingMode: "URL_BOUND";
  appBaseUrlHost: string;
  secure: boolean;
  cookieName: string;
} {
  const { name, value } = parseCookieHeader(params.cookieHeader);
  const parsed = new URL(params.appBaseUrl);
  const secure = parsed.protocol === "https:";
  const cookie: UrlBoundPlaywrightCookie = {
    name,
    value,
    url: params.appBaseUrl,
    httpOnly: true,
    sameSite: "Lax",
    secure,
  };
  assertUrlBoundCookieShape(cookie);
  return {
    cookie,
    bindingMode: "URL_BOUND",
    appBaseUrlHost: parsed.host,
    secure,
    cookieName: name,
  };
}

/** Reject incomplete domain-based cookies and url+domain/path hybrids. */
export function assertUrlBoundCookieShape(
  cookie: Record<string, unknown>,
): asserts cookie is UrlBoundPlaywrightCookie {
  if (typeof cookie.url !== "string" || !cookie.url) {
    throw new Error("URL-bound cookie requires url");
  }
  if ("domain" in cookie && cookie.domain !== undefined) {
    throw new Error("URL-bound cookie must not include domain");
  }
  if ("path" in cookie && cookie.path !== undefined) {
    throw new Error("URL-bound cookie must not include path");
  }
  if (typeof cookie.name !== "string" || !cookie.name) {
    throw new Error("cookie name required");
  }
  if (typeof cookie.value !== "string") {
    throw new Error("cookie value required");
  }
}

/**
 * Participant uses join-token room URL only — no facilitator auth_session cookie.
 */
export function prepareParticipantJoinContext(params: {
  participantRoomUrl: string;
}): {
  authStrategy: "JOIN_TOKEN_URL";
  cookieInstalled: false;
  pagePath: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(params.participantRoomUrl);
  } catch {
    throw new Error("participant room URL is invalid");
  }
  if (!parsed.searchParams.has("joinToken")) {
    throw new Error("participant room URL missing joinToken");
  }
  return {
    authStrategy: "JOIN_TOKEN_URL",
    cookieInstalled: false,
    pagePath: parsed.pathname,
  };
}

export function buildAuthFailureDiagnostics(params: {
  role: "facilitator" | "participant";
  failingOperation: string;
  error: unknown;
  cookieBindingMode: CookieBindingMode;
  appBaseUrl: string;
  secure: boolean;
}): AuthCookieInstallDiagnostics {
  let appBaseUrlHost = "invalid";
  try {
    appBaseUrlHost = new URL(params.appBaseUrl).host;
  } catch {
    // keep invalid
  }
  const error =
    params.error instanceof Error ? params.error : new Error(String(params.error));
  return {
    role: params.role,
    failingOperation: params.failingOperation,
    errorName: error.name || "Error",
    errorMessage: redactBoundedErrorMessage(error.message),
    cookieBindingMode: params.cookieBindingMode,
    appBaseUrlHost,
    secure: params.secure,
  };
}
