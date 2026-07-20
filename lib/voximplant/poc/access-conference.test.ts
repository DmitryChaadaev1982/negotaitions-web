import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import { resolveVoximplantConferenceNameForAccess } from "@/lib/voximplant/poc/conference-join-flag";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

/**
 * Route-level conference-name contract for WebSDK access payload.
 * Mocks: matching POC Session + ACTIVE local state (no DB fixtures).
 */
function buildAccessPayloadConferenceName(
  sessionId: string,
  env: NodeJS.ProcessEnv,
  stateRoot: string,
): {
  roomNameOrConferenceName: string;
  provider: "voximplant";
  sessionId: string;
} {
  // Mirrors app/api/sessions/[sessionId]/voximplant/access/route.ts
  // buildBrowserSafePayload conference field selection.
  return {
    provider: "voximplant",
    sessionId,
    roomNameOrConferenceName: resolveVoximplantConferenceNameForAccess(
      sessionId,
      env,
      stateRoot,
    ),
  };
}

test("access payload contains exact POC conference name for ACTIVE matching state", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-access-"));
  const sessionId = "cmrt0y4hy00008oua0m84eje1";
  let state = createEmptyPocState({
    pocId: "poc-access",
    conferenceName: "neg-poc-server-stop-1784539998331",
    linkedSessionId: sessionId,
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "4886441082",
    mediaSessionAccessUrl: "https://example.invalid/session/secret-url-token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/secret-url-token",
    ruleId: "9175667",
    applicationId: null,
    startedAt: new Date().toISOString(),
    idleTtlMs: 60_000,
  });
  writePocState(state, cwd);

  const payload = buildAccessPayloadConferenceName(
    sessionId,
    {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
    },
    cwd,
  );

  assert.equal(
    payload.roomNameOrConferenceName,
    "neg-poc-server-stop-1784539998331",
  );
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("secret-url-token"));
  assert.ok(!serialized.includes("/session/"));
  assert.ok(!serialized.includes("CONTROL_SECRET"));
  assert.ok(!serialized.includes("CALLBACK_SECRET"));
});

test("flag disabled preserves negotiation-{sessionId} in access payload", () => {
  const sessionId = "cmrt0y4hy00008oua0m84eje1";
  const payload = buildAccessPayloadConferenceName(
    sessionId,
    { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false" },
    mkdtempSync(join(tmpdir(), "poc-access-")),
  );
  assert.equal(
    payload.roomNameOrConferenceName,
    buildVoximplantConferenceName(sessionId),
  );
});

test("access route source wires resolver and has no production default change without flag", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/sessions/[sessionId]/voximplant/access/route.ts"),
    "utf8",
  );
  assert.match(source, /resolveVoximplantConferenceNameForAccess/);
  assert.match(
    source,
    /Default remains negotiation-\{sessionId\}/,
  );
});
