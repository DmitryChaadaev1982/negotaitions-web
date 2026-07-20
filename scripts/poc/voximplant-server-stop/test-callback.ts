/**
 * Local POC callback self-test (no Voximplant).
 *
 * Usage:
 *   npm run poc:vox:test-callback -- --dry-run
 *   npm run poc:vox:test-callback
 *   npm run poc:vox:test-callback -- --event=session_registered
 *   npm run poc:vox:test-callback -- --event=session_registered --dry-run
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
  getPocCallbackSecret,
  isPocCallbackEnabled,
} from "@/lib/voximplant/poc/callback-signature";
import {
  classifyWorktreeMatch,
  fingerprintSecretPrefix,
  getPocRepositoryRoot,
  getPocStatePath,
  getPocWorktreeDiagnostic,
} from "@/lib/voximplant/poc/poc-paths";
import {
  findMatchingCallbackEvent,
} from "@/lib/voximplant/poc/poc-state";
import {
  POC_CONFERENCE_NAME_PREFIX,
  POC_EXPECTED_SCENARIO_BUILD,
  POC_SCENARIO_SOURCE_NAME,
} from "@/lib/voximplant/poc/poc-safety";
import {
  activatePocRun,
  getPocRunPaths,
  readCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import {
  createEmptyPocState,
  readPocRunState,
  seedWaitingForProviderSession,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import { loadPocEnvFiles } from "./load-env";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

function resolveCallbackUrl(): string {
  // Local self-test targets the process on :3000 by default.
  // Tunnel/APP_URL hosts are for Voximplant → app, not for this CLI loopback.
  const fromArg = readArg("--callback-url") ?? readArg("--url");
  if (fromArg) return fromArg;
  const fromEnv =
    process.env.VOXIMPLANT_SERVER_STOP_POC_CALLBACK_URL?.trim() ||
    process.env.POC_CALLBACK_URL?.trim();
  if (fromEnv) return fromEnv;
  return "http://localhost:3000/api/poc/voximplant/server-stop/callback";
}

function sanitizeUrlHostPath(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname };
  } catch {
    return { host: "invalid", path: "/api/poc/voximplant/server-stop/callback" };
  }
}

function readRunEventsPathInfo(path: string, operationId: string): {
  callbackEventCount: number;
  operationIdFound: boolean;
} {
  if (!existsSync(path)) return { callbackEventCount: 0, operationIdFound: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      callbackEvents?: Array<{ operationId?: string | null }>;
    };
    const events = Array.isArray(parsed.callbackEvents) ? parsed.callbackEvents : [];
    return {
      callbackEventCount: events.length,
      operationIdFound: events.some(
        (event) =>
          typeof event?.operationId === "string" && event.operationId === operationId,
      ),
    };
  } catch {
    return { callbackEventCount: 0, operationIdFound: false };
  }
}

async function main(): Promise<void> {
  loadPocEnvFiles();

  const dryRun = hasFlag("--dry-run");
  const callbackEnabled = isPocCallbackEnabled();
  let secretConfigured = false;
  let secretPrefix: string | null = null;
  let secret = "";
  try {
    secret = getPocCallbackSecret();
    secretConfigured = true;
    secretPrefix = fingerprintSecretPrefix(secret);
  } catch {
    secretConfigured = false;
  }

  const statePath = getPocStatePath();
  const repoRoot = getPocRepositoryRoot();
  const expectedDiag = getPocWorktreeDiagnostic();
  const callbackUrl = resolveCallbackUrl();
  const { host, path } = sanitizeUrlHostPath(callbackUrl);
  const eventArg = readArg("--event") ?? "command_accepted";
  const isSessionRegistered = eventArg === "session_registered";
  const runIdArg = readArg("--run-id");
  const previousPointer = readCurrentPointer(repoRoot);
  let resolvedRunId: string | null = null;
  let resolvedConferenceName: string | null = null;
  let resolvedStatePath: string | null = null;
  let resolvedEventsPath: string | null = null;
  const resolvedStateScope: "RUN_SCOPED" | "LEGACY_GLOBAL_STATE" = "RUN_SCOPED";
  let fixtureCreated = false;

  if (runIdArg) {
    const runPaths = getPocRunPaths(runIdArg, repoRoot);
    const runState = readPocRunState(runIdArg, repoRoot);
    if (!runState) {
      console.log("[poc:vox:test-callback] result", {
        CALLBACK_ROUTE_REACHED: false,
        CALLBACK_SIGNATURE_ACCEPTED: false,
        CALLBACK_EVENT_PERSISTED: false,
        errorCode: "POC_CALLBACK_RUN_NOT_FOUND",
        runId: runIdArg,
      });
      process.exitCode = 1;
      return;
    }
    resolvedRunId = runIdArg;
    resolvedConferenceName = runState.conferenceName;
    resolvedStatePath = runPaths.statePath;
    resolvedEventsPath = runPaths.eventsPath;
  } else {
    const fixtureRunId = `run-callback-fixture-${Date.now()}-${randomBytes(3).toString("hex")}`;
    const conferenceName = `${POC_CONFERENCE_NAME_PREFIX}${fixtureRunId}`;
    let fixture = createEmptyPocState({
      pocId: fixtureRunId,
      conferenceName,
      linkedSessionId: null,
    });
    fixture = seedWaitingForProviderSession(fixture);
    writePocState(fixture, repoRoot);
    activatePocRun({ runId: fixtureRunId, linkedSessionId: null, stateRoot: repoRoot });
    const runPaths = getPocRunPaths(fixtureRunId, repoRoot);
    resolvedRunId = fixtureRunId;
    resolvedConferenceName = conferenceName;
    resolvedStatePath = runPaths.statePath;
    resolvedEventsPath = runPaths.eventsPath;
    fixtureCreated = true;
  }

  const state = resolvedRunId ? readPocRunState(resolvedRunId, repoRoot) : null;
  const operationId = `poc-callback-selftest-${Date.now()}-${randomBytes(4).toString("hex")}`;

  console.log("[poc:vox:test-callback] config", {
    callbackEnabled,
    callbackSecretConfigured: secretConfigured,
    callbackSecretSha256Prefix: secretPrefix,
    callbackUrlHost: host,
    callbackUrlPath: path,
    statePath,
    resolvedRunId,
    resolvedConferenceName,
    resolvedStateScope,
    resolvedStatePath,
    resolvedEventsPath,
    legacyStateUsed: resolvedStateScope !== "RUN_SCOPED",
    // Path shown for local operators; not sent to Voximplant.
    repositoryRoot: repoRoot,
    worktreeFingerprint: expectedDiag.worktreeFingerprint,
    branchOrBuildId: expectedDiag.branchOrBuildId,
    classificationHint: expectedDiag.classificationHint,
    pocStateFound: Boolean(state),
    dryRun,
  });

  if (!callbackEnabled) {
    console.log("[poc:vox:test-callback] result", {
      CALLBACK_ROUTE_REACHED: false,
      CALLBACK_SIGNATURE_ACCEPTED: false,
      CALLBACK_EVENT_PERSISTED: false,
      errorCode: "POC_CALLBACK_DISABLED",
    });
    process.exitCode = 1;
    return;
  }

  if (!secretConfigured) {
    console.log("[poc:vox:test-callback] result", {
      CALLBACK_ROUTE_REACHED: false,
      CALLBACK_SIGNATURE_ACCEPTED: false,
      CALLBACK_EVENT_PERSISTED: false,
      errorCode: "CALLBACK_SECRET_MISSING",
    });
    process.exitCode = 1;
    return;
  }

  if (!state) {
    console.log("[poc:vox:test-callback] result", {
      CALLBACK_ROUTE_REACHED: false,
      CALLBACK_SIGNATURE_ACCEPTED: false,
      CALLBACK_EVENT_PERSISTED: false,
      errorCode: "POC_STATE_MISSING",
      note: "Run start-conference or seed local POC state first.",
    });
    process.exitCode = 1;
    return;
  }
  const providerSessionId =
    state.providerSessionId ??
    state.callSessionHistoryId ??
    `local-replay-${Date.now()}`;
  const payload = isSessionRegistered
    ? buildPocCallbackPayload({
        eventType: "session_registered",
        action: "register",
        operationId: `session-register-${providerSessionId}`,
        conferenceName: resolvedConferenceName,
        callSessionHistoryId: providerSessionId,
        providerSessionId,
        scenarioBuild: POC_EXPECTED_SCENARIO_BUILD,
        scenarioSource: POC_SCENARIO_SOURCE_NAME,
        routingRuleIdentity:
          process.env.VOXIMPLANT_SERVER_STOP_POC_RULE_NAME?.trim() ||
          "neg-poc-server-stop-rule",
        // Local replay only — never a real provider control URL.
        mediaSessionAccessSecureUrl:
          "https://example.invalid/poc-local-replay/session",
        mediaSessionAccessUrl:
          "https://example.invalid/poc-local-replay/session",
        recorderState: "absent",
      })
    : buildPocCallbackPayload({
        eventType: "command_accepted",
        action: "ping",
        operationId,
        conferenceName: resolvedConferenceName,
        callSessionHistoryId: state.callSessionHistoryId,
        recorderState: "absent",
      });
  const signed = buildSignedCallbackRequest({ payload, secret });
  const matchOperationId = payload.operationId ?? operationId;

  if (dryRun) {
    console.log("[poc:vox:test-callback] dry-run request", {
      operationId: matchOperationId,
      eventType: payload.eventType,
      action: payload.action,
      conferenceName: payload.conferenceName,
      scenarioBuild: payload.scenarioBuild ?? null,
      hasControlUrlInBody: Boolean(payload.mediaSessionAccessSecureUrl),
      bodyLength: signed.body.length,
      headerKeys: Object.keys(signed.headers).sort(),
      signaturePresent: Boolean(signed.signature),
      bodySha256Prefix: createHash("sha256")
        .update(signed.body)
        .digest("hex")
        .slice(0, 12),
      httpCall: false,
    });
    console.log("[poc:vox:test-callback] result", {
      dryRun: true,
      CALLBACK_ROUTE_REACHED: false,
      CALLBACK_SIGNATURE_ACCEPTED: false,
      CALLBACK_EVENT_PERSISTED: false,
    });
    return;
  }

  let httpStatus = 0;
  let errorCode: string | null = null;
  let routeFingerprint: string | null = null;
  let routeBuildId: string | null = null;
  let responseAccepted = false;
  let responsePersisted = false;
  let responseRuntimeStatus: string | null = null;
  let responseStateScope: string | null = null;
  let responseRunId: string | null = null;
  let responseOperationId: string | null = null;
  let responseEventType: string | null = null;
  let responseProviderSessionId: string | null = null;
  let responseOk = false;

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    httpStatus = response.status;
    routeFingerprint =
      response.headers.get("X-Neg-Poc-Worktree-Fingerprint") || null;
    routeBuildId = response.headers.get("X-Neg-Poc-Build-Id") || null;
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      accepted?: boolean;
      persisted?: boolean;
      stateScope?: unknown;
      runId?: unknown;
      runtimeStatus?: unknown;
      operationId?: unknown;
      eventType?: unknown;
      providerSessionId?: unknown;
      errorCode?: string;
      worktreeFingerprint?: string;
    } | null;
    responseOk = json?.ok === true;
    errorCode = json?.errorCode ?? null;
    responseAccepted = json?.accepted === true;
    responsePersisted = json?.persisted === true;
    responseStateScope =
      typeof json?.stateScope === "string" ? json.stateScope : null;
    responseRunId = typeof json?.runId === "string" ? json.runId : null;
    responseRuntimeStatus =
      typeof json?.runtimeStatus === "string" ? json.runtimeStatus : null;
    responseOperationId =
      typeof json?.operationId === "string" ? json.operationId : null;
    responseEventType = typeof json?.eventType === "string" ? json.eventType : null;
    responseProviderSessionId =
      typeof json?.providerSessionId === "string" ? json.providerSessionId : null;
    if (!routeFingerprint && json?.worktreeFingerprint) {
      routeFingerprint = json.worktreeFingerprint;
    }
  } catch (error) {
    console.log("[poc:vox:test-callback] http error", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    return;
  }

  const worktreeClass = classifyWorktreeMatch({
    observedFingerprint: routeFingerprint,
    expectedFingerprint: expectedDiag.worktreeFingerprint,
  });

  const after =
    responseRunId && responseRunId.trim()
      ? readPocRunState(responseRunId, repoRoot)
      : resolvedRunId
        ? readPocRunState(resolvedRunId, repoRoot)
        : null;
  const matched = after
    ? findMatchingCallbackEvent(after, {
        operationId: matchOperationId,
        eventType: payload.eventType,
        action: payload.action,
      })
    : null;
  const persisted = Boolean(matched) && responsePersisted;
  const operationIdFoundInState = Boolean(matched);
  const eventsInfo = resolvedEventsPath
    ? readRunEventsPathInfo(resolvedEventsPath, matchOperationId)
    : { callbackEventCount: 0, operationIdFound: false };
  const operationIdFoundInEvents = Boolean(
    after?.callbackEvents.some((event) => event.operationId === matchOperationId) ||
      eventsInfo.operationIdFound,
  );
  const legacyStateUsed =
    resolvedStateScope !== "RUN_SCOPED" || responseStateScope === "LEGACY_GLOBAL_STATE";

  const routeReached = httpStatus > 0;
  console.log("[poc:vox:test-callback] http", {
    httpStatus,
    errorCode,
    routeWorktreeFingerprint: routeFingerprint,
    routeBranchOrBuildId: routeBuildId,
    worktreeClassification: worktreeClass,
    responseOk,
    responseAccepted,
    responsePersisted,
    responseStateScope,
    responseRunId,
    responseRuntimeStatus,
    responseOperationId,
    responseEventType,
    responseProviderSessionId,
  });
  console.log("[poc:vox:test-callback] result", {
    CALLBACK_ROUTE_REACHED: routeReached,
    CALLBACK_SIGNATURE_ACCEPTED: responseAccepted,
    CALLBACK_EVENT_PERSISTED: persisted,
    resolvedRunId,
    resolvedConferenceName,
    resolvedStateScope,
    resolvedStatePath,
    resolvedEventsPath,
    legacyStateUsed,
    responseAccepted,
    responsePersisted,
    responseRuntimeStatus,
    operationIdFoundInState,
    operationIdFoundInEvents,
    operationId: matchOperationId,
    eventType: payload.eventType,
    runtimeStatus: after?.runtimeStatus ?? null,
    providerSessionId: after?.providerSessionId ?? null,
    hasControlUrl: after?.hasControlUrl ?? false,
    controlUrlFingerprint: after?.controlUrlFingerprint ?? null,
    callbackEventCount: after?.callbackEvents.length ?? 0,
  });

  const sessionRegistrationScopeOk =
    !isSessionRegistered || resolvedStateScope === "RUN_SCOPED";
  const sessionRegistrationPersistenceOk =
    !isSessionRegistered || responsePersisted === true;

  if (
    !routeReached ||
    !responseAccepted ||
    !persisted ||
    !operationIdFoundInState ||
    !operationIdFoundInEvents ||
    !sessionRegistrationScopeOk ||
    !sessionRegistrationPersistenceOk ||
    legacyStateUsed
  ) {
    process.exitCode = 1;
  }

  if (fixtureCreated && previousPointer?.runId) {
    activatePocRun({
      runId: previousPointer.runId,
      linkedSessionId: previousPointer.linkedSessionId,
      activatedAt: previousPointer.activatedAt,
      stateRoot: repoRoot,
    });
  }
}

main().catch((error) => {
  console.error("[poc:vox:test-callback] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
