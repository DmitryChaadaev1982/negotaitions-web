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
  readPocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  POC_EXPECTED_SCENARIO_BUILD,
  POC_SCENARIO_SOURCE_NAME,
} from "@/lib/voximplant/poc/poc-safety";
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
  const fromArg = readArg("--url");
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
  const state = readPocState();
  const operationId = `poc-callback-selftest-${Date.now()}-${randomBytes(4).toString("hex")}`;

  console.log("[poc:vox:test-callback] config", {
    callbackEnabled,
    callbackSecretConfigured: secretConfigured,
    callbackSecretSha256Prefix: secretPrefix,
    callbackUrlHost: host,
    callbackUrlPath: path,
    statePath,
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

  const eventArg = readArg("--event") ?? "command_accepted";
  const isSessionRegistered = eventArg === "session_registered";
  const providerSessionId =
    state.providerSessionId ??
    state.callSessionHistoryId ??
    `local-replay-${Date.now()}`;
  const payload = isSessionRegistered
    ? buildPocCallbackPayload({
        eventType: "session_registered",
        action: "register",
        operationId: `session-register-${providerSessionId}`,
        conferenceName: state.conferenceName,
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
        conferenceName: state.conferenceName,
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
  let signatureAccepted = false;

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
      errorCode?: string;
      worktreeFingerprint?: string;
    } | null;
    errorCode = json?.errorCode ?? null;
    if (!routeFingerprint && json?.worktreeFingerprint) {
      routeFingerprint = json.worktreeFingerprint;
    }
    signatureAccepted =
      response.ok &&
      (errorCode === "CALLBACK_ACCEPTED" || errorCode == null) &&
      json?.ok === true;
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

  const after = readPocState();
  const matched = after
    ? findMatchingCallbackEvent(after, {
        operationId: matchOperationId,
        eventType: payload.eventType,
        action: payload.action,
      })
    : null;
  const persisted = Boolean(matched);

  const routeReached = httpStatus > 0;
  console.log("[poc:vox:test-callback] http", {
    httpStatus,
    errorCode,
    routeWorktreeFingerprint: routeFingerprint,
    routeBranchOrBuildId: routeBuildId,
    worktreeClassification: worktreeClass,
    signatureAccepted,
  });
  console.log("[poc:vox:test-callback] result", {
    CALLBACK_ROUTE_REACHED: routeReached,
    CALLBACK_SIGNATURE_ACCEPTED: signatureAccepted,
    CALLBACK_EVENT_PERSISTED: persisted,
    operationId: matchOperationId,
    eventType: payload.eventType,
    runtimeStatus: after?.runtimeStatus ?? null,
    providerSessionId: after?.providerSessionId ?? null,
    hasControlUrl: after?.hasControlUrl ?? false,
    controlUrlFingerprint: after?.controlUrlFingerprint ?? null,
    callbackEventCount: after?.callbackEvents.length ?? 0,
  });

  if (!routeReached || !signatureAccepted || !persisted) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[poc:vox:test-callback] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
