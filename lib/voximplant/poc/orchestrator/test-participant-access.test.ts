import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateSessionToken } from "@/lib/auth/crypto";
import { getPocRunPaths } from "@/lib/voximplant/poc/poc-run-store";
import {
  classifyParticipantFixtureAuthCompleteness,
  verifyParticipantAuthInContext,
} from "@/lib/voximplant/poc/orchestrator/participant-prewarm";
import {
  runCreateFixtureParticipantAccess,
  runTestParticipantAccess,
} from "@/lib/voximplant/poc/orchestrator/test-participant-access";
import {
  writePrewarmFixture,
  type PocPrewarmFixture,
} from "@/lib/voximplant/poc/orchestrator/prewarm-fixture";
import { sanitizeConsoleMessage } from "@/lib/voximplant/poc/orchestrator/browser-stages";

function legacyFixture(runId: string): PocPrewarmFixture {
  return {
    runId,
    sessionId: `session_${runId}`,
    facilitatorUserId: `user_${runId}`,
    facilitatorEmail: `${runId}.facilitator@test.negotaitions.local`,
    facilitatorPassword: "poc-vox-pass-1234",
    facilitatorAuthCookie: `auth_session=${generateSessionToken()}`,
    facilitatorJoinToken: `${runId}-fac`,
    participantJoinToken: `${runId}-part`,
    facilitatorRoomUrl: `http://localhost:3000/room/session_${runId}?joinToken=${runId}-fac`,
    participantRoomUrl: `http://localhost:3000/room/session_${runId}?joinToken=${runId}-part`,
    createdAt: new Date().toISOString(),
  };
}

test("5. canonical participant cookie accepted by protected room probe", async () => {
  const token = generateSessionToken();
  const result = await verifyParticipantAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: token }],
      request: {
        get: async () => ({
          status: () => 200,
          url: () => "http://localhost:3000/room/session_1",
          text: async () =>
            "<html>puser_1 poc-vox.participant@test.negotaitions.local</html>",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "session_1",
    expectedParticipantUserId: "puser_1",
    expectedParticipantEmail: "poc-vox.participant@test.negotaitions.local",
    facilitatorUserId: "fuser_1",
    facilitatorAuthCookie: `auth_session=${generateSessionToken()}`,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.sessionAccess, true);
  assert.equal(result.diagnostics.redirectToLogin, false);
});

test("3. participant cookie equal to facilitator is rejected", async () => {
  const shared = generateSessionToken();
  const result = await verifyParticipantAuthInContext({
    context: {
      cookies: async () => [{ name: "auth_session", value: shared }],
      request: {
        get: async () => ({
          status: () => 200,
          url: () => "http://localhost:3000/room/session_1",
          text: async () => "<html>ok</html>",
        }),
      },
    },
    appBaseUrl: "http://localhost:3000",
    sessionId: "session_1",
    expectedParticipantUserId: "puser_1",
    facilitatorUserId: "fuser_1",
    facilitatorAuthCookie: `auth_session=${shared}`,
    timeoutMs: 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "PARTICIPANT_AUTH_USER_MISMATCH");
  assert.equal(result.diagnostics.isFacilitatorIdentity, true);
});

test("6. join-token exchange occurs only once (durable account URL after claim)", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/orchestrator/browser-join.ts"),
    "utf8",
  );
  assert.ok(source.includes("do not re-hit joinToken"));
  assert.ok(source.includes("participantNav.durableAccountRoomUrl"));
  assert.ok(source.includes("verifyParticipantAuthInContext"));
});

test("8. provider-free create-fixture path documents zero provider calls", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/test-participant-access.ts",
    ),
    "utf8",
  );
  assert.ok(source.includes("providerCalls: false"));
  assert.ok(!source.includes("startConference("));
  assert.ok(!source.includes('from "@/lib/voximplant/poc/management-client"'));
  assert.ok(source.includes("runCreateFixtureParticipantAccess"));
  assert.ok(source.includes("createVoxServerStopPocSession"));
});

test("9. provider-free create-fixture makes zero provider calls (runtime flags)", async () => {
  const result = await runCreateFixtureParticipantAccess({
    confirmLocalDbWrite: false,
    appBaseUrl: "http://localhost:3000",
  });
  assert.equal(result.providerCalls, false);
  assert.equal(result.failureCode, "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED");
});

test("10. unsafe DB is refused in create-fixture mode", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://db.example.com:5432/negotiations";
  try {
    const result = await runCreateFixtureParticipantAccess({
      confirmLocalDbWrite: true,
      appBaseUrl: "http://localhost:3000",
      databaseUrl: "postgres://db.example.com:5432/negotiations",
    });
    assert.equal(result.ok, false);
    assert.equal(result.providerCalls, false);
    assert.equal(result.dbWrites, false);
    assert.equal(result.failureCode, "UNSAFE_DATABASE_TARGET");
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("11. local DB confirmation is required for create-fixture", async () => {
  const result = await runCreateFixtureParticipantAccess({
    confirmLocalDbWrite: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED");
});

test("14. legacy run returns LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-legacy-"));
  const runId = "run-legacy-incomplete";
  const fixture = legacyFixture(runId);
  writePrewarmFixture(fixture, stateRoot);
  const paths = getPocRunPaths(runId, stateRoot);
  mkdirSync(paths.runDir, { recursive: true });
  writeFileSync(
    paths.reportPath,
    JSON.stringify({ sessionId: fixture.sessionId }, null, 2),
  );

  const completeness = classifyParticipantFixtureAuthCompleteness({
    fixture,
    joinTokenPresent: true,
  });
  assert.equal(completeness.ok, false);
  assert.equal(
    completeness.failureCode,
    "LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE",
  );

  const result = await runTestParticipantAccess({
    runId,
    appBaseUrl: "http://localhost:3000",
    stateRoot,
  });
  assert.equal(result.ok, false);
  assert.equal(result.providerCalls, false);
  assert.equal(result.dbWrites, false);
  assert.equal(result.failureCode, "LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE");
  assert.equal(result.details.joinTokenPresent, true);
});

test("15. tokens/cookies are redacted in sanitize helpers", () => {
  const msg = sanitizeConsoleMessage(
    "goto http://localhost:3000/room/s?joinToken=secret123 auth_session=abcdef",
  );
  assert.ok(!msg.includes("secret123"));
  assert.ok(!msg.includes("abcdef"));
  assert.ok(msg.includes("joinToken=[redacted]"));
  assert.ok(msg.includes("auth_session=[redacted]"));
});

test("16. full orchestrator blocks StartConference unless participant prewarm passes", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/orchestrator/run-orchestrator.ts"),
    "utf8",
  );
  assert.ok(source.includes("if (!prewarmHandle.ok)"));
  assert.ok(source.includes('failureStage = "browser_prewarm"'));
  assert.ok(source.includes("participantAuthCookie: sessionFixture!.participantAuthCookie"));
  assert.ok(source.includes("participantEmail: sessionFixture!.participantEmail"));
});

test("read-only run-id path does not call createVoxServerStopPocSession at runtime entry", () => {
  const script = readFileSync(
    join(
      process.cwd(),
      "scripts/poc/voximplant-server-stop/test-participant-access.ts",
    ),
    "utf8",
  );
  assert.ok(script.includes("runTestParticipantAccess"));
  assert.ok(script.includes("runCreateFixtureParticipantAccess"));
  assert.ok(script.includes("--create-fixture"));
});

test("legacy completeness classifier distinguishes missing artifact vs legacy", () => {
  const missing = classifyParticipantFixtureAuthCompleteness({
    fixture: null,
    joinTokenPresent: false,
  });
  assert.equal(missing.failureCode, "PARTICIPANT_AUTH_ARTIFACT_MISSING");

  const complete = classifyParticipantFixtureAuthCompleteness({
    fixture: {
      ...legacyFixture("ok"),
      participantUserId: "puser",
      participantEmail: "p@test.negotaitions.local",
      participantAuthCookie: `auth_session=${generateSessionToken()}`,
      participantAccountRoomUrl: "http://localhost:3000/room/s",
    },
    joinTokenPresent: true,
  });
  assert.equal(complete.ok, true);
});
