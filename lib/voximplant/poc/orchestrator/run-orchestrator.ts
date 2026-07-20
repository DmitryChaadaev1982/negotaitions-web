import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

import {
  buildDeterministicStopOperationId,
  getPocControlSecret,
  sendPocControlCommand,
} from "@/lib/voximplant/poc/control-command";
import {
  cleanupPocSessionEntities,
  createVoxServerStopPocSession,
  type CreateVoxServerStopPocSessionResult,
  type PocCleanupManifest,
} from "@/lib/voximplant/poc/create-poc-session";
import { getCallHistoryForPoc } from "@/lib/voximplant/poc/history-client";
import {
  assertSafeLocalDatabaseTarget,
  LocalDbSafetyError,
} from "@/lib/voximplant/poc/local-db-safety";
import {
  resolvePocManagementConfig,
  sanitizePocManagementConfig,
  startConference,
} from "@/lib/voximplant/poc/management-client";
import { executePocPing } from "@/lib/voximplant/poc/ping-command";
import {
  getPocWorktreeDiagnostic,
} from "@/lib/voximplant/poc/poc-paths";
import {
  activatePocRun,
  clearCurrentPointer,
  ensurePocRunDir,
  writeJsonArtifact,
  writeTextArtifact,
} from "@/lib/voximplant/poc/poc-run-store";
import { POC_CONFERENCE_NAME_PREFIX, PocSafetyError } from "@/lib/voximplant/poc/poc-safety";
import { writePrewarmFixture } from "@/lib/voximplant/poc/orchestrator/prewarm-fixture";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  finalizePocRunTerminal,
  findMatchingCallbackEvent,
  getActiveControlUrl,
  isPocStopSuccessful,
  readPocState,
  recordStopTransportAccepted,
  seedWaitingForProviderSession,
  toPublicPocStateView,
  writePocState,
  type VoximplantServerStopPocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  correlateProviderSessionIds,
  isProviderSessionRegistered,
} from "@/lib/voximplant/poc/session-registration";
import {
  POC_EXPECTED_SCENARIO_BUILD,
} from "@/lib/voximplant/poc/poc-safety";
import {
  emptyRecordingStartEvidence,
  requestRecordingStartViaHttp,
  writeRecordingStartArtifact,
  type RecordingStartEvidence,
} from "@/lib/voximplant/poc/orchestrator/recording-start-plan";

import {
  playwrightBrowserPrewarm,
  type BrowserJoinFn,
  type BrowserJoinResult,
  type BrowserPrewarmFn,
  type BrowserPrewarmHandle,
} from "./browser-join";
import {
  runCallbackSelfTest,
  type CallbackSelfTestResult,
} from "./callback-self-test";
import type { PocHealthDiagnostics } from "@/lib/voximplant/poc/poc-health";
import {
  DEFAULT_POC_PHASE_TIMEOUTS,
  evaluateFullPass,
  evaluateTransportPass,
  isDryRunExecution,
  plannedPhasesForMode,
  POC_DRY_RUN_BANNER,
  type PocFailureStage,
  type PocOrchestratorOptions,
  type PocOrchestratorReport,
  type PocOrchestratorResult,
  type PocPhaseTimeouts,
} from "./types";

function applyHealthDiagnosticsToReport(
  draft: Omit<PocOrchestratorReport, "result">,
  diagnostics: PocHealthDiagnostics | null | undefined,
  details: Record<string, unknown>,
): void {
  const source = diagnostics ?? null;
  if (source) {
    draft.healthUrlPath = source.healthUrlPath;
    draft.healthHttpStatus = source.healthHttpStatus;
    draft.healthService = source.healthService;
    draft.healthProtocolVersion = source.healthProtocolVersion;
    draft.healthCallbackEnabled = source.healthCallbackEnabled;
    draft.healthWorktreeFingerprint = source.healthWorktreeFingerprint;
    draft.expectedWorktreeFingerprint = source.expectedWorktreeFingerprint;
    draft.healthBuildId = source.healthBuildId;
    draft.expectedBuildId = source.expectedBuildId;
    draft.healthFailureReason = source.healthFailureReason;
    return;
  }
  if (typeof details.healthUrlPath === "string") {
    draft.healthUrlPath = details.healthUrlPath;
  }
  if (
    typeof details.healthHttpStatus === "number" ||
    details.healthHttpStatus === null
  ) {
    draft.healthHttpStatus = details.healthHttpStatus as number | null;
  }
  if (typeof details.healthFailureReason === "string") {
    draft.healthFailureReason = details.healthFailureReason;
  }
  if (typeof details.expectedWorktreeFingerprint === "string") {
    draft.expectedWorktreeFingerprint = details.expectedWorktreeFingerprint;
  }
  if (typeof details.expectedBuildId === "string") {
    draft.expectedBuildId = details.expectedBuildId;
  }
}

export type OrchestratorDeps = {
  startConference?: typeof startConference;
  createSession?: typeof createVoxServerStopPocSession;
  cleanupSession?: typeof cleanupPocSessionEntities;
  sendControl?: typeof sendPocControlCommand;
  executePing?: typeof executePocPing;
  getCallHistory?: typeof getCallHistoryForPoc;
  /** Preferred: prewarm before StartConference, then liveJoin. */
  browserPrewarm?: BrowserPrewarmFn;
  /** Legacy single-shot join (tests may still mock this). */
  browserJoin?: BrowserJoinFn;
  callbackSelfTest?: (params: {
    callbackUrl: string;
    healthUrl: string;
    stateRoot?: string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  }) => Promise<CallbackSelfTestResult>;
  fetchImpl?: typeof fetch;
  resolveConfig?: typeof resolvePocManagementConfig;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

function mergeTimeouts(
  options: PocOrchestratorOptions,
): PocPhaseTimeouts {
  const base = { ...DEFAULT_POC_PHASE_TIMEOUTS, ...options.timeouts };
  if (options.timeoutSeconds != null) {
    const budget = options.timeoutSeconds * 1000;
    // Scale phase budgets proportionally but keep each bounded.
    const scale = Math.min(1, budget / 300_000);
    for (const key of Object.keys(base) as (keyof PocPhaseTimeouts)[]) {
      base[key] = Math.max(3_000, Math.floor(base[key] * Math.max(scale, 0.25)));
    }
  }
  return base;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCallback(params: {
  stateRoot?: string;
  operationId: string;
  eventType: string;
  action?: string | null;
  timeoutMs: number;
  pollMs?: number;
  sleep: (ms: number) => Promise<void>;
  nowMs: () => number;
}): Promise<boolean> {
  const deadline = params.nowMs() + params.timeoutMs;
  const poll = params.pollMs ?? 250;
  while (params.nowMs() < deadline) {
    const state = readPocState(params.stateRoot);
    if (
      state &&
      findMatchingCallbackEvent(state, {
        operationId: params.operationId,
        eventType: params.eventType,
        action: params.action,
      })
    ) {
      return true;
    }
    await params.sleep(poll);
  }
  return false;
}

async function waitForProviderSessionRegistration(params: {
  stateRoot?: string;
  timeoutMs: number;
  pollMs?: number;
  sleep: (ms: number) => Promise<void>;
  nowMs: () => number;
}): Promise<VoximplantServerStopPocState | null> {
  const deadline = params.nowMs() + params.timeoutMs;
  const poll = params.pollMs ?? 250;
  while (params.nowMs() < deadline) {
    const state = readPocState(params.stateRoot);
    if (state && isProviderSessionRegistered(state)) {
      return state;
    }
    if (state?.runtimeStatus === "FAILED") {
      return state;
    }
    await params.sleep(poll);
  }
  return readPocState(params.stateRoot);
}

function trySanitizeLocalDatabaseTarget(
  databaseUrl: string | null | undefined = process.env.DATABASE_URL,
): { sanitizedUrl: string | null; safe: boolean; error: string | null } {
  try {
    return {
      sanitizedUrl: assertSafeLocalDatabaseTarget(databaseUrl).sanitizedUrl,
      safe: true,
      error: null,
    };
  } catch (error) {
    return {
      sanitizedUrl: null,
      safe: false,
      error:
        error instanceof LocalDbSafetyError
          ? error.code
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

function emptyReport(partial: Partial<PocOrchestratorReport> & {
  runId: string;
  mode: PocOrchestratorReport["mode"];
  startedAt: string;
}): PocOrchestratorReport {
  const dryRun = partial.dryRun ?? false;
  return {
    runId: partial.runId,
    mode: partial.mode,
    dryRun,
    executionKind: partial.executionKind ?? (dryRun ? "DRY_RUN" : "LIVE"),
    startedAt: partial.startedAt,
    finishedAt: partial.finishedAt ?? partial.startedAt,
    durationMs: partial.durationMs ?? 0,
    worktree: partial.worktree ?? "unknown",
    branch: partial.branch ?? "unknown",
    localDatabaseTargetSanitized: partial.localDatabaseTargetSanitized ?? null,
    sessionId: partial.sessionId ?? null,
    conferenceName: partial.conferenceName ?? null,
    callSessionHistoryId: partial.callSessionHistoryId ?? null,
    controlUrlFingerprint: partial.controlUrlFingerprint ?? null,
    registeredProviderSessionId: partial.registeredProviderSessionId ?? null,
    browserProviderSessionId: partial.browserProviderSessionId ?? null,
    recordingProviderSessionId: partial.recordingProviderSessionId ?? null,
    stopProviderSessionId: partial.stopProviderSessionId ?? null,
    historyProviderSessionId: partial.historyProviderSessionId ?? null,
    providerScenarioBuild: partial.providerScenarioBuild ?? null,
    providerRuleIdentity: partial.providerRuleIdentity ?? null,
    singleProviderSessionConfirmed:
      partial.singleProviderSessionConfirmed ?? false,
    providerCalls: partial.providerCalls ?? false,
    dbWrites: partial.dbWrites ?? false,
    browserExecution: partial.browserExecution ?? false,
    plannedPhases: partial.plannedPhases ?? plannedPhasesForMode(partial.mode),
    callbackSelfTest: partial.callbackSelfTest ?? false,
    browserFacilitatorJoined: partial.browserFacilitatorJoined ?? false,
    browserParticipantJoined: partial.browserParticipantJoined ?? false,
    sameConferenceConfirmed: partial.sameConferenceConfirmed ?? false,
    recordingStarted: partial.recordingStarted ?? false,
    transportAccepted: partial.transportAccepted ?? false,
    commandAccepted: partial.commandAccepted ?? false,
    providerTerminal: partial.providerTerminal ?? false,
    stopIdempotent: partial.stopIdempotent ?? false,
    browserRelayUsed: partial.browserRelayUsed ?? false,
    artifactAvailable: partial.artifactAvailable ?? false,
    artifactReferenceFingerprint: partial.artifactReferenceFingerprint ?? null,
    artifactDuration: partial.artifactDuration ?? null,
    artifactSize: partial.artifactSize ?? null,
    logFetchStatus: partial.logFetchStatus ?? "SKIPPED",
    cleanupStatus: partial.cleanupStatus ?? "NOT_RUN",
    result: partial.result ?? "FAIL",
    failureStage: partial.failureStage ?? null,
    failureCode: partial.failureCode ?? null,
    healthUrlPath: partial.healthUrlPath ?? null,
    healthHttpStatus: partial.healthHttpStatus ?? null,
    healthService: partial.healthService ?? null,
    healthProtocolVersion: partial.healthProtocolVersion ?? null,
    healthCallbackEnabled: partial.healthCallbackEnabled ?? null,
    healthWorktreeFingerprint: partial.healthWorktreeFingerprint ?? null,
    expectedWorktreeFingerprint: partial.expectedWorktreeFingerprint ?? null,
    healthBuildId: partial.healthBuildId ?? null,
    expectedBuildId: partial.expectedBuildId ?? null,
    healthFailureReason: partial.healthFailureReason ?? null,
    browserPrewarmStartedAt: partial.browserPrewarmStartedAt ?? null,
    browserPrewarmCompletedAt: partial.browserPrewarmCompletedAt ?? null,
    startConferenceStartedAt: partial.startConferenceStartedAt ?? null,
    startConferenceCompletedAt: partial.startConferenceCompletedAt ?? null,
    activeRunPublishedAt: partial.activeRunPublishedAt ?? null,
    facilitatorAccessRequestedAt: partial.facilitatorAccessRequestedAt ?? null,
    participantAccessRequestedAt: partial.participantAccessRequestedAt ?? null,
    facilitatorCallConnectedAt: partial.facilitatorCallConnectedAt ?? null,
    participantCallConnectedAt: partial.participantCallConnectedAt ?? null,
    startConferenceToFirstAccessMs:
      partial.startConferenceToFirstAccessMs ?? null,
    startConferenceToFirstJoinMs: partial.startConferenceToFirstJoinMs ?? null,
    startConferenceToBothJoinedMs:
      partial.startConferenceToBothJoinedMs ?? null,
    facilitatorBrowserStage: partial.facilitatorBrowserStage ?? null,
    participantBrowserStage: partial.participantBrowserStage ?? null,
    facilitatorFirstFailedStage: partial.facilitatorFirstFailedStage ?? null,
    participantFirstFailedStage: partial.participantFirstFailedStage ?? null,
    facilitatorSelectedConferenceName:
      partial.facilitatorSelectedConferenceName ?? null,
    participantSelectedConferenceName:
      partial.participantSelectedConferenceName ?? null,
    facilitatorSelectionSource: partial.facilitatorSelectionSource ?? null,
    participantSelectionSource: partial.participantSelectionSource ?? null,
    remainingEvidencePaths: partial.remainingEvidencePaths ?? [],
    startConferenceCallCount: partial.startConferenceCallCount ?? 0,
    cleanupManifest: partial.cleanupManifest ?? null,
  };
}

function finalizeResult(
  draft: Omit<PocOrchestratorReport, "result">,
): PocOrchestratorResult {
  if (draft.dryRun || draft.executionKind === "DRY_RUN") {
    return "DRY_RUN_PASS";
  }
  if (draft.failureCode === "TIMEOUT" || draft.failureStage === "timeout") {
    return "INCONCLUSIVE";
  }
  if (draft.mode === "transport") {
    return evaluateTransportPass(draft) ? "PASS" : "FAIL";
  }
  return evaluateFullPass(draft) ? "PASS" : "FAIL";
}

export function buildDryRunPlan(options: PocOrchestratorOptions): Record<string, unknown> {
  const diag = getPocWorktreeDiagnostic();
  const db = trySanitizeLocalDatabaseTarget(process.env.DATABASE_URL);
  const plannedPhases = plannedPhasesForMode(options.mode);

  return {
    mode: options.mode,
    dryRun: true,
    executionKind: "DRY_RUN",
    confirmLivePoc: options.confirmLivePoc,
    confirmLocalDbWrite: options.confirmLocalDbWrite,
    providerCalls: false,
    dbWrites: false,
    browserExecution: false,
    browser: false,
    worktree: diag.classificationHint,
    branch: diag.branchOrBuildId,
    localDatabaseTargetSanitized: db.sanitizedUrl,
    localDatabaseSafe: db.safe,
    localDatabaseError: db.error,
    wouldRequireLiveConfirm: !options.confirmLivePoc,
    wouldRequireDbConfirm:
      options.mode === "full" && !options.confirmLocalDbWrite,
    plannedPhases,
    phases: plannedPhases,
  };
}

export async function runPocOrchestrator(
  options: PocOrchestratorOptions,
  deps: OrchestratorDeps = {},
): Promise<PocOrchestratorReport> {
  const nowMs = deps.nowMs ?? Date.now;
  const sleep = deps.sleep ?? sleepMs;
  const startedAtMs = nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = `run-${startedAtMs}-${randomBytes(3).toString("hex")}`;
  const timeouts = mergeTimeouts(options);
  const diag = getPocWorktreeDiagnostic();
  const paths = ensurePocRunDir(runId, options.stateRoot);

  let startConferenceCallCount = 0;
  let failureStage: PocFailureStage = null;
  let failureCode: string | null = null;
  let sessionFixture: CreateVoxServerStopPocSessionResult | null = null;
  let cleanupManifest: PocCleanupManifest | null = null;
  let browser: BrowserJoinResult | null = null;
  let prewarmHandle: BrowserPrewarmHandle | null = null;
  let state: VoximplantServerStopPocState | null = null;
  const preflightDb = trySanitizeLocalDatabaseTarget(process.env.DATABASE_URL);
  const plannedPhases = plannedPhasesForMode(options.mode);

  const reportDraft: Omit<PocOrchestratorReport, "result"> = {
    runId,
    mode: options.mode,
    dryRun: options.dryRun,
    executionKind: options.dryRun ? "DRY_RUN" : "LIVE",
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    worktree: diag.classificationHint,
    branch: diag.branchOrBuildId,
    localDatabaseTargetSanitized: preflightDb.sanitizedUrl,
    sessionId: null,
    conferenceName: null,
    callSessionHistoryId: null,
    controlUrlFingerprint: null,
    registeredProviderSessionId: null,
    browserProviderSessionId: null,
    recordingProviderSessionId: null,
    stopProviderSessionId: null,
    historyProviderSessionId: null,
    providerScenarioBuild: null,
    providerRuleIdentity: null,
    singleProviderSessionConfirmed: false,
    providerCalls: false,
    dbWrites: false,
    browserExecution: false,
    plannedPhases,
    callbackSelfTest: false,
    browserFacilitatorJoined: false,
    browserParticipantJoined: false,
    sameConferenceConfirmed: false,
    recordingStarted: false,
    transportAccepted: false,
    commandAccepted: false,
    providerTerminal: false,
    stopIdempotent: false,
    browserRelayUsed: false,
    artifactAvailable: false,
    artifactReferenceFingerprint: null,
    artifactDuration: null,
    artifactSize: null,
    logFetchStatus: options.skipLogFetch ? "SKIPPED" : "PENDING",
    cleanupStatus: "NOT_RUN",
    failureStage: null,
    failureCode: null,
    healthUrlPath: null,
    healthHttpStatus: null,
    healthService: null,
    healthProtocolVersion: null,
    healthCallbackEnabled: null,
    healthWorktreeFingerprint: null,
    expectedWorktreeFingerprint: null,
    healthBuildId: null,
    expectedBuildId: null,
    healthFailureReason: null,
    browserPrewarmStartedAt: null,
    browserPrewarmCompletedAt: null,
    startConferenceStartedAt: null,
    startConferenceCompletedAt: null,
    activeRunPublishedAt: null,
    facilitatorAccessRequestedAt: null,
    participantAccessRequestedAt: null,
    facilitatorCallConnectedAt: null,
    participantCallConnectedAt: null,
    startConferenceToFirstAccessMs: null,
    startConferenceToFirstJoinMs: null,
    startConferenceToBothJoinedMs: null,
    facilitatorBrowserStage: null,
    participantBrowserStage: null,
    facilitatorFirstFailedStage: null,
    participantFirstFailedStage: null,
    facilitatorSelectedConferenceName: null,
    participantSelectedConferenceName: null,
    facilitatorSelectionSource: null,
    participantSelectionSource: null,
    remainingEvidencePaths: [paths.runDir],
    startConferenceCallCount: 0,
    cleanupManifest: null,
  };

  const finish = (extra: Partial<PocOrchestratorReport> = {}): PocOrchestratorReport => {
    const finishedAtMs = nowMs();
    const merged = {
      ...reportDraft,
      ...extra,
      dryRun: extra.dryRun ?? reportDraft.dryRun,
      executionKind: extra.executionKind ?? reportDraft.executionKind,
      localDatabaseTargetSanitized:
        extra.localDatabaseTargetSanitized ??
        reportDraft.localDatabaseTargetSanitized,
      plannedPhases: extra.plannedPhases ?? reportDraft.plannedPhases,
      providerCalls: extra.providerCalls ?? reportDraft.providerCalls,
      dbWrites: extra.dbWrites ?? reportDraft.dbWrites,
      browserExecution: extra.browserExecution ?? reportDraft.browserExecution,
      startConferenceCallCount,
      failureStage: extra.failureStage ?? failureStage,
      failureCode: extra.failureCode ?? failureCode,
      cleanupManifest: extra.cleanupManifest ?? cleanupManifest,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      remainingEvidencePaths: [
        paths.runDir,
        paths.statePath,
        paths.reportPath,
        paths.eventsPath,
        paths.logPath,
      ].filter((p) => existsSync(p) || p === paths.runDir),
    };
    const result = extra.result ?? finalizeResult(merged);
    const report = emptyReport({ ...merged, result });
    writeJsonArtifact(paths.reportPath, report);

    // Terminal live results must never leave the run published as ACTIVE.
    if (
      !report.dryRun &&
      (result === "PASS" || result === "FAIL" || result === "INCONCLUSIVE")
    ) {
      const latest = readPocState(options.stateRoot);
      if (latest && latest.pocId === runId) {
        finalizePocRunTerminal({
          state: latest,
          result,
          stateRoot: options.stateRoot,
        });
      } else {
        clearCurrentPointer(options.stateRoot);
      }
    }
    return report;
  };

  if (options.dryRun) {
    const plan = buildDryRunPlan(options);
    return finish({
      result: "DRY_RUN_PASS",
      dryRun: true,
      executionKind: "DRY_RUN",
      localDatabaseTargetSanitized:
        (plan.localDatabaseTargetSanitized as string | null) ??
        preflightDb.sanitizedUrl,
      providerCalls: false,
      dbWrites: false,
      browserExecution: false,
      plannedPhases: (plan.plannedPhases as string[]) ?? plannedPhases,
      cleanupStatus: "NOT_RUN",
      logFetchStatus: "SKIPPED",
      failureStage: null,
      failureCode: null,
    });
  }

  // Live confirmation gates.
  if (!options.confirmLivePoc) {
    failureStage = "env_validation";
    failureCode = "LIVE_POC_CONFIRMATION_REQUIRED";
    return finish({ result: "FAIL" });
  }

  if (options.mode === "full" && !options.confirmLocalDbWrite) {
    failureStage = "local_db_safety";
    failureCode = "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED";
    return finish({ result: "FAIL" });
  }

  try {
    // Persist sanitized preflight target for transport + full (+ failure paths).
    reportDraft.localDatabaseTargetSanitized = preflightDb.sanitizedUrl;

    if (options.mode === "full") {
      try {
        const target = assertSafeLocalDatabaseTarget(process.env.DATABASE_URL);
        reportDraft.localDatabaseTargetSanitized = target.sanitizedUrl;
      } catch (error) {
        failureStage = "local_db_safety";
        failureCode =
          error instanceof LocalDbSafetyError
            ? error.code
            : "UNSAFE_DATABASE_TARGET";
        return finish({ result: "FAIL" });
      }

      const createSession = deps.createSession ?? createVoxServerStopPocSession;
      sessionFixture = await createSession({
        runId,
        confirmLocalDbWrite: options.confirmLocalDbWrite,
        appBaseUrl: options.appBaseUrl,
      });
      cleanupManifest = sessionFixture.cleanupManifest;
      writeJsonArtifact(paths.cleanupManifestPath, cleanupManifest);
      writePrewarmFixture(
        {
          runId,
          sessionId: sessionFixture.sessionId,
          facilitatorUserId: sessionFixture.facilitatorUserId,
          facilitatorEmail: sessionFixture.facilitatorEmail,
          facilitatorPassword: sessionFixture.facilitatorPassword,
          facilitatorAuthCookie: sessionFixture.facilitatorAuthCookie,
          participantUserId: sessionFixture.participantUserId,
          participantEmail: sessionFixture.participantEmail,
          participantPassword: sessionFixture.participantPassword,
          participantAuthCookie: sessionFixture.participantAuthCookie,
          facilitatorJoinToken: sessionFixture.facilitatorJoinToken,
          participantJoinToken: sessionFixture.participantJoinToken,
          facilitatorRoomUrl: sessionFixture.facilitatorRoomUrl,
          participantRoomUrl: sessionFixture.participantRoomUrl,
          participantAccountRoomUrl: sessionFixture.participantAccountRoomUrl,
          createdAt: new Date().toISOString(),
        },
        options.stateRoot,
      );
      reportDraft.sessionId = sessionFixture.sessionId;
      reportDraft.localDatabaseTargetSanitized =
        sessionFixture.localDatabaseTargetSanitized;
      reportDraft.dbWrites = true;
      reportDraft.cleanupManifest = cleanupManifest;
    }

    const conferenceName = `${POC_CONFERENCE_NAME_PREFIX}${runId}`;
    reportDraft.conferenceName = conferenceName;

    state = createEmptyPocState({
      pocId: runId,
      conferenceName,
      linkedSessionId: sessionFixture?.sessionId ?? null,
      runtimeStatus:
        options.mode === "full" ? "WAITING_FOR_PROVIDER_SESSION" : "UNKNOWN",
    });
    if (options.mode === "full") {
      state = seedWaitingForProviderSession(state);
    }
    writePocState(state, options.stateRoot);
    activatePocRun({
      runId,
      linkedSessionId: sessionFixture?.sessionId ?? null,
      stateRoot: options.stateRoot,
    });
    const activeRunPublishedAt = new Date(nowMs()).toISOString();
    reportDraft.activeRunPublishedAt = activeRunPublishedAt;

    const callbackUrl = `${options.appBaseUrl.replace(/\/$/, "")}/api/poc/voximplant/server-stop/callback`;
    const selfTestFn = deps.callbackSelfTest ?? runCallbackSelfTest;
    const selfTest = await selfTestFn({
      callbackUrl,
      healthUrl: options.healthUrl,
      stateRoot: options.stateRoot,
      timeoutMs: timeouts.callbackSelfTestMs,
      fetchImpl: deps.fetchImpl,
    });
    reportDraft.callbackSelfTest = selfTest.passed;
    applyHealthDiagnosticsToReport(
      reportDraft,
      selfTest.healthDiagnostics,
      selfTest.details,
    );
    if (!selfTest.passed) {
      failureStage = "callback_self_test";
      failureCode = selfTest.code;
      return finish({ result: "FAIL" });
    }

    const resolveConfig = deps.resolveConfig ?? resolvePocManagementConfig;
    const config = resolveConfig();
    console.log(
      "[poc:vox:run] management config",
      sanitizePocManagementConfig(config),
    );

    // Transport mode: isolated StartConference + ping (not used in full mode).
    if (options.mode === "transport") {
      const startConferenceStartedAt = new Date(nowMs()).toISOString();
      reportDraft.startConferenceStartedAt = startConferenceStartedAt;
      const start = deps.startConference ?? startConference;
      const startResult = await start({
        config,
        conferenceName,
        scriptCustomData: JSON.stringify({
          pocId: runId,
          conferenceName,
          purpose: "voximplant-server-stop-poc",
          linkedSessionId: sessionFixture?.sessionId ?? null,
        }),
        confirmLivePoc: options.confirmLivePoc,
        fetchImpl: deps.fetchImpl,
      });
      startConferenceCallCount += 1;
      reportDraft.startConferenceCallCount = startConferenceCallCount;
      reportDraft.providerCalls = true;
      const startConferenceCompletedAt = new Date(nowMs()).toISOString();
      reportDraft.startConferenceCompletedAt = startConferenceCompletedAt;

      if (!startResult.parsed || !startResult.publicResult) {
        failureStage = "start_conference";
        failureCode = "START_CONFERENCE_FAILED";
        return finish({ result: "FAIL" });
      }

      state = applyStartConferenceToState(state, {
        callSessionHistoryId: startResult.parsed.callSessionHistoryId,
        mediaSessionAccessUrl: startResult.parsed.mediaSessionAccessUrl,
        mediaSessionAccessSecureUrl:
          startResult.parsed.mediaSessionAccessSecureUrl,
        ruleId: startResult.request.rule_id,
        applicationId:
          startResult.request.application_id ?? config.applicationId,
        startedAt: startConferenceCompletedAt,
        stateRoot: options.stateRoot,
      });
      state = {
        ...state,
        linkedSessionId: sessionFixture?.sessionId ?? state.linkedSessionId,
        callbackEvents: [],
        seenCallbackNonces: [],
      };
      writePocState(state, options.stateRoot);
      activatePocRun({
        runId,
        linkedSessionId: state.linkedSessionId,
        stateRoot: options.stateRoot,
      });

      reportDraft.callSessionHistoryId = state.callSessionHistoryId;
      reportDraft.controlUrlFingerprint = state.controlUrlFingerprint;
      reportDraft.registeredProviderSessionId = state.providerSessionId;
      reportDraft.singleProviderSessionConfirmed =
        state.singleProviderSessionConfirmed;

      const ping = deps.executePing ?? executePocPing;
      const controlUrl = getActiveControlUrl(state, options.stateRoot);
      if (!controlUrl) {
        failureStage = "server_stop";
        failureCode = "CONTROL_URL_MISSING";
        return finish({ result: "FAIL" });
      }
      const pingOperationId = `poc-ping-${runId}`;
      const pingResult = await ping({
        operationId: pingOperationId,
        controlUrl,
        conferenceName,
        secret: getPocControlSecret(),
        callbackWaitMs: timeouts.commandCallbackMs,
        fetchImpl: deps.fetchImpl,
        cwd: options.stateRoot,
      });
      reportDraft.transportAccepted =
        pingResult.transport.transportOutcome === "TRANSPORT_ACCEPTED";
      reportDraft.commandAccepted =
        pingResult.pingOutcome === "PING_COMMAND_CONFIRMED";
      if (!reportDraft.commandAccepted) {
        failureStage = "server_stop";
        failureCode = pingResult.pingOutcome ?? "PING_CALLBACK_TIMEOUT";
        return finish({ result: "FAIL" });
      }
      return finish({ result: "PASS", cleanupStatus: "N/A_TRANSPORT" });
    }

    // Full mode: browser-first — no StartConference.
    // Prewarm → release joins → wait session_registered → confirm identity.
    const prewarmFn = deps.browserPrewarm ?? playwrightBrowserPrewarm;
    reportDraft.browserExecution = true;
    reportDraft.startConferenceCallCount = 0;
    prewarmHandle = await prewarmFn({
      appBaseUrl: options.appBaseUrl,
      sessionId: sessionFixture!.sessionId,
      facilitatorRoomUrl: sessionFixture!.facilitatorRoomUrl,
      participantRoomUrl: sessionFixture!.participantRoomUrl,
      facilitatorAuthCookie: sessionFixture!.facilitatorAuthCookie,
      facilitatorUserId: sessionFixture!.facilitatorUserId,
      facilitatorEmail: sessionFixture!.facilitatorEmail,
      facilitatorPassword: sessionFixture!.facilitatorPassword,
      facilitatorAuthStrategy: "CANONICAL_COOKIE",
      participantAuthCookie: sessionFixture!.participantAuthCookie,
      participantUserId: sessionFixture!.participantUserId,
      participantEmail: sessionFixture!.participantEmail,
      timeoutMs: timeouts.browserPrewarmMs,
      keepBrowser: options.keepBrowser,
      runId,
      stateRoot: options.stateRoot,
      nowMs,
    });
    reportDraft.browserPrewarmStartedAt =
      prewarmHandle.browserPrewarmStartedAt;
    reportDraft.browserPrewarmCompletedAt =
      prewarmHandle.browserPrewarmCompletedAt;
    reportDraft.facilitatorBrowserStage =
      prewarmHandle.facilitator.reachedStage;
    reportDraft.participantBrowserStage =
      prewarmHandle.participant.reachedStage;
    reportDraft.facilitatorFirstFailedStage =
      prewarmHandle.facilitator.firstFailedStage;
    reportDraft.participantFirstFailedStage =
      prewarmHandle.participant.firstFailedStage;

    if (!prewarmHandle.ok) {
      failureStage = "browser_prewarm";
      failureCode = prewarmHandle.failureCode ?? "BROWSER_PREWARM_FAILED";
      await prewarmHandle.close();
      return finish({ result: "FAIL" });
    }

    const browserJoinReleaseAt = new Date(nowMs()).toISOString();
    // Full mode LIVE join: release prewarmed browsers concurrently.
    // WebSDK createConference creates the canonical provider session.
    if (prewarmHandle) {
      browser = await prewarmHandle.liveJoin({
        expectedConferenceName: conferenceName,
        expiresAt: null,
        startConferenceStartedAt: browserJoinReleaseAt,
        startConferenceCompletedAt: browserJoinReleaseAt,
        activeRunPublishedAt,
        timeoutMs: timeouts.browserJoinMs,
      });
    } else if (deps.browserJoin) {
      browser = await deps.browserJoin({
        appBaseUrl: options.appBaseUrl,
        sessionId: sessionFixture!.sessionId,
        expectedConferenceName: conferenceName,
        facilitatorRoomUrl: sessionFixture!.facilitatorRoomUrl,
        participantRoomUrl: sessionFixture!.participantRoomUrl,
        facilitatorAuthCookie: sessionFixture!.facilitatorAuthCookie,
        timeoutMs: timeouts.browserJoinMs,
        keepBrowser: options.keepBrowser,
        runId,
        stateRoot: options.stateRoot,
        expiresAt: null,
        nowMs,
      });
      reportDraft.browserExecution = true;
    } else {
      failureStage = "browser_join_release";
      failureCode = "BROWSER_JOIN_FAILED";
      return finish({ result: "FAIL" });
    }

    reportDraft.browserFacilitatorJoined = browser.facilitatorJoined;
    reportDraft.browserParticipantJoined = browser.participantJoined;
    reportDraft.browserRelayUsed = browser.browserRelayUsed;
    reportDraft.browserPrewarmStartedAt =
      browser.timing.browserPrewarmStartedAt ??
      reportDraft.browserPrewarmStartedAt;
    reportDraft.browserPrewarmCompletedAt =
      browser.timing.browserPrewarmCompletedAt ??
      reportDraft.browserPrewarmCompletedAt;
    reportDraft.facilitatorAccessRequestedAt =
      browser.timing.facilitatorAccessRequestedAt;
    reportDraft.participantAccessRequestedAt =
      browser.timing.participantAccessRequestedAt;
    reportDraft.facilitatorCallConnectedAt =
      browser.timing.facilitatorCallConnectedAt;
    reportDraft.participantCallConnectedAt =
      browser.timing.participantCallConnectedAt;
    reportDraft.startConferenceToFirstAccessMs =
      browser.timing.startConferenceToFirstAccessMs;
    reportDraft.startConferenceToFirstJoinMs =
      browser.timing.startConferenceToFirstJoinMs;
    reportDraft.startConferenceToBothJoinedMs =
      browser.timing.startConferenceToBothJoinedMs;
    reportDraft.facilitatorBrowserStage = browser.facilitator.reachedStage;
    reportDraft.participantBrowserStage = browser.participant.reachedStage;
    reportDraft.facilitatorFirstFailedStage =
      browser.facilitator.firstFailedStage;
    reportDraft.participantFirstFailedStage =
      browser.participant.firstFailedStage;
    reportDraft.facilitatorSelectedConferenceName =
      browser.facilitator.access?.selectedConferenceName ??
      browser.facilitatorConferenceName;
    reportDraft.participantSelectedConferenceName =
      browser.participant.access?.selectedConferenceName ??
      browser.participantConferenceName;
    reportDraft.facilitatorSelectionSource =
      browser.facilitator.access?.selectionSource ?? null;
    reportDraft.participantSelectionSource =
      browser.participant.access?.selectionSource ?? null;

    if (!browser.facilitatorJoined || !browser.participantJoined) {
      failureStage = "browser_join_release";
      failureCode = browser.failureCode ?? "BROWSER_JOIN_FAILED";
      if (
        failureCode === "MEDIA_SESSION_EXPIRED_BEFORE_ACCESS" ||
        failureCode === "MEDIA_SESSION_EXPIRED_DURING_JOIN"
      ) {
        const latest = readPocState(options.stateRoot);
        if (latest) {
          writePocState(
            { ...latest, runtimeStatus: "EXPIRED" },
            options.stateRoot,
          );
        }
      }
      await browser.close();
      return finish({ result: "FAIL" });
    }

    // Provider session registration from dedicated POC scenario callback.
    state =
      (await waitForProviderSessionRegistration({
        stateRoot: options.stateRoot,
        timeoutMs: timeouts.providerSessionRegistrationMs,
        sleep,
        nowMs,
      })) ?? readPocState(options.stateRoot);

    if (!state || !isProviderSessionRegistered(state)) {
      failureStage = "provider_session_registration";
      failureCode =
        state?.runtimeStatus === "FAILED"
          ? "POC_MULTIPLE_PROVIDER_SESSIONS_DETECTED"
          : "POC_PROVIDER_SESSION_REGISTRATION_TIMEOUT";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    reportDraft.providerCalls = true;
    reportDraft.callSessionHistoryId = state.callSessionHistoryId;
    reportDraft.controlUrlFingerprint = state.controlUrlFingerprint;
    reportDraft.registeredProviderSessionId = state.providerSessionId;
    reportDraft.browserProviderSessionId = state.providerSessionId;
    reportDraft.providerScenarioBuild = state.providerScenarioBuild;
    reportDraft.providerRuleIdentity = state.providerRuleIdentity;
    reportDraft.singleProviderSessionConfirmed =
      state.singleProviderSessionConfirmed;

    if (state.providerScenarioBuild !== POC_EXPECTED_SCENARIO_BUILD) {
      failureStage = "provider_session_registration";
      failureCode = "POC_UNEXPECTED_SCENARIO_BUILD";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    // Join confirmation requires browser joins + registered provider session.
    const accessConferenceOk =
      browser.facilitatorConferenceName === conferenceName &&
      browser.participantConferenceName === conferenceName;
    const sameConferenceConfirmed =
      accessConferenceOk &&
      state.singleProviderSessionConfirmed &&
      state.providerConferenceName === conferenceName &&
      state.providerSessionId != null;
    reportDraft.sameConferenceConfirmed = sameConferenceConfirmed;

    if (!sameConferenceConfirmed) {
      failureStage = "browser_join_confirmation";
      failureCode = accessConferenceOk
        ? "POC_PROVIDER_SESSION_ID_MISMATCH"
        : browser.failureCode ?? "BROWSER_JOIN_FAILED";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    // Recording start: authorized recording-control + browser relay + provider evidence.
    // HTTP/relay alone never sets recordingStarted — provider recording_started is required.
    let recordingEvidence: RecordingStartEvidence = emptyRecordingStartEvidence(
      conferenceName,
    );
    const httpStart = await requestRecordingStartViaHttp({
      appBaseUrl: options.appBaseUrl,
      sessionId: sessionFixture!.sessionId,
      facilitatorAuthCookie: sessionFixture!.facilitatorAuthCookie,
      facilitatorJoinToken: sessionFixture!.facilitatorJoinToken,
      conferenceName,
      fetchImpl: deps.fetchImpl,
    });
    recordingEvidence = { ...httpStart.evidence, conferenceName };
    if (!httpStart.ok) {
      failureStage = "recording_start";
      failureCode = httpStart.failureCode ?? "RECORDING_START_FAILED";
      recordingEvidence.recordingStartFailureReason = failureCode;
      writeRecordingStartArtifact(runId, recordingEvidence, options.stateRoot);
      await browser.close();
      return finish({ result: "FAIL" });
    }

    recordingEvidence.recordingRelayClaimedAt = new Date(nowMs()).toISOString();

    let browserCommandSent = false;
    if (browser.startRecordingViaUi) {
      const ui = await browser.startRecordingViaUi(timeouts.recordingStartMs);
      browserCommandSent = ui.started || Boolean(httpStart.scenarioMessage);
    } else if (browser.relayScenarioMessage && httpStart.scenarioMessage) {
      browserCommandSent = await browser.relayScenarioMessage(
        httpStart.scenarioMessage,
      );
    } else if (httpStart.scenarioMessage) {
      // Test/mocks without a live page: command payload is valid; send is simulated.
      browserCommandSent = true;
    }

    if (!browserCommandSent) {
      failureStage = "recording_start";
      failureCode = "RECORDING_START_BROWSER_COMMAND_NOT_SENT";
      recordingEvidence.recordingStartFailureReason = failureCode;
      writeRecordingStartArtifact(runId, recordingEvidence, options.stateRoot);
      await browser.close();
      return finish({ result: "FAIL" });
    }
    recordingEvidence.recordingBrowserCommandSentAt = new Date(
      nowMs(),
    ).toISOString();

    const startOperationId = httpStart.scenarioMessage?.requestId ?? null;
    if (!startOperationId) {
      failureStage = "recording_start";
      failureCode = "RECORDING_START_RELAY_NOT_CREATED";
      recordingEvidence.recordingStartFailureReason = failureCode;
      writeRecordingStartArtifact(runId, recordingEvidence, options.stateRoot);
      await browser.close();
      return finish({ result: "FAIL" });
    }

    const providerStarted = await waitForCallback({
      stateRoot: options.stateRoot,
      operationId: startOperationId,
      eventType: "recording_started",
      action: "start",
      timeoutMs: timeouts.recordingStartMs,
      sleep,
      nowMs,
    });
    if (!providerStarted) {
      failureStage = "recording_start";
      failureCode = "RECORDING_START_PROVIDER_EVENT_TIMEOUT";
      recordingEvidence.recordingStartFailureReason = failureCode;
      writeRecordingStartArtifact(runId, recordingEvidence, options.stateRoot);
      await browser.close();
      return finish({ result: "FAIL" });
    }

    recordingEvidence.recordingProviderStartedAt = new Date(
      nowMs(),
    ).toISOString();
    recordingEvidence.recorderCreatedAt =
      recordingEvidence.recordingProviderStartedAt;
    recordingEvidence.recordingAppActiveAt =
      recordingEvidence.recordingProviderStartedAt;
    reportDraft.recordingStarted = true;

    const registeredAfterStart = readPocState(options.stateRoot);
    const recordingCallback = registeredAfterStart
      ? findMatchingCallbackEvent(registeredAfterStart, {
          operationId: startOperationId,
          eventType: "recording_started",
          action: "start",
        })
      : null;
    reportDraft.recordingProviderSessionId =
      recordingCallback?.callSessionHistoryId ??
      registeredAfterStart?.providerSessionId ??
      null;
    if (
      reportDraft.registeredProviderSessionId &&
      reportDraft.recordingProviderSessionId &&
      reportDraft.recordingProviderSessionId !==
        reportDraft.registeredProviderSessionId
    ) {
      failureStage = "recording_start";
      failureCode = "POC_PROVIDER_SESSION_ID_MISMATCH";
      recordingEvidence.recordingStartFailureReason = failureCode;
      writeRecordingStartArtifact(runId, recordingEvidence, options.stateRoot);
      await browser.close();
      return finish({ result: "FAIL" });
    }
    writeRecordingStartArtifact(runId, recordingEvidence, options.stateRoot);

    const stopState = readPocState(options.stateRoot)!;
    if (
      !stopState.providerSessionId ||
      stopState.providerSessionId !== reportDraft.registeredProviderSessionId
    ) {
      failureStage = "server_stop";
      failureCode = "POC_PROVIDER_SESSION_ID_MISMATCH";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    const controlUrl = getActiveControlUrl(stopState, options.stateRoot);
    if (!controlUrl) {
      failureStage = "server_stop";
      failureCode = "CONTROL_URL_MISSING";
      await browser.close();
      return finish({ result: "FAIL" });
    }
    reportDraft.stopProviderSessionId = stopState.providerSessionId;

    const operationId = buildDeterministicStopOperationId(conferenceName);
    const sendControl = deps.sendControl ?? sendPocControlCommand;
    const stopOnce = await sendControl({
      controlUrl,
      action: "stop_recording",
      conferenceName,
      operationId,
      secret: getPocControlSecret(),
      fetchImpl: deps.fetchImpl,
      timeoutMs: timeouts.commandCallbackMs,
    });

    reportDraft.transportAccepted =
      stopOnce.transportOutcome === "TRANSPORT_ACCEPTED";
    if (!reportDraft.transportAccepted) {
      failureStage = "server_stop";
      failureCode = stopOnce.transportOutcome ?? "TRANSPORT_REJECTED";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    let latest = readPocState(options.stateRoot)!;
    latest = recordStopTransportAccepted(latest, operationId);
    writePocState(latest, options.stateRoot);

    const commandAccepted = await waitForCallback({
      stateRoot: options.stateRoot,
      operationId,
      eventType: "command_accepted",
      action: "stop_recording",
      timeoutMs: timeouts.commandCallbackMs,
      sleep,
      nowMs,
    });
    reportDraft.commandAccepted = commandAccepted;
    if (!commandAccepted) {
      failureStage = "server_stop";
      failureCode = "COMMAND_CALLBACK_TIMEOUT";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    const terminal = await waitForCallback({
      stateRoot: options.stateRoot,
      operationId,
      eventType: "recording_stopped",
      timeoutMs: timeouts.terminalCallbackMs,
      sleep,
      nowMs,
    });
    reportDraft.providerTerminal = terminal;
    if (!terminal || !isPocStopSuccessful(readPocState(options.stateRoot)!)) {
      failureStage = "server_stop";
      failureCode = "PROVIDER_TERMINAL_TIMEOUT";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    // Idempotent second stop.
    const stopTwice = await sendControl({
      controlUrl,
      action: "stop_recording",
      conferenceName,
      operationId,
      secret: getPocControlSecret(),
      fetchImpl: deps.fetchImpl,
      timeoutMs: timeouts.commandCallbackMs,
    });
    const afterIdempotent = readPocState(options.stateRoot)!;
    const terminalEvents = afterIdempotent.callbackEvents.filter(
      (e) =>
        e.eventType === "recording_stopped" &&
        e.operationId === operationId &&
        e.signatureVerified,
    );
    reportDraft.stopIdempotent =
      stopTwice.transportOutcome === "TRANSPORT_ACCEPTED" &&
      terminalEvents.length === 1;
    reportDraft.browserRelayUsed =
      reportDraft.browserRelayUsed || browser.browserRelayUsed;

    if (reportDraft.browserRelayUsed) {
      failureStage = "server_stop";
      failureCode = "BROWSER_RELAY_USED";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    // Artifact evidence from callbacks / history.
    const stopped = afterIdempotent.lastStoppedEvent;
    if (stopped) {
      reportDraft.artifactAvailable = true;
      reportDraft.artifactReferenceFingerprint =
        stopped.recordingId ||
        stopped.correlation ||
        afterIdempotent.callSessionHistoryId;
    }

    if (!options.skipLogFetch && afterIdempotent.callSessionHistoryId) {
      const getHistory = deps.getCallHistory ?? getCallHistoryForPoc;
      const history = await getHistory({
        config,
        callSessionHistoryId: afterIdempotent.callSessionHistoryId,
        fromDateIso: new Date(startedAtMs - 60_000).toISOString(),
        toDateIso: new Date(nowMs() + 60_000).toISOString(),
        fetchImpl: deps.fetchImpl,
      });
      reportDraft.logFetchStatus = history.status;
      reportDraft.historyProviderSessionId = history.callSessionHistoryId;
      if (history.sanitizedLogText) {
        writeTextArtifact(paths.logPath, history.sanitizedLogText);
      }
      if (history.artifact.artifactAvailable) {
        reportDraft.artifactAvailable = true;
        reportDraft.artifactReferenceFingerprint =
          history.artifact.artifactReferenceFingerprint;
        reportDraft.artifactDuration = history.artifact.artifactDuration;
        reportDraft.artifactSize = history.artifact.artifactSize;
      }
      if (history.status === "LOG_FETCH_UNAVAILABLE") {
        console.log("[poc:vox:run] LOG_FETCH_UNAVAILABLE", {
          callSessionHistoryId: history.manualRetrievalId,
        });
      }
    } else {
      reportDraft.logFetchStatus = "SKIPPED";
      reportDraft.historyProviderSessionId =
        afterIdempotent.callSessionHistoryId;
    }

    const correlation = correlateProviderSessionIds({
      registeredProviderSessionId: reportDraft.registeredProviderSessionId,
      browserProviderSessionId: reportDraft.browserProviderSessionId,
      recordingProviderSessionId: reportDraft.recordingProviderSessionId,
      stopProviderSessionId: reportDraft.stopProviderSessionId,
      historyProviderSessionId: reportDraft.historyProviderSessionId,
    });
    if (!correlation.ok) {
      failureStage = "artifact";
      failureCode = correlation.code ?? "POC_PROVIDER_SESSION_ID_MISMATCH";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    if (!reportDraft.artifactAvailable) {
      failureStage = "artifact";
      failureCode = "ARTIFACT_EVIDENCE_MISSING";
      await browser.close();
      return finish({ result: "FAIL" });
    }

    await browser.close();

    // Cleanup on full PASS only (evaluated below) unless keep-session.
    const tentative = finalizeResult(reportDraft);
    if (tentative === "PASS" && !options.keepSession && cleanupManifest) {
      const cleanup = deps.cleanupSession ?? cleanupPocSessionEntities;
      await cleanup({
        manifest: cleanupManifest,
        confirmLocalDbWrite: options.confirmLocalDbWrite,
      });
      clearCurrentPointer(options.stateRoot);
      reportDraft.cleanupStatus = "DELETED_MANIFEST_ENTITIES";
    } else if (options.keepSession) {
      reportDraft.cleanupStatus = "KEPT_SESSION";
    } else {
      reportDraft.cleanupStatus = "RETAINED_ON_NON_PASS";
    }

    return finish({});
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await prewarmHandle?.close().catch(() => {});
    if (error instanceof PocSafetyError) {
      failureCode = error.code;
      failureStage = failureStage ?? "env_validation";
    } else if (error instanceof LocalDbSafetyError) {
      failureCode = error.code;
      failureStage = "local_db_safety";
    } else {
      failureCode = error instanceof Error ? error.message : String(error);
      failureStage =
        failureStage ??
        (reportDraft.browserPrewarmCompletedAt
          ? reportDraft.registeredProviderSessionId
            ? "browser_join_confirmation"
            : "provider_session_registration"
          : reportDraft.browserExecution
            ? "browser_prewarm"
            : "env_validation");
    }
    return finish({ result: "FAIL" });
  }
}

export function printHumanReport(
  report: PocOrchestratorReport,
  stateRoot?: string,
): void {
  if (isDryRunExecution(report)) {
    console.log(`[poc:vox:run] ${POC_DRY_RUN_BANNER}`);
  }
  const failureCodeDisplay =
    report.failureCode === "LOCAL_HEALTH_FAILED" && report.healthFailureReason
      ? `LOCAL_HEALTH_FAILED: ${report.healthFailureReason}`
      : report.failureCode;
  console.log("[poc:vox:run] report", {
    runId: report.runId,
    mode: report.mode,
    dryRun: report.dryRun,
    executionKind: report.executionKind,
    result: report.result,
    failureStage: report.failureStage,
    failureCode: failureCodeDisplay,
    healthFailureReason: report.healthFailureReason,
    healthUrlPath: report.healthUrlPath,
    healthHttpStatus: report.healthHttpStatus,
    healthService: report.healthService,
    healthProtocolVersion: report.healthProtocolVersion,
    healthCallbackEnabled: report.healthCallbackEnabled,
    healthWorktreeFingerprint: report.healthWorktreeFingerprint,
    expectedWorktreeFingerprint: report.expectedWorktreeFingerprint,
    healthBuildId: report.healthBuildId,
    expectedBuildId: report.expectedBuildId,
    localDatabaseTargetSanitized: report.localDatabaseTargetSanitized,
    providerCalls: report.providerCalls,
    dbWrites: report.dbWrites,
    browserExecution: report.browserExecution,
    plannedPhases: report.plannedPhases,
    sessionId: report.sessionId,
    conferenceName: report.conferenceName,
    callSessionHistoryId: report.callSessionHistoryId,
    controlUrlFingerprint: report.controlUrlFingerprint,
    callbackSelfTest: report.callbackSelfTest,
    browserFacilitatorJoined: report.browserFacilitatorJoined,
    browserParticipantJoined: report.browserParticipantJoined,
    sameConferenceConfirmed: report.sameConferenceConfirmed,
    recordingStarted: report.recordingStarted,
    transportAccepted: report.transportAccepted,
    commandAccepted: report.commandAccepted,
    providerTerminal: report.providerTerminal,
    stopIdempotent: report.stopIdempotent,
    browserRelayUsed: report.browserRelayUsed,
    artifactAvailable: report.artifactAvailable,
    logFetchStatus: report.logFetchStatus,
    cleanupStatus: report.cleanupStatus,
    durationMs: report.durationMs,
    remainingEvidencePaths: report.remainingEvidencePaths,
  });

  // Never print control URLs / secrets. Prefer this run's state when available.
  const state = readPocState(stateRoot);
  if (state && state.pocId === report.runId) {
    console.log("[poc:vox:run] public state", toPublicPocStateView(state));
  }
}
