import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activatePocRun,
  clearCurrentPointer,
  readCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import {
  classifyParticipantAccessFailure,
  classifyParticipantNavigation,
  extractJoinTokenFromRoomUrl,
} from "@/lib/voximplant/poc/orchestrator/participant-prewarm";
import { restorePointerAfterTest } from "@/lib/voximplant/poc/orchestrator/test-participant-access";
import { emptyBrowserContextEvidence, markFailed } from "@/lib/voximplant/poc/orchestrator/browser-stages";

test("direct protected-room navigation without auth is classified as login redirect", () => {
  const result = classifyParticipantNavigation({
    finalUrl:
      "http://localhost:3000/login?returnUrl=%2Froom%2Fsess%3FjoinToken%3Dx",
    appBaseUrl: "http://localhost:3000",
    sessionId: "sess",
    joinTokenPresentInStartUrl: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "PARTICIPANT_REDIRECTED_TO_LOGIN");
  assert.equal(result.redirectToLogin, true);
});

test("canonical join-token entry establishes participant room context", () => {
  const result = classifyParticipantNavigation({
    finalUrl: "http://localhost:3000/room/sess",
    appBaseUrl: "http://localhost:3000",
    sessionId: "sess",
    joinTokenPresentInStartUrl: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.roomLoaded, true);
  assert.equal(result.durableAccountRoomUrl, "http://localhost:3000/room/sess");
});

test("participant token missing is typed", () => {
  assert.equal(extractJoinTokenFromRoomUrl("http://localhost:3000/room/s"), null);
  const result = classifyParticipantNavigation({
    finalUrl: "http://localhost:3000/room/s",
    appBaseUrl: "http://localhost:3000",
    sessionId: "s",
    joinTokenPresentInStartUrl: false,
  });
  assert.equal(result.failureCode, "PARTICIPANT_TOKEN_MISSING");
});

test("access failure codes are distinct", () => {
  assert.equal(
    classifyParticipantAccessFailure({
      requestObserved: false,
      aborted: false,
      timedOut: false,
      redirected: false,
      httpStatus: null,
    }),
    "PARTICIPANT_ACCESS_NOT_REQUESTED",
  );
  assert.equal(
    classifyParticipantAccessFailure({
      requestObserved: true,
      aborted: true,
      timedOut: false,
      redirected: false,
      httpStatus: null,
    }),
    "PARTICIPANT_ACCESS_REQUEST_ABORTED",
  );
  assert.equal(
    classifyParticipantAccessFailure({
      requestObserved: true,
      aborted: false,
      timedOut: true,
      redirected: false,
      httpStatus: null,
    }),
    "PARTICIPANT_ACCESS_RESPONSE_TIMEOUT",
  );
  assert.equal(
    classifyParticipantAccessFailure({
      requestObserved: true,
      aborted: false,
      timedOut: false,
      redirected: true,
      httpStatus: 302,
    }),
    "PARTICIPANT_ACCESS_REDIRECTED",
  );
  assert.equal(
    classifyParticipantAccessFailure({
      requestObserved: true,
      aborted: false,
      timedOut: false,
      redirected: false,
      httpStatus: 403,
    }),
    "PARTICIPANT_ACCESS_DENIED",
  );
});

test("actual request event controls ACCESS_REQUEST_SENT semantics", () => {
  const withoutRequest = {
    ...emptyBrowserContextEvidence("participant", "s"),
    accessRequested: false,
    access: {
      ...emptyBrowserContextEvidence("participant", "s").access!,
      requestObserved: false,
    },
  };
  assert.equal(withoutRequest.accessRequested, false);
  assert.equal(withoutRequest.access?.requestObserved, false);

  const withRequest = {
    ...withoutRequest,
    accessRequested: true,
    access: {
      ...withoutRequest.access!,
      requestObserved: true,
      requestAt: new Date().toISOString(),
    },
  };
  assert.equal(withRequest.accessRequested, true);
  assert.equal(withRequest.access?.requestObserved, true);
});

test("no request results in PARTICIPANT_ACCESS_NOT_REQUESTED", () => {
  const failed = markFailed(
    emptyBrowserContextEvidence("participant", "s"),
    "ACCESS_REQUEST_SENT",
    "PARTICIPANT_ACCESS_NOT_REQUESTED",
  );
  assert.equal(failed.failureCode, "PARTICIPANT_ACCESS_NOT_REQUESTED");
});

test("provider-free command restores current run pointer", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-ptr-"));
  activatePocRun({
    runId: "run-previous",
    linkedSessionId: "sess-previous",
    stateRoot,
  });
  const previous = readCurrentPointer(stateRoot);
  activatePocRun({
    runId: "run-temp",
    linkedSessionId: "sess-temp",
    stateRoot,
  });
  assert.equal(readCurrentPointer(stateRoot)?.runId, "run-temp");
  restorePointerAfterTest({ previous, stateRoot });
  assert.equal(readCurrentPointer(stateRoot)?.runId, "run-previous");
  clearCurrentPointer(stateRoot);
});

test("provider-free participant access read-only path makes no provider calls", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/test-participant-access.ts",
    ),
    "utf8",
  );
  assert.ok(!source.includes("startConference("));
  assert.ok(!source.includes('from "@/lib/voximplant/poc/management-client"'));
  assert.ok(source.includes("providerCalls: false"));
  assert.ok(source.includes("runTestParticipantAccess"));
  assert.ok(source.includes("runCreateFixtureParticipantAccess"));
  assert.ok(source.includes("LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE"));
});

test("participant auth verification rejects facilitator cookie reuse", async () => {
  const { verifyParticipantAuthInContext } = await import(
    "@/lib/voximplant/poc/orchestrator/participant-prewarm"
  );
  const { generateSessionToken } = await import("@/lib/auth/crypto");
  const shared = generateSessionToken();
  const result = await verifyParticipantAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: shared }],
      request: {
        get: async () => ({
          status: () => 200,
          url: () => "http://localhost:3000/room/s",
          text: async () => "ok",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "s",
    expectedParticipantUserId: "p",
    facilitatorAuthCookie: `auth_session=${shared}`,
    timeoutMs: 500,
  });
  assert.equal(result.failureCode, "PARTICIPANT_AUTH_USER_MISMATCH");
});

test("durable account room URL is reused after join-token entry", () => {
  const result = classifyParticipantNavigation({
    finalUrl: "http://localhost:3000/room/sess?joinToken=still-present",
    appBaseUrl: "http://localhost:3000",
    sessionId: "sess",
    joinTokenPresentInStartUrl: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.durableAccountRoomUrl, "http://localhost:3000/room/sess");
  assert.ok(!result.durableAccountRoomUrl.includes("joinToken"));
});

test("production room page still requires auth for joinToken (source guard)", () => {
  const roomSource = readFileSync(
    join(process.cwd(), "app/room/[sessionId]/page.tsx"),
    "utf8",
  );
  assert.ok(roomSource.includes("getOptionalCurrentUser"));
  assert.ok(roomSource.includes("redirect(`/login?returnUrl="));
  assert.ok(roomSource.includes("trimmedJoinToken"));
});
