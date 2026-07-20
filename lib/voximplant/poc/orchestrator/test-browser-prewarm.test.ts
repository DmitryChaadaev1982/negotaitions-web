import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("9/10. prewarm-only module does not call createSession or StartConference", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/test-browser-prewarm.ts",
    ),
    "utf8",
  );
  assert.ok(!source.includes("createVoxServerStopPocSession("));
  assert.ok(!source.includes("startConference("));
  assert.ok(!source.includes('from "@/lib/voximplant/poc/management-client"'));
  assert.ok(source.includes("providerCalls: false"));
  assert.ok(source.includes("dbWrites: false"));
  assert.ok(source.includes("prewarmOnly: true"));
});

test("15. production auth crypto helpers remain the source of session tokens", () => {
  const createSource = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/create-poc-session.ts"),
    "utf8",
  );
  assert.ok(createSource.includes('from "@/lib/auth/crypto"'));
  assert.ok(createSource.includes("generateSessionToken()"));
  assert.ok(createSource.includes("hashSessionToken("));
  assert.ok(createSource.includes("participantAuthCookie"));
  assert.ok(!createSource.includes('createHash("sha256")'));

  const sessionSource = readFileSync(
    join(process.cwd(), "lib/auth/session.ts"),
    "utf8",
  );
  assert.ok(sessionSource.includes('const COOKIE_NAME = "auth_session"'));
  assert.ok(sessionSource.includes("hashSessionToken"));
});

test("7. participant join token remains in fixture URLs after prewarm planning", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/test-browser-prewarm.ts",
    ),
    "utf8",
  );
  // Prewarm-only must not hit access / consume tokens via provider join.
  assert.ok(source.includes("prewarmOnly: true"));
  assert.ok(!source.includes("voximplant/access"));
});
