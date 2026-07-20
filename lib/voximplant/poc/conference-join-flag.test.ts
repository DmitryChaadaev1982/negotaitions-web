import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  planPocConferenceJoin,
  resolveVoximplantConferenceNameForAccess,
  tryResolvePocConferenceName,
} from "@/lib/voximplant/poc/conference-join-flag";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  markPocStateExpired,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

function writeActivePocState(
  cwd: string,
  params: {
    conferenceName: string;
    linkedSessionId: string;
    pocId?: string;
  },
) {
  let state = createEmptyPocState({
    pocId: params.pocId ?? `poc-${params.linkedSessionId}`,
    conferenceName: params.conferenceName,
    linkedSessionId: params.linkedSessionId,
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "111",
    mediaSessionAccessUrl: "https://example.invalid/session/secret-url-token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/secret-url-token",
    ruleId: "9",
    applicationId: "8",
    startedAt: new Date().toISOString(),
    idleTtlMs: 60_000,
  });
  writePocState(state, cwd);
  return state;
}

test("feature flag disabled preserves existing flow", () => {
  const sessionId = "sess-normal-1";
  const name = resolveVoximplantConferenceNameForAccess(sessionId, {
    VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false",
  });
  assert.equal(name, buildVoximplantConferenceName(sessionId));
});

test("matching ACTIVE POC state selects POC conference", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-join-"));
  writeActivePocState(cwd, {
    conferenceName: "neg-poc-server-stop-999",
    linkedSessionId: "cmrt0y4hy00008oua0m84eje1",
  });

  const pocName = tryResolvePocConferenceName(
    "cmrt0y4hy00008oua0m84eje1",
    { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
    cwd,
  );
  assert.equal(pocName, "neg-poc-server-stop-999");
});

test("wrong Session preserves normal conference", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-join-"));
  writeActivePocState(cwd, {
    conferenceName: "neg-poc-server-stop-999",
    linkedSessionId: "cmrt0y4hy00008oua0m84eje1",
  });

  const normal = resolveVoximplantConferenceNameForAccess(
    "sess-normal-2",
    { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
    cwd,
  );
  assert.equal(normal, buildVoximplantConferenceName("sess-normal-2"));
});

test("expired state does not reuse POC conference / control URL path", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-join-"));
  let state = createEmptyPocState({
    pocId: "poc-1",
    conferenceName: "neg-poc-server-stop-999",
    linkedSessionId: "cmrt0y4hy00008oua0m84eje1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "111",
    mediaSessionAccessUrl: "https://example.invalid/session/secret-url-token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/secret-url-token",
    ruleId: "9",
    applicationId: "8",
    startedAt: "2026-07-20T09:33:18.790Z",
    idleTtlMs: 60_000,
  });
  state = markPocStateExpired(state);
  writePocState(state, cwd);

  const name = resolveVoximplantConferenceNameForAccess(
    "cmrt0y4hy00008oua0m84eje1",
    {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
    },
    cwd,
  );
  assert.equal(name, buildVoximplantConferenceName("cmrt0y4hy00008oua0m84eje1"));

  const plan = planPocConferenceJoin({
    sessionId: "cmrt0y4hy00008oua0m84eje1",
    env: {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
    },
    stateRoot: cwd,
  });
  assert.equal(plan.selectionSource, "DEFAULT_SESSION_NAME");
  assert.equal(plan.wouldSelectIfActive, "neg-poc-server-stop-999");
  assert.match(
    plan.refusalOrFallbackReason ?? "",
    /POC_STATE_EXPIRED/,
  );
  assert.ok(!JSON.stringify(plan).includes("secret-url-token"));
  assert.ok(!JSON.stringify(plan).includes("/session/"));
});

test("normal Sessions remain unchanged when flag enabled without POC marker", () => {
  const sessionId = "cm123normal";
  const name = resolveVoximplantConferenceNameForAccess(sessionId, {
    VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
  });
  assert.equal(name, `negotiation-${sessionId}`);
});

test("normal production/default room flow remains unchanged without POC flag", () => {
  const sessionId = "sess-production-default";
  const name = resolveVoximplantConferenceNameForAccess(sessionId, {
    VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false",
    VOXIMPLANT_SERVER_STOP_POC_RULE_ID: "poc-rule-should-not-affect-rooms",
  });
  assert.equal(name, buildVoximplantConferenceName(sessionId));
  assert.equal(name, `negotiation-${sessionId}`);
});

test("join-plan output is sanitized", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-join-"));
  writeActivePocState(cwd, {
    conferenceName: "neg-poc-server-stop-abc",
    linkedSessionId: "cmrt0y4hy00008oua0m84eje1",
  });
  const plan = planPocConferenceJoin({
    sessionId: "cmrt0y4hy00008oua0m84eje1",
    env: {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
      VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET: "control-secret-value-16!!",
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: "callback-secret-value-16!",
    },
    stateRoot: cwd,
  });
  assert.equal(plan.selectionSource, "POC_STATE");
  assert.equal(plan.selectedConferenceName, "neg-poc-server-stop-abc");
  const serialized = JSON.stringify(plan);
  assert.ok(!serialized.includes("control-secret-value"));
  assert.ok(!serialized.includes("callback-secret-value"));
  assert.ok(!serialized.includes("secret-url-token"));
});

test("access route dynamically selects matching run without env session id", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-join-"));
  writeActivePocState(cwd, {
    conferenceName: "neg-poc-server-stop-dyn-1",
    linkedSessionId: "session-dyn-1",
  });
  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "session-dyn-1",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
    ),
    "neg-poc-server-stop-dyn-1",
  );

  // Activate a new run for a different Session — no env edit / restart.
  writeActivePocState(cwd, {
    conferenceName: "neg-poc-server-stop-dyn-2",
    linkedSessionId: "session-dyn-2",
  });
  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "session-dyn-2",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
    ),
    "neg-poc-server-stop-dyn-2",
  );
  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "session-dyn-1",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
    ),
    buildVoximplantConferenceName("session-dyn-1"),
  );
});
