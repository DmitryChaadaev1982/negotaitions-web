import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFacilitatorAuthFailure,
  hasAuthSessionCookieHeader,
  isPlausibleAuthSessionToken,
  isRawIdMistakenForAuthSession,
  verifyFacilitatorAuthInContext,
} from "@/lib/voximplant/poc/orchestrator/browser-auth-verify";
import {
  emptyBrowserContextEvidence,
  markFailed,
  sanitizeConsoleMessage,
} from "@/lib/voximplant/poc/orchestrator/browser-stages";
import { generateSessionToken } from "@/lib/auth/crypto";

test("1. invalid raw auth_session value is rejected", () => {
  assert.equal(isRawIdMistakenForAuthSession("user_abc123"), true);
  assert.equal(isRawIdMistakenForAuthSession("usess_abc123"), true);
  assert.equal(isRawIdMistakenForAuthSession("session_abc"), true);
  assert.equal(isRawIdMistakenForAuthSession("short"), true);
  assert.equal(isPlausibleAuthSessionToken(generateSessionToken()), true);
  assert.equal(isRawIdMistakenForAuthSession(generateSessionToken()), false);
});

test("2. canonical auth helper produces accepted facilitator context", async () => {
  const token = generateSessionToken();
  const result = await verifyFacilitatorAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: token }],
      request: {
        get: async () => ({
          status: () => 200,
          url: () => "http://localhost:3000/sessions/session_1",
          text: async () =>
            "<html>poc-vox-server-stop-run.facilitator@test.negotaitions.local</html>",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "session_1",
    expectedUserId: "user_1",
    expectedEmail:
      "poc-vox-server-stop-run.facilitator@test.negotaitions.local",
    authenticationStrategy: "CANONICAL_COOKIE",
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.sessionAccess, true);
  assert.equal(result.diagnostics.authenticationStrategy, "CANONICAL_COOKIE");
});

test("3. facilitator identity mismatch on 404 becomes AUTH_USER_MISMATCH", async () => {
  const token = generateSessionToken();
  const result = await verifyFacilitatorAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: token }],
      request: {
        get: async () => ({
          status: () => 404,
          url: () => "http://localhost:3000/sessions/session_1",
          text: async () => "Not Found",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "session_1",
    expectedUserId: "user_other",
    authenticationStrategy: "CANONICAL_COOKIE",
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.nestedFailureCode, "AUTH_USER_MISMATCH");
});

test("4. redirect to login becomes AUTH_REDIRECTED_TO_LOGIN", async () => {
  const token = generateSessionToken();
  const result = await verifyFacilitatorAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: token }],
      request: {
        get: async () => ({
          status: () => 200,
          url: () =>
            "http://localhost:3000/login?returnUrl=%2Fsessions%2Fsession_1",
          text: async () => "<html>login</html>",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "session_1",
    expectedUserId: "user_1",
    authenticationStrategy: "CANONICAL_COOKIE",
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.nestedFailureCode, "AUTH_REDIRECTED_TO_LOGIN");
  assert.equal(result.diagnostics.redirectToLogin, true);
});

test("5. missing UserSession / session becomes AUTH_SESSION_NOT_FOUND", async () => {
  const token = generateSessionToken();
  const result = await verifyFacilitatorAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: token }],
      request: {
        get: async () => ({
          status: () => 200,
          url: () => "http://localhost:3000/sessions/session_1",
          text: async () => "ok",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "session_1",
    expectedUserId: "user_1",
    authenticationStrategy: "CANONICAL_COOKIE",
    timeoutMs: 1000,
    sessionExists: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.nestedFailureCode, "AUTH_SESSION_NOT_FOUND");
});

test("6. participant receives no facilitator cookie (header helper)", () => {
  assert.equal(hasAuthSessionCookieHeader(""), false);
  assert.equal(hasAuthSessionCookieHeader(null), false);
  assert.equal(hasAuthSessionCookieHeader("auth_session=abc"), true);
});

test("7. classify nested auth failures", () => {
  assert.equal(
    classifyFacilitatorAuthFailure({
      authSessionCookiePresent: false,
      redirectToLogin: true,
      httpStatus: 200,
      sessionAccess: false,
      authenticatedUserMatch: false,
      sessionExists: true,
    }),
    "AUTH_COOKIE_MISSING",
  );
  assert.equal(
    classifyFacilitatorAuthFailure({
      authSessionCookiePresent: true,
      redirectToLogin: true,
      httpStatus: 200,
      sessionAccess: false,
      authenticatedUserMatch: false,
      sessionExists: true,
    }),
    "AUTH_COOKIE_REJECTED",
  );
});

test("8. one role failure retains the other role state", () => {
  const fac = markFailed(
    emptyBrowserContextEvidence("facilitator", "s1"),
    "AUTH_ACCEPTED",
    "AUTH_REDIRECTED_TO_LOGIN",
  );
  const part = {
    ...emptyBrowserContextEvidence("participant", "s1"),
    reachedStage: "AUTH_CONTEXT_CREATED" as const,
    failureCode: null,
  };
  assert.equal(fac.failureCode, "AUTH_REDIRECTED_TO_LOGIN");
  assert.equal(part.failureCode, null);
  assert.equal(part.reachedStage, "AUTH_CONTEXT_CREATED");
});

test("13. secrets/cookies/tokens are redacted", () => {
  const text = sanitizeConsoleMessage(
    "fail auth_session=supersecrettoken joinToken=abc123",
  );
  assert.ok(!text.includes("supersecrettoken"));
  assert.ok(!text.includes("abc123"));
  assert.ok(text.includes("auth_session=[redacted]"));
  assert.ok(text.includes("joinToken=[redacted]"));
});
