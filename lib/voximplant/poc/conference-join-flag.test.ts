import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  resolveVoximplantConferenceNameForAccess,
  tryResolvePocConferenceName,
} from "@/lib/voximplant/poc/conference-join-flag";
import {
  createEmptyPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

test("feature flag disabled preserves existing flow", () => {
  const sessionId = "sess-normal-1";
  const name = resolveVoximplantConferenceNameForAccess(sessionId, {
    VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false",
  });
  assert.equal(name, buildVoximplantConferenceName(sessionId));
});

test("POC flag affects only explicitly selected local POC Session", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-join-"));
  const state = createEmptyPocState({
    pocId: "poc-1",
    conferenceName: "neg-poc-server-stop-999",
    linkedSessionId: "poc-server-stop-local-1",
  });
  writePocState(state, cwd);

  const pocName = tryResolvePocConferenceName(
    "poc-server-stop-local-1",
    { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
    cwd,
  );
  assert.equal(pocName, "neg-poc-server-stop-999");

  const normal = resolveVoximplantConferenceNameForAccess(
    "sess-normal-2",
    { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
    cwd,
  );
  assert.equal(normal, buildVoximplantConferenceName("sess-normal-2"));
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
    VOXIMPLANT_SERVER_STOP_POC_CONFERENCE_NAME: "neg-poc-server-stop-ignored",
  });
  assert.equal(name, buildVoximplantConferenceName(sessionId));
  assert.equal(name, `negotiation-${sessionId}`);
});
