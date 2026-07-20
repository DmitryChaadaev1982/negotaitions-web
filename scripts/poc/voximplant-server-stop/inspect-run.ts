/**
 * Sanitized POC run phase timeline inspector.
 *
 * Usage:
 *   npm run poc:vox:inspect-run -- --run-id run-…
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sanitizePocDiagnosticLog } from "@/lib/voximplant/poc/log-sanitize";
import { getPocRunPaths } from "@/lib/voximplant/poc/poc-run-store";
import { loadPocEnvFiles } from "./load-env";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function redactDeep(value: unknown): unknown {
  return sanitizePocDiagnosticLog(value);
}

function main(): void {
  loadPocEnvFiles();
  const runId = readArg("--run-id");
  if (!runId) {
    console.log("[poc:vox:inspect-run] missing --run-id");
    process.exitCode = 1;
    return;
  }

  const paths = getPocRunPaths(runId);
  const report = readJson(paths.reportPath);
  const state = readJson(paths.statePath);
  const events = readJson(paths.eventsPath);

  if (!report) {
    console.log("[poc:vox:inspect-run] report missing", { runId });
    process.exitCode = 1;
    return;
  }

  const browserRoot = join(paths.runDir, "browser");
  const facilitatorState = readJson(
    join(browserRoot, "facilitator", "browser-state.json"),
  );
  const participantState = readJson(
    join(browserRoot, "participant", "browser-state.json"),
  );
  const facilitatorAccess = readJson(
    join(browserRoot, "facilitator", "access-selection.json"),
  );
  const participantAccess = readJson(
    join(browserRoot, "participant", "access-selection.json"),
  );

  const artifactNames = existsSync(browserRoot)
    ? readdirSync(browserRoot, { withFileTypes: true }).map((e) => e.name)
    : [];

  const timeline = {
    environment: {
      worktree: report.worktree ?? null,
      branch: report.branch ?? null,
      healthUrlPath: report.healthUrlPath ?? null,
      healthHttpStatus: report.healthHttpStatus ?? null,
      healthFailureReason: report.healthFailureReason ?? null,
    },
    tempSession: {
      sessionId: report.sessionId ?? null,
      dbWrites: report.dbWrites ?? false,
      localDatabaseTargetSanitized:
        report.localDatabaseTargetSanitized ?? null,
      cleanupEntityCount: Array.isArray(
        (report.cleanupManifest as { entities?: unknown[] } | null)?.entities,
      )
        ? (report.cleanupManifest as { entities: unknown[] }).entities.length
        : 0,
    },
    callback: {
      callbackSelfTest: report.callbackSelfTest ?? false,
      callbackEventCount: Array.isArray(events?.callbackEvents)
        ? (events!.callbackEvents as unknown[]).length
        : Array.isArray(state?.callbackEvents)
          ? (state!.callbackEvents as unknown[]).length
          : 0,
    },
    startConference: {
      startConferenceCallCount: report.startConferenceCallCount ?? 0,
      providerCalls: report.providerCalls ?? false,
      conferenceName: report.conferenceName ?? state?.conferenceName ?? null,
      callSessionHistoryId:
        report.callSessionHistoryId ?? state?.callSessionHistoryId ?? null,
      controlUrlFingerprint:
        report.controlUrlFingerprint ?? state?.controlUrlFingerprint ?? null,
      startConferenceStartedAt: report.startConferenceStartedAt ?? null,
      startConferenceCompletedAt: report.startConferenceCompletedAt ?? null,
      activeRunPublishedAt: report.activeRunPublishedAt ?? null,
      expiresAt: state?.expiresAt ?? null,
      runtimeStatus: state?.runtimeStatus ?? null,
    },
    facilitatorBrowser: {
      reachedStage:
        report.facilitatorBrowserStage ??
        facilitatorState?.reachedStage ??
        null,
      firstFailedStage:
        report.facilitatorFirstFailedStage ??
        facilitatorState?.firstFailedStage ??
        null,
      failureCode: facilitatorState?.failureCode ?? null,
      authAccepted: facilitatorState?.authAccepted ?? null,
      roomPageLoaded: facilitatorState?.roomPageLoaded ?? null,
      accessRequested: facilitatorState?.accessRequested ?? null,
      joined: report.browserFacilitatorJoined ?? null,
      selectedConferenceName:
        report.facilitatorSelectedConferenceName ??
        facilitatorAccess?.selectedConferenceName ??
        null,
      selectionSource:
        report.facilitatorSelectionSource ??
        facilitatorAccess?.selectionSource ??
        null,
      accessHttpStatus: facilitatorAccess?.httpStatus ?? null,
      accessRequestedAt: report.facilitatorAccessRequestedAt ?? null,
      callConnectedAt: report.facilitatorCallConnectedAt ?? null,
    },
    participantBrowser: {
      reachedStage:
        report.participantBrowserStage ??
        participantState?.reachedStage ??
        null,
      firstFailedStage:
        report.participantFirstFailedStage ??
        participantState?.firstFailedStage ??
        null,
      failureCode: participantState?.failureCode ?? null,
      authAccepted: participantState?.authAccepted ?? null,
      roomPageLoaded: participantState?.roomPageLoaded ?? null,
      accessRequested: participantState?.accessRequested ?? null,
      joined: report.browserParticipantJoined ?? null,
      selectedConferenceName:
        report.participantSelectedConferenceName ??
        participantAccess?.selectedConferenceName ??
        null,
      selectionSource:
        report.participantSelectionSource ??
        participantAccess?.selectionSource ??
        null,
      accessHttpStatus: participantAccess?.httpStatus ?? null,
      accessRequestedAt: report.participantAccessRequestedAt ?? null,
      callConnectedAt: report.participantCallConnectedAt ?? null,
    },
    accessSelection: {
      sameConferenceConfirmed: report.sameConferenceConfirmed ?? false,
      expectedConferenceName: report.conferenceName ?? null,
    },
    webSdk: {
      browserExecution: report.browserExecution ?? false,
      browserPrewarmStartedAt: report.browserPrewarmStartedAt ?? null,
      browserPrewarmCompletedAt: report.browserPrewarmCompletedAt ?? null,
      browserReleaseToFirstAccessMs:
        report.browserReleaseToFirstAccessMs ?? null,
      browserReleaseToFirstJoinMs: report.browserReleaseToFirstJoinMs ?? null,
      browserReleaseToBothJoinedMs:
        report.browserReleaseToBothJoinedMs ?? null,
      // Deprecated compatibility mirrors.
      startConferenceToFirstAccessMs:
        report.startConferenceToFirstAccessMs ?? null,
      startConferenceToFirstJoinMs: report.startConferenceToFirstJoinMs ?? null,
      startConferenceToBothJoinedMs:
        report.startConferenceToBothJoinedMs ?? null,
      browserRelayUsed: report.browserRelayUsed ?? false,
    },
    recording: {
      recordingStarted: report.recordingStarted ?? false,
    },
    stop: {
      transportAccepted: report.transportAccepted ?? false,
      commandAccepted: report.commandAccepted ?? false,
      providerTerminal: report.providerTerminal ?? false,
      stopIdempotent: report.stopIdempotent ?? false,
    },
    artifact: {
      artifactAvailable: report.artifactAvailable ?? false,
      artifactReferenceFingerprint:
        report.artifactReferenceFingerprint ?? null,
      logFetchStatus: report.logFetchStatus ?? null,
      browserArtifactDirs: artifactNames,
    },
    result: {
      result: report.result ?? null,
      failureStage: report.failureStage ?? null,
      failureCode: report.failureCode ?? null,
      durationMs: report.durationMs ?? null,
      startedAt: report.startedAt ?? null,
      finishedAt: report.finishedAt ?? null,
    },
  };

  // Forensic inference when browser artifacts are absent (historical runs).
  const inferred = {
    note:
      !facilitatorState && !participantState
        ? "No per-context browser artifacts were retained for this run. Stages inferred from timing only."
        : null,
    idleWindowMs: 60_000,
    startToFinishMs: report.durationMs ?? null,
    likelyMediaSessionExpiry:
      typeof state?.expiresAt === "string" &&
      typeof report.finishedAt === "string" &&
      Date.parse(report.finishedAt as string) >
        Date.parse(state.expiresAt as string),
    inferredFacilitatorFirstFailedStage:
      report.facilitatorFirstFailedStage ??
      (report.failureStage === "browser_join"
        ? "ACCESS_REQUEST_SENT_OR_LATER (uninstrumented historical run)"
        : null),
    inferredParticipantFirstFailedStage:
      report.participantFirstFailedStage ??
      (report.failureStage === "browser_join"
        ? "ACCESS_REQUEST_SENT_OR_LATER (uninstrumented historical run)"
        : null),
  };

  console.log(
    "[poc:vox:inspect-run]",
    JSON.stringify(
      redactDeep({
        runId,
        timeline,
        inferred,
      }),
      null,
      2,
    ),
  );
}

main();
