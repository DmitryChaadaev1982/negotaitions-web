import type { PocCleanupManifest } from "@/lib/voximplant/poc/create-poc-session";

export type PocOrchestratorMode = "transport" | "full";

export type PocOrchestratorResult = "PASS" | "FAIL" | "INCONCLUSIVE";

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
  remainingEvidencePaths: string[];
  startConferenceCallCount: number;
  cleanupManifest: PocCleanupManifest | null;
};

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
