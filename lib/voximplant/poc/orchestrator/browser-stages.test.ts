import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveVoximplantConferenceNameForAccess } from "@/lib/voximplant/poc/conference-join-flag";
import { persistBrowserContextArtifacts } from "@/lib/voximplant/poc/orchestrator/browser-artifacts";
import {
  classifyAccessHttpStatus,
  classifyBrowserFailure,
  emptyBrowserContextEvidence,
  markFailed,
  sanitizeConsoleMessage,
  sanitizePageUrl,
} from "@/lib/voximplant/poc/orchestrator/browser-stages";
import { buildDryRunPlan } from "@/lib/voximplant/poc/orchestrator/run-orchestrator";
import { plannedPhasesForMode } from "@/lib/voximplant/poc/orchestrator/types";

test("typed access HTTP statuses", () => {
  assert.equal(classifyAccessHttpStatus(401), "ACCESS_ROUTE_UNAUTHORIZED");
  assert.equal(classifyAccessHttpStatus(403), "ACCESS_ROUTE_FORBIDDEN");
  assert.equal(classifyAccessHttpStatus(404), "ACCESS_ROUTE_NOT_FOUND");
  assert.equal(classifyAccessHttpStatus(500), "ACCESS_ROUTE_SERVER_ERROR");
  assert.equal(classifyAccessHttpStatus(418), "ACCESS_ROUTE_FAILED");
});

test("6. default conference selection fails with typed error", () => {
  const facilitator = markFailed(
    emptyBrowserContextEvidence("facilitator", "s1"),
    "POC_CONFERENCE_SELECTED",
    "ACCESS_SELECTED_DEFAULT_CONFERENCE",
  );
  const participant = emptyBrowserContextEvidence("participant", "s1");
  assert.equal(
    classifyBrowserFailure({
      facilitator,
      participant,
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "ACCESS_SELECTED_DEFAULT_CONFERENCE",
  );
});

test("7/8. facilitator and participant auth failures are distinct", () => {
  const fac = markFailed(
    emptyBrowserContextEvidence("facilitator", "s1"),
    "AUTH_ACCEPTED",
    "FACILITATOR_AUTH_FAILED",
  );
  const part = markFailed(
    emptyBrowserContextEvidence("participant", "s1"),
    "AUTH_ACCEPTED",
    "PARTICIPANT_AUTH_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: fac,
      participant: emptyBrowserContextEvidence("participant", "s1"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "FACILITATOR_AUTH_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: emptyBrowserContextEvidence("facilitator", "s1"),
      participant: part,
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "PARTICIPANT_AUTH_FAILED",
  );
});

test("cookie install and participant setup failures are distinct from BROWSER_LAUNCHED", () => {
  assert.equal(
    classifyBrowserFailure({
      facilitator: markFailed(
        emptyBrowserContextEvidence("facilitator", "s1"),
        "AUTH_CONTEXT_CREATED",
        "AUTH_COOKIE_INSTALL_FAILED",
      ),
      participant: emptyBrowserContextEvidence("participant", "s1"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "AUTH_COOKIE_INSTALL_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: emptyBrowserContextEvidence("facilitator", "s1"),
      participant: markFailed(
        emptyBrowserContextEvidence("participant", "s1"),
        "AUTH_CONTEXT_CREATED",
        "PARTICIPANT_CONTEXT_SETUP_FAILED",
      ),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "PARTICIPANT_CONTEXT_SETUP_FAILED",
  );
});

test("10/11/12. media/sdk/call typed failures", () => {
  assert.equal(
    classifyBrowserFailure({
      facilitator: markFailed(
        emptyBrowserContextEvidence("facilitator", "s"),
        "BROWSER_LAUNCHED",
        "MEDIA_PERMISSION_FAILED",
      ),
      participant: emptyBrowserContextEvidence("participant", "s"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "MEDIA_PERMISSION_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: markFailed(
        emptyBrowserContextEvidence("facilitator", "s"),
        "VOX_SDK_INITIALIZED",
        "VOX_SDK_INIT_FAILED",
      ),
      participant: emptyBrowserContextEvidence("participant", "s"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "VOX_SDK_INIT_FAILED",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: markFailed(
        emptyBrowserContextEvidence("facilitator", "s"),
        "CALL_CONNECTED",
        "VOX_CALL_TIMEOUT",
      ),
      participant: emptyBrowserContextEvidence("participant", "s"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: false,
    }),
    "VOX_CALL_TIMEOUT",
  );
});

test("13/14. provider expiry typed failures take precedence", () => {
  assert.equal(
    classifyBrowserFailure({
      facilitator: emptyBrowserContextEvidence("facilitator", "s"),
      participant: emptyBrowserContextEvidence("participant", "s"),
      mediaSessionExpiredBeforeAccess: true,
      mediaSessionExpiredDuringJoin: false,
    }),
    "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS",
  );
  assert.equal(
    classifyBrowserFailure({
      facilitator: emptyBrowserContextEvidence("facilitator", "s"),
      participant: emptyBrowserContextEvidence("participant", "s"),
      mediaSessionExpiredBeforeAccess: false,
      mediaSessionExpiredDuringJoin: true,
    }),
    "MEDIA_SESSION_EXPIRED_DURING_JOIN",
  );
});

test("16. browser failure artifacts are retained", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-art-"));
  const runId = "run-artifact-1";
  const dirs = persistBrowserContextArtifacts({
    runId,
    stateRoot,
    facilitator: markFailed(
      emptyBrowserContextEvidence("facilitator", "sess"),
      "ACCESS_REQUEST_SENT",
      "ACCESS_ROUTE_FAILED",
    ),
    participant: emptyBrowserContextEvidence("participant", "sess"),
  });
  assert.ok(existsSync(join(dirs.facilitatorDir, "browser-state.json")));
  assert.ok(existsSync(join(dirs.participantDir, "access-selection.json")));
  const text = readFileSync(
    join(dirs.facilitatorDir, "browser-state.json"),
    "utf8",
  );
  assert.ok(!text.includes("auth_session="));
  assert.ok(!text.includes("joinToken="));
});

test("17. inspection sanitizers redact tokens and control URLs", () => {
  assert.equal(
    sanitizePageUrl(
      "http://localhost:3000/room/sess?joinToken=secret-token-value",
    ),
    "/room/sess?joinToken=[redacted]",
  );
  const msg = sanitizeConsoleMessage(
    "failed Bearer abc.def joinToken=xyz auth_session=tok https://host/request/CAPABILITY",
  );
  assert.ok(!msg.includes("xyz"));
  assert.ok(msg.includes("[redacted]"));
  assert.ok(msg.includes("[redacted-control-url]"));
});

test("20. production/default flow remains unchanged", () => {
  assert.equal(
    resolveVoximplantConferenceNameForAccess("ordinary-session", {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false",
    }),
    "negotiation-ordinary-session",
  );
});

test("planned phases include browser_prewarm before start_conference", () => {
  const phases = plannedPhasesForMode("full");
  const prewarmIdx = phases.indexOf("browser_prewarm");
  const startIdx = phases.indexOf("start_conference");
  assert.ok(prewarmIdx >= 0);
  assert.ok(startIdx > prewarmIdx);
  const plan = buildDryRunPlan({
    mode: "full",
    dryRun: true,
    confirmLivePoc: false,
    confirmLocalDbWrite: false,
    keepSession: false,
    keepBrowser: false,
    skipLogFetch: true,
    timeoutSeconds: null,
    appBaseUrl: "http://localhost:3000",
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
  });
  assert.deepEqual(plan.plannedPhases, phases);
});
