import type { PocCleanupManifest } from "@/lib/voximplant/poc/create-poc-session";

export type PocOrchestratorMode = "transport" | "full";

export type PocOrchestratorExecutionKind = "DRY_RUN" | "LIVE";

export type PocOrchestratorResult =
  | "DRY_RUN_PASS"
  | "PASS"
  | "FAIL"
  | "INCONCLUSIVE";

export type PocFailureStage =
  | "env_validation"
  | "local_db_safety"
  | "session_create"
  | "callback_self_test"
  | "start_conference"
  | "run_binding"
  | "browser_join"
  | "recording_start"
  | "server_stop"
  | "artifact"
  | "log_fetch"
  | "cleanup"
  | "timeout"
  | null;

export type PocPhaseTimeouts = {
  callbackSelfTestMs: number;
  startConferenceMs: number;
  browserJoinMs: number;
  recordingStartMs: number;
  commandCallbackMs: number;
  terminalCallbackMs: number;
  artifactEvidenceMs: number;
  logRetrievalMs: number;
};

export const DEFAULT_POC_PHASE_TIMEOUTS: PocPhaseTimeouts = {
  callbackSelfTestMs: 15_000,
  startConferenceMs: 30_000,
  browserJoinMs: 90_000,
  recordingStartMs: 60_000,
  commandCallbackMs: 20_000,
  terminalCallbackMs: 45_000,
  artifactEvidenceMs: 30_000,
  logRetrievalMs: 30_000,
};

/** Banner printed by last-report / human report for planning-only runs. */
export const POC_DRY_RUN_BANNER =
  "DRY RUN — NO PROVIDER / DB / BROWSER EXECUTION.";

export type PocOrchestratorOptions = {
  mode: PocOrchestratorMode;
  dryRun: boolean;
  confirmLivePoc: boolean;
  confirmLocalDbWrite: boolean;
  keepSession: boolean;
  keepBrowser: boolean;
  skipLogFetch: boolean;
  timeoutSeconds: number | null;
  appBaseUrl: string;
  healthUrl: string;
  stateRoot?: string;
  timeouts?: Partial<PocPhaseTimeouts>;
};

export type PocOrchestratorReport = {
  runId: string;
  mode: PocOrchestratorMode;
  dryRun: boolean;
  executionKind: PocOrchestratorExecutionKind;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  worktree: string;
  branch: string;
  localDatabaseTargetSanitized: string | null;
  sessionId: string | null;
  conferenceName: string | null;
  callSessionHistoryId: string | null;
  controlUrlFingerprint: string | null;
  /** Whether any live provider HTTP call was made. */
  providerCalls: boolean;
  /** Whether any local DB write was performed. */
  dbWrites: boolean;
  /** Whether browser automation was executed. */
  browserExecution: boolean;
  /** Planned phase list (not completed evidence). */
  plannedPhases: string[];
  callbackSelfTest: boolean;
  browserFacilitatorJoined: boolean;
  browserParticipantJoined: boolean;
  sameConferenceConfirmed: boolean;
  recordingStarted: boolean;
  transportAccepted: boolean;
  commandAccepted: boolean;
  providerTerminal: boolean;
  stopIdempotent: boolean;
  browserRelayUsed: boolean;
  artifactAvailable: boolean;
  artifactReferenceFingerprint: string | null;
  artifactDuration: number | null;
  artifactSize: number | null;
  logFetchStatus: string;
  cleanupStatus: string;
  result: PocOrchestratorResult;
  failureStage: PocFailureStage;
  failureCode: string | null;
  /** Sanitized health URL path only (never host with credentials). */
  healthUrlPath: string | null;
  healthHttpStatus: number | null;
  healthService: string | null;
  healthProtocolVersion: number | null;
  healthCallbackEnabled: boolean | null;
  healthWorktreeFingerprint: string | null;
  expectedWorktreeFingerprint: string | null;
  healthBuildId: string | null;
  expectedBuildId: string | null;
  /** Nested typed reason when failureCode is LOCAL_HEALTH_FAILED. */
  healthFailureReason: string | null;
  remainingEvidencePaths: string[];
  startConferenceCallCount: number;
  cleanupManifest: PocCleanupManifest | null;
};

export function plannedPhasesForMode(mode: PocOrchestratorMode): string[] {
  return mode === "transport"
    ? [
        "env_validation",
        "seed_run_state",
        "callback_self_test",
        "start_conference",
        "ping",
        "report",
      ]
    : [
        "env_validation",
        "local_db_safety",
        "create_session",
        "seed_run_state",
        "callback_self_test",
        "start_conference",
        "browser_join",
        "recording_start",
        "server_stop",
        "artifact",
        "log_fetch",
        "cleanup",
        "report",
      ];
}

export function isDryRunExecution(report: {
  dryRun?: boolean;
  executionKind?: string;
}): boolean {
  return report.dryRun === true || report.executionKind === "DRY_RUN";
}

export function formatLastReportSummary(report: Record<string, unknown>): {
  banner: string | null;
  summary: Record<string, unknown>;
} {
  const dryRun = isDryRunExecution(report);
  const healthFailureReason =
    typeof report.healthFailureReason === "string"
      ? report.healthFailureReason
      : null;
  const failureCodeRaw =
    typeof report.failureCode === "string" ? report.failureCode : null;
  const failureCodeDisplay =
    failureCodeRaw === "LOCAL_HEALTH_FAILED" && healthFailureReason
      ? `LOCAL_HEALTH_FAILED: ${healthFailureReason}`
      : failureCodeRaw;

  return {
    banner: dryRun ? POC_DRY_RUN_BANNER : null,
    summary: {
      runId: report.runId,
      mode: report.mode,
      dryRun: report.dryRun ?? dryRun,
      executionKind: report.executionKind ?? (dryRun ? "DRY_RUN" : "LIVE"),
      result: report.result,
      failureStage: report.failureStage,
      failureCode: failureCodeDisplay,
      healthFailureReason,
      healthUrlPath: report.healthUrlPath ?? null,
      healthHttpStatus: report.healthHttpStatus ?? null,
      healthWorktreeFingerprint: report.healthWorktreeFingerprint ?? null,
      expectedWorktreeFingerprint: report.expectedWorktreeFingerprint ?? null,
      healthBuildId: report.healthBuildId ?? null,
      expectedBuildId: report.expectedBuildId ?? null,
      localDatabaseTargetSanitized: report.localDatabaseTargetSanitized ?? null,
      providerCalls: report.providerCalls ?? false,
      dbWrites: report.dbWrites ?? false,
      browserExecution: report.browserExecution ?? false,
      plannedPhases: report.plannedPhases ?? [],
      conferenceName: report.conferenceName,
      callSessionHistoryId: report.callSessionHistoryId,
      controlUrlFingerprint: report.controlUrlFingerprint,
      remainingEvidencePaths: report.remainingEvidencePaths,
    },
  };
}

export function evaluateFullPass(report: Omit<PocOrchestratorReport, "result">): boolean {
  return (
    report.callbackSelfTest &&
    report.browserFacilitatorJoined &&
    report.browserParticipantJoined &&
    report.sameConferenceConfirmed &&
    report.recordingStarted &&
    report.transportAccepted &&
    report.commandAccepted &&
    report.providerTerminal &&
    report.stopIdempotent &&
    !report.browserRelayUsed &&
    report.artifactAvailable
  );
}

export function evaluateTransportPass(
  report: Omit<PocOrchestratorReport, "result">,
): boolean {
  return (
    report.callbackSelfTest &&
    report.transportAccepted &&
    report.commandAccepted &&
    !report.browserRelayUsed &&
    report.startConferenceCallCount === 1
  );
}
