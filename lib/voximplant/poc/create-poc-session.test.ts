import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { generateSessionToken } from "@/lib/auth/crypto";
import {
  cleanupPocSessionEntities,
  namespaceForRunId,
} from "@/lib/voximplant/poc/create-poc-session";
import { LocalDbSafetyError } from "@/lib/voximplant/poc/local-db-safety";

test("1. fixture result shape exposes facilitatorAuth and participantAuth separately", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  assert.ok(source.includes("facilitatorAuth: PocRoleAuthContext"));
  assert.ok(source.includes("participantAuth: PocRoleAuthContext"));
  assert.ok(source.includes('role: "FACILITATOR"'));
  assert.ok(source.includes('role: "PARTICIPANT"'));
  assert.ok(source.includes("userSessionId: facilitatorUserSessionId"));
  assert.ok(source.includes("userSessionId: participantUserSessionId"));
});

test("2. participant auth identity fields differ from facilitator", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  assert.ok(source.includes("participantUserId"));
  assert.ok(source.includes("facilitatorUserId"));
  assert.ok(source.includes("participantRawAuthToken = generateSessionToken()"));
  assert.ok(source.includes("facilitatorRawAuthToken = generateSessionToken()"));
  assert.ok(
    source.includes(
      "participantAuthCookie: `auth_session=${participantRawAuthToken}`",
    ) || source.includes("authCookie: participantAuthCookie"),
  );
});

test("3. participant never receives facilitator cookie in fixture return", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  assert.ok(
    !source.includes("participantAuthCookie: facilitatorAuthCookie"),
  );
  assert.ok(
    !source.includes("participantAuthCookie: `auth_session=${facilitatorRawAuthToken}`"),
  );
  assert.ok(source.includes("never the facilitator cookie"));
});

test("4. participant UserSession is tracked in cleanup manifest", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  assert.ok(source.includes('track("UserSession", facilitatorUserSessionId)'));
  assert.ok(source.includes('track("UserSession", participantUserSessionId)'));
  assert.ok(source.includes('"UserSession"'));
});

test("5. canonical cookie uses generateSessionToken / hashSessionToken", () => {
  const token = generateSessionToken();
  assert.match(token, /^[a-f0-9]{64}$/i);
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  assert.ok(source.includes('from "@/lib/auth/crypto"'));
  assert.ok(source.includes("hashSessionToken(facilitatorRawAuthToken)"));
  assert.ok(source.includes("hashSessionToken(participantRawAuthToken)"));
});

test("10. unsafe DB target is refused before fixture writes", async () => {
  await assert.rejects(
    () =>
      cleanupPocSessionEntities({
        manifest: {
          runId: "r",
          namespace: namespaceForRunId("r"),
          createdAt: new Date().toISOString(),
          databaseTargetSanitized: "postgres://example.com:5432/x",
          entities: [],
        },
        databaseUrl: "postgres://example.com:5432/negotiations",
        confirmLocalDbWrite: true,
        dryRun: true,
      }),
    (error: unknown) =>
      error instanceof LocalDbSafetyError &&
      error.code === "UNSAFE_DATABASE_TARGET",
  );
});

test("11. local DB confirmation is required for cleanup writes", async () => {
  await assert.rejects(
    () =>
      cleanupPocSessionEntities({
        manifest: {
          runId: "r",
          namespace: namespaceForRunId("r"),
          createdAt: new Date().toISOString(),
          databaseTargetSanitized: "postgres://localhost:5432/negotiations",
          entities: [],
        },
        databaseUrl: "postgres://localhost:5432/negotiations",
        confirmLocalDbWrite: false,
        dryRun: true,
      }),
    (error: unknown) =>
      error instanceof LocalDbSafetyError &&
      error.code === "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED",
  );
});

test("12. cleanup order deletes UserSession before User", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  const orderIdx = source.indexOf('const order: PocCleanupEntityKind[]');
  const userSessionIdx = source.indexOf('"UserSession"', orderIdx);
  const userIdx = source.indexOf('"User"', orderIdx + 10);
  assert.ok(orderIdx >= 0);
  assert.ok(userSessionIdx > orderIdx);
  assert.ok(userIdx > userSessionIdx);
});

test("17. production auth session module remains unchanged contract", () => {
  const sessionSource = readFileSync(
    join(process.cwd(), "lib/auth/session.ts"),
    "utf8",
  );
  assert.ok(sessionSource.includes('const COOKIE_NAME = "auth_session"'));
  assert.ok(sessionSource.includes("generateSessionToken()"));
  assert.ok(sessionSource.includes("hashSessionToken(token)"));
  assert.ok(!sessionSource.includes("poc-vox-server-stop"));
});
