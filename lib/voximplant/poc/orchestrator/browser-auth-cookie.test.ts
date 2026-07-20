import assert from "node:assert/strict";
import test from "node:test";

import {
  assertUrlBoundCookieShape,
  buildAuthFailureDiagnostics,
  buildUrlBoundAuthCookie,
  prepareParticipantJoinContext,
  redactBoundedErrorMessage,
} from "@/lib/voximplant/poc/orchestrator/browser-auth-cookie";
import {
  classifyBrowserFailure,
  emptyBrowserContextEvidence,
  markFailed,
} from "@/lib/voximplant/poc/orchestrator/browser-stages";

test("URL-bound localhost cookie is valid for Playwright addCookies", () => {
  const built = buildUrlBoundAuthCookie({
    cookieHeader: "auth_session=secret-token-value",
    appBaseUrl: "http://localhost:3000",
  });
  assert.equal(built.bindingMode, "URL_BOUND");
  assert.equal(built.cookie.name, "auth_session");
  assert.equal(built.cookie.value, "secret-token-value");
  assert.equal(built.cookie.url, "http://localhost:3000");
  assert.equal(built.cookie.httpOnly, true);
  assert.equal(built.cookie.sameSite, "Lax");
  assert.equal(built.cookie.secure, false);
  assert.equal(built.appBaseUrlHost, "localhost:3000");
  assertUrlBoundCookieShape(built.cookie);
});

test("HTTPS base URL produces secure=true", () => {
  const built = buildUrlBoundAuthCookie({
    cookieHeader: "auth_session=tok",
    appBaseUrl: "https://local.negotaitions.ru",
  });
  assert.equal(built.secure, true);
  assert.equal(built.cookie.secure, true);
});

test("HTTP localhost produces secure=false", () => {
  const built = buildUrlBoundAuthCookie({
    cookieHeader: "auth_session=tok",
    appBaseUrl: "http://localhost:3000",
  });
  assert.equal(built.secure, false);
  assert.equal(built.cookie.secure, false);
});

test("no incomplete domain cookie reaches addCookies shape", () => {
  const built = buildUrlBoundAuthCookie({
    cookieHeader: "auth_session=tok",
    appBaseUrl: "http://localhost:3000",
  });
  assert.equal("domain" in built.cookie, false);
  assert.equal("path" in built.cookie, false);
  assert.throws(
    () =>
      assertUrlBoundCookieShape({
        name: "auth_session",
        value: "tok",
        url: "http://localhost:3000",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: false,
      }),
    /must not include path/,
  );
  assert.throws(
    () =>
      assertUrlBoundCookieShape({
        name: "auth_session",
        value: "tok",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: false,
      }),
    /requires url|must not include domain/,
  );
});

test("facilitator receives auth_session cookie name", () => {
  const built = buildUrlBoundAuthCookie({
    cookieHeader: "auth_session=facilitator-secret",
    appBaseUrl: "http://localhost:3000",
  });
  assert.equal(built.cookieName, "auth_session");
  assert.equal(built.cookie.name, "auth_session");
});

test("participant uses join-token flow without facilitator auth cookie", () => {
  const setup = prepareParticipantJoinContext({
    participantRoomUrl:
      "http://localhost:3000/room/session-1?joinToken=participant-secret",
  });
  assert.equal(setup.authStrategy, "JOIN_TOKEN_URL");
  assert.equal(setup.cookieInstalled, false);
  assert.equal(setup.pagePath, "/room/session-1");
  assert.throws(
    () =>
      prepareParticipantJoinContext({
        participantRoomUrl: "http://localhost:3000/room/session-1",
      }),
    /missing joinToken/,
  );
});

test("cookie-install failure classifies as AUTH_COOKIE_INSTALL_FAILED", () => {
  const facilitator = markFailed(
    emptyBrowserContextEvidence("facilitator", "s1"),
    "AUTH_CONTEXT_CREATED",
    "AUTH_COOKIE_INSTALL_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator,
      participant: emptyBrowserContextEvidence("participant", "s1"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "AUTH_COOKIE_INSTALL_FAILED",
  );
  assert.equal(facilitator.firstFailedStage, "AUTH_CONTEXT_CREATED");
  assert.notEqual(facilitator.failureCode, "BROWSER_PREWARM_FAILED");
});

test("participant setup failure remains separate", () => {
  const participant = markFailed(
    emptyBrowserContextEvidence("participant", "s1"),
    "AUTH_CONTEXT_CREATED",
    "PARTICIPANT_CONTEXT_SETUP_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: emptyBrowserContextEvidence("facilitator", "s1"),
      participant,
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "PARTICIPANT_CONTEXT_SETUP_FAILED",
  );
});

test("auth failure diagnostics never include cookie/token secrets", () => {
  const diag = buildAuthFailureDiagnostics({
    role: "facilitator",
    failingOperation: "addCookies",
    error: new Error(
      "addCookies failed auth_session=super-secret joinToken=leak https://host/request/CAP",
    ),
    cookieBindingMode: "URL_BOUND",
    appBaseUrl: "http://localhost:3000",
    secure: false,
  });
  assert.equal(diag.role, "facilitator");
  assert.equal(diag.failingOperation, "addCookies");
  assert.equal(diag.cookieBindingMode, "URL_BOUND");
  assert.equal(diag.appBaseUrlHost, "localhost:3000");
  assert.equal(diag.secure, false);
  assert.ok(!diag.errorMessage.includes("super-secret"));
  assert.ok(!diag.errorMessage.includes("leak"));
  assert.ok(!JSON.stringify(diag).includes("super-secret"));

  const redacted = redactBoundedErrorMessage(
    "failed joinToken=abc auth_session=xyz",
  );
  assert.ok(!redacted.includes("abc"));
  assert.ok(!redacted.includes("xyz"));
});

test("successful auth context markers are distinct from BROWSER_LAUNCHED", () => {
  const facilitator = {
    ...emptyBrowserContextEvidence("facilitator", "s"),
    reachedStage: "AUTH_CONTEXT_CREATED" as const,
  };
  const participant = {
    ...emptyBrowserContextEvidence("participant", "s"),
    reachedStage: "AUTH_CONTEXT_CREATED" as const,
  };
  assert.equal(facilitator.reachedStage, "AUTH_CONTEXT_CREATED");
  assert.equal(participant.reachedStage, "AUTH_CONTEXT_CREATED");
  assert.notEqual(facilitator.reachedStage, "BROWSER_LAUNCHED");
});
