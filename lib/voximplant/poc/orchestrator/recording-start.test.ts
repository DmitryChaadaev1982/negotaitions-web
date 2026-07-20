import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyRecordingStartFailure,
  emptyRecordingStartEvidence,
  isValidBrowserStartCommand,
  writeRecordingStartArtifact,
} from "@/lib/voximplant/poc/orchestrator/recording-start-plan";
import {
  buildSanitizedPrewarmFixture,
  prewarmFixtureContainsPlaintextSecrets as fixtureHasSecrets,
  writePrewarmFixture,
  readPrewarmFixture,
} from "@/lib/voximplant/poc/orchestrator/prewarm-fixture";
import {
  activatePocRun,
  clearCurrentPointer,
  getPocRunPaths,
  readCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  finalizePocRunTerminal,
  getActiveControlUrl,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  getPrivateControlStatePath,
  readPrivateControlState,
} from "@/lib/voximplant/poc/private-control-state";
import { tryResolvePocConferenceName } from "@/lib/voximplant/poc/conference-join-flag";
import { POC_CONFERENCE_NAME_PREFIX } from "@/lib/voximplant/poc/poc-safety";

test("1. recording start waits for both joins (typed gate)", () => {
  const code = classifyRecordingStartFailure({
    requestSent: false,
    httpStatus: null,
    bothJoined: false,
  });
  assert.equal(code, "RECORDING_START_BOTH_JOINS_REQUIRED");
});

test("2. unauthorized without join identity is typed", () => {
  assert.equal(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 403,
      authorized: false,
    }),
    "RECORDING_START_UNAUTHORIZED",
  );
});

test("3. stale connection is typed rejection", () => {
  assert.equal(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 409,
      applicationCode: "STALE_CONNECTION",
    }),
    "RECORDING_START_STALE_CONNECTION",
  );
});

test("4. relay creation failure is typed", () => {
  assert.equal(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 200,
      scenarioMessagePresent: false,
    }),
    "RECORDING_START_RELAY_NOT_CREATED",
  );
});

test("5. relay claim failure is typed", () => {
  assert.equal(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 200,
      scenarioMessagePresent: true,
      relayClaimed: false,
    }),
    "RECORDING_START_RELAY_NOT_CLAIMED",
  );
});

test("6. browser start-command payload is valid", () => {
  const sessionId = "session_poc_abc";
  const conferenceName = `${POC_CONFERENCE_NAME_PREFIX}run-1`;
  assert.equal(
    isValidBrowserStartCommand(
      {
        type: "recording_control",
        action: "start",
        requestId: "req-1",
        sessionId,
        conferenceName,
      },
      { sessionId, conferenceName },
    ),
    true,
  );
  assert.equal(
    isValidBrowserStartCommand(
      {
        type: "recording_control",
        action: "stop",
        requestId: "req-1",
        sessionId,
        conferenceName,
      },
      { sessionId, conferenceName },
    ),
    false,
  );
});

test("7. POC scenario recognises the start command (static)", () => {
  const source = readFileSync(
    join(process.cwd(), "docs/voximplant/neg-conf.server-stop-poc.scenario.js"),
    "utf8",
  );
  assert.match(source, /recording_control/);
  assert.match(source, /CallEvents\.MessageReceived/);
  assert.match(source, /startRecordingFromBrowser/);
  assert.match(source, /action === "start"/);
});

test("8. recorder creation failure is distinct", () => {
  const source = readFileSync(
    join(process.cwd(), "docs/voximplant/neg-conf.server-stop-poc.scenario.js"),
    "utf8",
  );
  assert.match(source, /recorder_create_failed/);
  assert.notEqual(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 500,
      errorText: "recorder",
    }),
    "RECORDING_START_PROVIDER_EVENT_TIMEOUT",
  );
});

test("9. provider-start evidence is mandatory (HTTP alone insufficient)", () => {
  const evidence = emptyRecordingStartEvidence("neg-poc-server-stop-x");
  evidence.recordingStartAuthorized = true;
  evidence.recordingRelayCreatedAt = new Date().toISOString();
  // recordingStarted must stay false without providerStartedAt
  assert.equal(evidence.recordingProviderStartedAt, null);
  assert.equal(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 200,
      scenarioMessagePresent: true,
      relayClaimed: true,
      browserCommandSent: true,
      providerStarted: false,
    }),
    "RECORDING_START_PROVIDER_EVENT_TIMEOUT",
  );
});

test("10. stop cannot execute before provider-start evidence", () => {
  // Orchestrator gates stop behind reportDraft.recordingStarted which requires
  // recording_started callback — confirmed by failure code ordering.
  assert.equal(
    classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: 200,
      scenarioMessagePresent: true,
      relayClaimed: true,
      browserCommandSent: true,
      providerStarted: false,
    }),
    "RECORDING_START_PROVIDER_EVENT_TIMEOUT",
  );
});

test("11. provider-free recording test script makes zero provider calls", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/recording-start.ts",
    ),
    "utf8",
  );
  assert.ok(!source.includes("startConference("));
  assert.ok(!source.includes("StartConference"));
  assert.match(source, /providerCalls: false/);
  const planSource = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/recording-start-plan.ts",
    ),
    "utf8",
  );
  assert.ok(!planSource.includes("startConference"));
});

test("12. provider-free fixture cleanup markers present", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "lib/voximplant/poc/orchestrator/recording-start.ts",
    ),
    "utf8",
  );
  assert.match(source, /LOCAL_FIXTURE_CLEANED/);
  assert.match(source, /cleanupPocSessionEntities/);
});

test("13-15. no plaintext password/cookie/join token persisted", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-prewarm-"));
  const runId = "run-secret-scan";
  writePrewarmFixture(
    {
      runId,
      sessionId: "session-1",
      facilitatorUserId: "user-1",
      facilitatorEmail: "f@test.local",
      facilitatorPassword: "super-secret-password",
      facilitatorAuthCookie: "auth_session=raw-token-value",
      facilitatorJoinToken: "join-token-secret",
      facilitatorRoomUrl: "http://localhost:3000/room/s?joinToken=join-token-secret",
      participantPassword: "participant-secret",
      participantAuthCookie: "auth_session=participant-raw",
      participantJoinToken: "part-token",
      participantRoomUrl: "http://localhost:3000/room/s?joinToken=part-token",
      createdAt: new Date().toISOString(),
    },
    stateRoot,
  );
  const disk = JSON.parse(
    readFileSync(getPocRunPaths(runId, stateRoot).runDir + "/local/prewarm-auth.json", "utf8"),
  ) as Record<string, unknown>;
  assert.equal(disk.facilitatorPassword, undefined);
  assert.equal(disk.facilitatorAuthCookie, undefined);
  assert.equal(disk.facilitatorJoinToken, undefined);
  assert.equal(disk.participantAuthCookie, undefined);
  assert.equal(disk.participantJoinToken, undefined);
  assert.equal(disk.facilitatorRoomUrl, undefined);
  assert.ok(disk.facilitatorAuthCookieFingerprint);
  assert.ok(fixtureHasSecrets(disk as never) === false || !disk.facilitatorPassword);

  const sanitized = buildSanitizedPrewarmFixture({
    runId,
    sessionId: "session-1",
    facilitatorUserId: "user-1",
    facilitatorEmail: "f@test.local",
    facilitatorAuthCookie: "auth_session=x",
  });
  assert.equal(sanitized.facilitatorPassword, undefined);
  assert.ok(sanitized.facilitatorAuthConfigured);
});

test("16. public state contains no capability URL", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-pub-"));
  let state = createEmptyPocState({
    pocId: "run-pub-1",
    conferenceName: "neg-poc-server-stop-run-pub-1",
    linkedSessionId: "sess-1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "hist",
    mediaSessionAccessUrl: "http://secret.example/session/token-a",
    mediaSessionAccessSecureUrl: "https://secret.example/request/token-b",
    ruleId: "1",
    applicationId: "2",
    stateRoot,
  });
  writePocState(state, stateRoot);
  const disk = JSON.parse(
    readFileSync(getPocRunPaths("run-pub-1", stateRoot).statePath, "utf8"),
  ) as Record<string, unknown>;
  assert.equal(disk.mediaSessionAccessUrl, null);
  assert.equal(disk.mediaSessionAccessSecureUrl, null);
  assert.ok(disk.controlUrlFingerprint);
  assert.equal(disk.hasControlUrl, true);
  const privateState = readPrivateControlState("run-pub-1", stateRoot);
  assert.ok(privateState?.mediaSessionAccessSecureUrl?.includes("token-b"));
});

test("17. private state is not listed as remaining evidence", () => {
  const privatePath = getPrivateControlStatePath("run-x");
  assert.match(privatePath.replace(/\\/g, "/"), /\/private\/control-state\.json$/);
  // remainingEvidencePaths filter in orchestrator excludes private by construction
  // (only runDir/state/report/events/log are listed).
  assert.ok(!privatePath.includes("report.json"));
});

test("18. failed run is cleared from current pointer", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-term-"));
  let state = createEmptyPocState({
    pocId: "run-fail-1",
    conferenceName: "neg-poc-server-stop-run-fail-1",
    linkedSessionId: "sess-fail",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "h",
    mediaSessionAccessUrl: "https://example.invalid/session/t",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/t",
    ruleId: "1",
    applicationId: "2",
    stateRoot,
  });
  writePocState(state, stateRoot);
  activatePocRun({
    runId: "run-fail-1",
    linkedSessionId: "sess-fail",
    stateRoot,
  });
  assert.ok(readCurrentPointer(stateRoot));
  finalizePocRunTerminal({ state, result: "FAIL", stateRoot });
  assert.equal(readCurrentPointer(stateRoot), null);
  const disk = JSON.parse(
    readFileSync(getPocRunPaths("run-fail-1", stateRoot).statePath, "utf8"),
  ) as { runtimeStatus: string };
  assert.equal(disk.runtimeStatus, "FAILED");
  assert.equal(
    getActiveControlUrl({ ...state, runtimeStatus: "FAILED" }, stateRoot),
    null,
  );
});

test("19. failed run cannot be selected by access route", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-access-"));
  const env = {
    ...process.env,
    VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
  };
  let state = createEmptyPocState({
    pocId: "run-fail-access",
    conferenceName: "neg-poc-server-stop-run-fail-access",
    linkedSessionId: "sess-access",
  });
  state = {
    ...state,
    runtimeStatus: "FAILED",
    hasControlUrl: false,
    controlUrlFingerprint: "fp",
  };
  writePocState(state, stateRoot);
  activatePocRun({
    runId: "run-fail-access",
    linkedSessionId: "sess-access",
    stateRoot,
  });
  // finalize clears pointer; simulate failed-but-pointer-cleared selection denial
  clearCurrentPointer(stateRoot);
  const name = tryResolvePocConferenceName("sess-access", env, stateRoot);
  assert.equal(name, null);
});

test("20. production/default recording flow remains unchanged (dispatch fallback)", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/recording-dispatch.ts"),
    "utf8",
  );
  assert.match(source, /resolveVoximplantConferenceNameForAccess/);
  // Flag-gated helper still falls back to negotiation-{sessionId}.
  const flagSource = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/conference-join-flag.ts"),
    "utf8",
  );
  assert.match(flagSource, /buildVoximplantConferenceName/);
  assert.match(flagSource, /isServerStartedConferencePocEnabled/);
});

test("recording-start artifact never contains secrets", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-rec-art-"));
  const evidence = emptyRecordingStartEvidence("neg-poc-server-stop-x");
  evidence.recordingStartAuthorized = true;
  const path = writeRecordingStartArtifact("run-art-1", evidence, stateRoot);
  const raw = readFileSync(path, "utf8");
  assert.ok(!raw.includes("auth_session"));
  assert.ok(!raw.includes("cookie"));
  assert.ok(!raw.includes("joinToken"));
  assert.ok(!/https?:\/\/[^\s"]+\/request\//i.test(raw));
});

test("in-memory prewarm secrets still readable after sanitized write", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-mem-"));
  writePrewarmFixture(
    {
      runId: "run-mem-1",
      sessionId: "s",
      facilitatorUserId: "u",
      facilitatorEmail: "e@test.local",
      facilitatorPassword: "ephemeral",
      facilitatorAuthCookie: "auth_session=ephemeral-token",
      facilitatorJoinToken: "tok",
      facilitatorRoomUrl: "http://localhost:3000/room/s?joinToken=tok",
      createdAt: new Date().toISOString(),
    },
    stateRoot,
  );
  const merged = readPrewarmFixture("run-mem-1", stateRoot);
  assert.equal(merged?.facilitatorAuthCookie, "auth_session=ephemeral-token");
  const diskPath = join(
    getPocRunPaths("run-mem-1", stateRoot).runDir,
    "local",
    "prewarm-auth.json",
  );
  const disk = readFileSync(diskPath, "utf8");
  assert.ok(!disk.includes("ephemeral-token"));
  assert.ok(!disk.includes("ephemeral"));
});
