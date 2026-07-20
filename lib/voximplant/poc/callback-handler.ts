import { existsSync, readFileSync } from "node:fs";

import {
  mapCallbackErrorCode,
  type PocCallbackResultCode,
} from "@/lib/voximplant/poc/callback-result-codes";
import {
  buildSignedCallbackRequest,
  getPocCallbackSecret,
  hashCallbackBody,
  isPocCallbackEnabled,
  isPocCallbackEventType,
  type PocCallbackPayload,
  verifyCallbackSignature,
} from "@/lib/voximplant/poc/callback-signature";
import {
  assertPocScenarioIdentity,
  POC_CONFERENCE_NAME_PREFIX,
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import {
  POC_TERMINAL_RUNTIME_STATUSES,
  appendPocCallbackEvent,
  readPocRunState,
  resolveRuntimeStatus,
  type PocRuntimeStatus,
  PocStatePersistenceError,
  writePocState,
  type PocCallbackEventRecord,
  type VoximplantServerStopPocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  getPocCurrentPointerPath,
  getPocLegacyStatePath,
  getPocRunPaths,
  listPocRunIds,
  readCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import { getPrivateControlStatePath } from "@/lib/voximplant/poc/private-control-state";
import { applySessionRegisteredToState } from "@/lib/voximplant/poc/session-registration";

export type PocCallbackStateScope = "RUN_SCOPED" | "LEGACY_GLOBAL_STATE";

export type ProcessPocCallbackResult =
  | {
      ok: true;
      status: 200;
      errorCode: "CALLBACK_ACCEPTED_AND_PERSISTED";
      accepted: true;
      persisted: true;
      stateScope: "RUN_SCOPED";
      runId: string;
      runtimeStatus: PocRuntimeStatus;
      providerSessionId: string | null;
      event: PocCallbackEventRecord;
      disabled?: undefined;
    }
  | {
      ok: false;
      status: number;
      errorCode: PocCallbackResultCode;
      accepted: false;
      persisted: false;
      stateScope: PocCallbackStateScope | null;
      runId: string | null;
      runtimeStatus: PocRuntimeStatus | null;
      providerSessionId: string | null;
      disabled?: boolean;
    };

type ResolvedRunTarget = {
  runId: string;
  state: VoximplantServerStopPocState;
  statePath: string;
  eventsPath: string;
  pointerPath: string;
  activePointerRunId: string | null;
  privateControlStatePath: string;
};

type ResolveRunResult =
  | { ok: true; target: ResolvedRunTarget }
  | {
      ok: false;
      errorCode: PocCallbackResultCode;
      status: number;
    };

type RunStateFile = {
  runId?: unknown;
  updatedAt?: unknown;
  callbackEvents?: unknown;
};

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

function parsePayload(raw: unknown): PocCallbackPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const eventType = typeof obj.eventType === "string" ? obj.eventType : "";
  if (!isPocCallbackEventType(eventType)) return null;

  const protocolVersion =
    typeof obj.protocolVersion === "number"
      ? obj.protocolVersion
      : typeof obj.protocolVersion === "string"
        ? Number(obj.protocolVersion)
        : NaN;

  const callSessionHistoryId =
    typeof obj.callSessionHistoryId === "string"
      ? obj.callSessionHistoryId
      : typeof obj.callSessionHistoryId === "number"
        ? String(obj.callSessionHistoryId)
        : null;
  const providerSessionId =
    typeof obj.providerSessionId === "string"
      ? obj.providerSessionId
      : typeof obj.providerSessionId === "number"
        ? String(obj.providerSessionId)
        : null;

  return {
    scenarioKind: typeof obj.scenarioKind === "string" ? obj.scenarioKind : "",
    protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : NaN,
    eventType,
    action: typeof obj.action === "string" ? obj.action : null,
    operationId: typeof obj.operationId === "string" ? obj.operationId : null,
    conferenceName:
      typeof obj.conferenceName === "string" ? obj.conferenceName : null,
    callSessionHistoryId,
    providerSessionId,
    recorderState:
      typeof obj.recorderState === "string" ? obj.recorderState : null,
    errorCode: typeof obj.errorCode === "string" ? obj.errorCode : null,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    nonce: typeof obj.nonce === "string" ? obj.nonce : "",
    scenarioBuild:
      typeof obj.scenarioBuild === "string" ? obj.scenarioBuild : null,
    scenarioSource:
      typeof obj.scenarioSource === "string" ? obj.scenarioSource : null,
    routingRuleIdentity:
      typeof obj.routingRuleIdentity === "string"
        ? obj.routingRuleIdentity
        : typeof obj.ruleIdentity === "string"
          ? obj.ruleIdentity
          : null,
    mediaSessionAccessSecureUrl:
      typeof obj.mediaSessionAccessSecureUrl === "string"
        ? obj.mediaSessionAccessSecureUrl
        : null,
    mediaSessionAccessUrl:
      typeof obj.mediaSessionAccessUrl === "string"
        ? obj.mediaSessionAccessUrl
        : null,
  };
}

function fail(
  errorCode: PocCallbackResultCode,
  status: number,
  context: Partial<{
    disabled: boolean;
    stateScope: PocCallbackStateScope | null;
    runId: string | null;
    runtimeStatus: PocRuntimeStatus | null;
    providerSessionId: string | null;
  }> = {},
): ProcessPocCallbackResult {
  return {
    ok: false,
    status,
    errorCode,
    accepted: false,
    persisted: false,
    disabled: context.disabled,
    stateScope: context.stateScope ?? null,
    runId: context.runId ?? null,
    runtimeStatus: context.runtimeStatus ?? null,
    providerSessionId: context.providerSessionId ?? null,
  };
}

function isTerminalCallbackAllowed(
  eventType: PocCallbackPayload["eventType"],
): boolean {
  return eventType === "scenario_terminating";
}

function statusForResultCode(code: PocCallbackResultCode): number {
  switch (code) {
    case "POC_CALLBACK_DISABLED":
      return 404;
    case "CALLBACK_SECRET_MISSING":
      return 503;
    case "INVALID_CALLBACK_SIGNATURE":
    case "CALLBACK_TIMESTAMP_EXPIRED":
    case "CALLBACK_NONCE_REPLAYED":
      return 401;
    case "CALLBACK_PAYLOAD_INVALID":
      return 400;
    case "POC_CALLBACK_RUN_NOT_FOUND":
      return 404;
    case "POC_CALLBACK_RUN_AMBIGUOUS":
    case "POC_CALLBACK_CONFERENCE_MISMATCH":
    case "POC_CALLBACK_RUN_TERMINAL":
    case "POC_CALLBACK_LEGACY_STATE_REFUSED":
    case "POC_PROVIDER_SESSION_CONFLICT":
    case "POC_PROVIDER_SESSION_ID_MISMATCH":
    case "POC_MULTIPLE_PROVIDER_SESSIONS_DETECTED":
      return 409;
    case "POC_PRIVATE_CONTROL_STATE_WRITE_FAILED":
    case "POC_CALLBACK_RUN_STATE_WRITE_FAILED":
    case "POC_CALLBACK_EVENTS_WRITE_FAILED":
    case "POC_SESSION_REGISTRATION_PERSISTENCE_FAILED":
      return 500;
    case "POC_STATE_MISSING":
      return 409;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "POC_BROWSER_ROUTED_TO_PRODUCTION_RULE":
    case "POC_UNEXPECTED_SCENARIO":
    case "POC_UNEXPECTED_SCENARIO_BUILD":
      return 409;
    case "CALLBACK_ACCEPTED_AND_PERSISTED":
      return 200;
    default:
      return 400;
  }
}

function readRunEvents(eventsPath: string): PocCallbackEventRecord[] | null {
  if (!existsSync(eventsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(eventsPath, "utf8")) as RunStateFile;
    if (!parsed || !Array.isArray(parsed.callbackEvents)) return null;
    return parsed.callbackEvents as PocCallbackEventRecord[];
  } catch {
    return null;
  }
}

function callbackEventMatches(
  event: PocCallbackEventRecord,
  params: {
    operationId: string | null;
    nonce: string;
    eventType: string;
  },
): boolean {
  if (event.eventType !== params.eventType) return false;
  if (params.operationId && event.operationId === params.operationId) return true;
  return Boolean(event.nonce && event.nonce === params.nonce);
}

function resolveRunTargetByConference(params: {
  conferenceName: string;
  eventType: PocCallbackPayload["eventType"];
  stateRoot?: string;
}): ResolveRunResult {
  const conferenceName = params.conferenceName.trim();
  if (!conferenceName || !conferenceName.startsWith(POC_CONFERENCE_NAME_PREFIX)) {
    return {
      ok: false,
      errorCode: "CALLBACK_PAYLOAD_INVALID",
      status: 400,
    };
  }

  const pointerPath = getPocCurrentPointerPath(params.stateRoot);
  const pointer = readCurrentPointer(params.stateRoot);
  const candidates: ResolvedRunTarget[] = [];

  if (pointer?.runId) {
    const pointerState = readPocRunState(pointer.runId, params.stateRoot);
    if (pointerState) {
      if (pointerState.conferenceName === conferenceName) {
        const runPaths = getPocRunPaths(pointer.runId, params.stateRoot);
        candidates.push({
          runId: pointer.runId,
          state: pointerState,
          statePath: runPaths.statePath,
          eventsPath: runPaths.eventsPath,
          pointerPath,
          activePointerRunId: pointer.runId,
          privateControlStatePath: getPrivateControlStatePath(
            pointer.runId,
            params.stateRoot,
          ),
        });
      } else {
        // stale/mismatched pointer; fallback to retained run lookup below
      }
    }
  }

  if (candidates.length === 0) {
    for (const runId of listPocRunIds(params.stateRoot)) {
      if (runId === pointer?.runId) continue;
      const state = readPocRunState(runId, params.stateRoot);
      if (!state) continue;
      if (state.conferenceName !== conferenceName) continue;
      const runPaths = getPocRunPaths(runId, params.stateRoot);
      candidates.push({
        runId,
        state,
        statePath: runPaths.statePath,
        eventsPath: runPaths.eventsPath,
        pointerPath,
        activePointerRunId: pointer?.runId ?? null,
        privateControlStatePath: getPrivateControlStatePath(runId, params.stateRoot),
      });
    }
  }

  if (candidates.length === 0) {
    const legacyPath = getPocLegacyStatePath(params.stateRoot);
    if (existsSync(legacyPath)) {
      return {
        ok: false,
        errorCode: "POC_CALLBACK_LEGACY_STATE_REFUSED",
        status: 409,
      };
    }
    return {
      ok: false,
      errorCode: "POC_CALLBACK_RUN_NOT_FOUND",
      status: 404,
    };
  }

  if (candidates.length > 1) {
    return {
      ok: false,
      errorCode: "POC_CALLBACK_RUN_AMBIGUOUS",
      status: 409,
    };
  }

  const target = candidates[0]!;
  const runtimeStatus = resolveRuntimeStatus(target.state);
  if (
    POC_TERMINAL_RUNTIME_STATUSES.has(runtimeStatus) &&
    !isTerminalCallbackAllowed(params.eventType)
  ) {
    return {
      ok: false,
      errorCode: "POC_CALLBACK_RUN_TERMINAL",
      status: 409,
    };
  }

  return { ok: true, target };
}

/**
 * Process a POC callback. No Prisma / DB writes — local ignored state only.
 */
export function processPocCallback(params: {
  rawBody: string;
  headers: Headers | Record<string, string | string[] | undefined>;
  env?: NodeJS.ProcessEnv;
  /** Explicit state root (tests). Omit to use repository-root resolver. */
  cwd?: string;
  nowMs?: number;
  persist?: boolean;
}): ProcessPocCallbackResult {
  const env = params.env ?? process.env;
  if (!isPocCallbackEnabled(env)) {
    return fail("POC_CALLBACK_DISABLED", 404, { disabled: true });
  }

  let secret: string;
  try {
    secret = getPocCallbackSecret(env);
  } catch {
    return fail("CALLBACK_SECRET_MISSING", 503);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawBody);
  } catch {
    return fail("CALLBACK_PAYLOAD_INVALID", 400);
  }

  const payload = parsePayload(parsedJson);
  if (!payload) {
    return fail("CALLBACK_PAYLOAD_INVALID", 400);
  }

  try {
    assertPocScenarioIdentity({
      scenarioKind: payload.scenarioKind,
      protocolVersion: payload.protocolVersion,
    });
  } catch (error) {
    if (error instanceof PocSafetyError) {
      return fail("CALLBACK_PAYLOAD_INVALID", 400);
    }
    return fail("CALLBACK_PAYLOAD_INVALID", 400);
  }

  const version =
    getHeader(params.headers, "X-Neg-Poc-Callback-Version") ?? "v1";
  const timestamp =
    getHeader(params.headers, "X-Neg-Poc-Callback-Timestamp") ??
    payload.timestamp;
  const nonce =
    getHeader(params.headers, "X-Neg-Poc-Callback-Nonce") ?? payload.nonce;
  const bodyHashHeader = getHeader(
    params.headers,
    "X-Neg-Poc-Callback-Body-Hash",
  );
  const signature = getHeader(
    params.headers,
    "X-Neg-Poc-Callback-Signature",
  );
  const expectedBodyHash = hashCallbackBody(params.rawBody);
  if (
    bodyHashHeader &&
    bodyHashHeader.trim().toLowerCase() !== expectedBodyHash
  ) {
    return fail("INVALID_CALLBACK_SIGNATURE", 401);
  }

  const verified = verifyCallbackSignature({
    version,
    eventType: payload.eventType,
    action: payload.action ?? "",
    operationId: payload.operationId ?? "",
    conferenceName: payload.conferenceName ?? "",
    timestamp,
    nonce,
    bodyHash: expectedBodyHash,
    signature: signature ?? "",
    secret,
    nowMs: params.nowMs,
  });

  if (!verified.ok) {
    const mapped = mapCallbackErrorCode(verified.errorCode);
    return {
      ...fail(mapped, statusForResultCode(mapped)),
    };
  }

  const conferenceName = payload.conferenceName?.trim() ?? "";
  const resolved = resolveRunTargetByConference({
    conferenceName,
    eventType: payload.eventType,
    stateRoot: params.cwd,
  });
  if (!resolved.ok) {
    return fail(resolved.errorCode, resolved.status, {
      stateScope:
        resolved.errorCode === "POC_CALLBACK_LEGACY_STATE_REFUSED"
          ? "LEGACY_GLOBAL_STATE"
          : "RUN_SCOPED",
    });
  }

  const currentState = resolved.target.state;
  const normalizedNonce = nonce.trim();
  if (currentState.seenCallbackNonces.includes(normalizedNonce)) {
    return fail("CALLBACK_NONCE_REPLAYED", 401, {
      stateScope: "RUN_SCOPED",
      runId: resolved.target.runId,
      runtimeStatus: resolveRuntimeStatus(currentState),
      providerSessionId: currentState.providerSessionId,
    });
  }

  const receivedAt = new Date(params.nowMs ?? Date.now()).toISOString();
  const providerSessionId =
    payload.providerSessionId ?? payload.callSessionHistoryId;

  // Ensure persisted records never include secrets / control URLs.
  const safeEvent: PocCallbackEventRecord = {
    eventType: payload.eventType,
    action: payload.action,
    operationId: payload.operationId,
    conferenceName: payload.conferenceName,
    callSessionHistoryId: providerSessionId,
    recorderState: payload.recorderState,
    errorCode: payload.errorCode,
    receivedAt,
    nonce: normalizedNonce,
    signatureVerified: true,
  };

  let nextState = currentState;
  if (payload.eventType === "session_registered") {
    let applied: ReturnType<typeof applySessionRegisteredToState>;
    try {
      applied = applySessionRegisteredToState(
        currentState,
        {
          conferenceName: payload.conferenceName,
          callSessionHistoryId: payload.callSessionHistoryId ?? null,
          providerSessionId,
          scenarioBuild: payload.scenarioBuild ?? null,
          scenarioSource: payload.scenarioSource ?? null,
          routingRuleIdentity: payload.routingRuleIdentity ?? null,
          mediaSessionAccessSecureUrl: payload.mediaSessionAccessSecureUrl ?? null,
          mediaSessionAccessUrl: payload.mediaSessionAccessUrl ?? null,
          registeredAt: receivedAt,
        },
        { stateRoot: params.cwd },
      );
    } catch (error) {
      if (error instanceof PocStatePersistenceError) {
        return fail(error.code, statusForResultCode(error.code), {
          stateScope: "RUN_SCOPED",
          runId: resolved.target.runId,
          runtimeStatus: resolveRuntimeStatus(currentState),
          providerSessionId: currentState.providerSessionId,
        });
      }
      return fail(
        "POC_PRIVATE_CONTROL_STATE_WRITE_FAILED",
        statusForResultCode("POC_PRIVATE_CONTROL_STATE_WRITE_FAILED"),
        {
          stateScope: "RUN_SCOPED",
          runId: resolved.target.runId,
          runtimeStatus: resolveRuntimeStatus(currentState),
          providerSessionId: currentState.providerSessionId,
        },
      );
    }

    if (!applied.ok) {
      if (params.persist !== false) {
        try {
          writePocState(applied.state, params.cwd);
        } catch (error) {
          if (error instanceof PocStatePersistenceError) {
            return fail(error.code, statusForResultCode(error.code), {
              stateScope: "RUN_SCOPED",
              runId: resolved.target.runId,
              runtimeStatus: resolveRuntimeStatus(applied.state),
              providerSessionId: applied.state.providerSessionId,
            });
          }
          return fail(
            "POC_CALLBACK_RUN_STATE_WRITE_FAILED",
            statusForResultCode("POC_CALLBACK_RUN_STATE_WRITE_FAILED"),
            {
              stateScope: "RUN_SCOPED",
              runId: resolved.target.runId,
              runtimeStatus: resolveRuntimeStatus(applied.state),
              providerSessionId: applied.state.providerSessionId,
            },
          );
        }
      }
      const mapped =
        applied.code === "POC_MULTIPLE_PROVIDER_SESSIONS_DETECTED"
          ? "POC_PROVIDER_SESSION_CONFLICT"
          : mapCallbackErrorCode(applied.code);
      return {
        ...fail(mapped, statusForResultCode(mapped), {
          stateScope: "RUN_SCOPED",
          runId: resolved.target.runId,
          runtimeStatus: resolveRuntimeStatus(applied.state),
          providerSessionId: applied.state.providerSessionId,
        }),
      };
    }
    nextState = applied.state;
  }

  const next = appendPocCallbackEvent(nextState, safeEvent, normalizedNonce);
  if (params.persist !== false) {
    try {
      writePocState(next, params.cwd);
    } catch (error) {
      if (error instanceof PocStatePersistenceError) {
        return fail(error.code, statusForResultCode(error.code), {
          stateScope: "RUN_SCOPED",
          runId: resolved.target.runId,
          runtimeStatus: resolveRuntimeStatus(next),
          providerSessionId: next.providerSessionId,
        });
      }
      return fail(
        "POC_CALLBACK_RUN_STATE_WRITE_FAILED",
        statusForResultCode("POC_CALLBACK_RUN_STATE_WRITE_FAILED"),
        {
          stateScope: "RUN_SCOPED",
          runId: resolved.target.runId,
          runtimeStatus: resolveRuntimeStatus(next),
          providerSessionId: next.providerSessionId,
        },
      );
    }
  }

  const persistedState = readPocRunState(resolved.target.runId, params.cwd);
  if (!persistedState) {
    return fail("POC_CALLBACK_RUN_STATE_WRITE_FAILED", 500, {
      stateScope: "RUN_SCOPED",
      runId: resolved.target.runId,
    });
  }
  const persistedEvents = readRunEvents(resolved.target.eventsPath);
  const foundInState = persistedState.callbackEvents.some((event) =>
    callbackEventMatches(event, {
      operationId: safeEvent.operationId,
      nonce: normalizedNonce,
      eventType: safeEvent.eventType,
    }),
  );
  const foundInEvents = Boolean(
    persistedEvents?.some((event) =>
      callbackEventMatches(event, {
        operationId: safeEvent.operationId,
        nonce: normalizedNonce,
        eventType: safeEvent.eventType,
      }),
    ),
  );
  if (!foundInState || !foundInEvents) {
    const code: PocCallbackResultCode =
      payload.eventType === "session_registered"
        ? "POC_SESSION_REGISTRATION_PERSISTENCE_FAILED"
        : "POC_CALLBACK_EVENTS_WRITE_FAILED";
    return fail(code, statusForResultCode(code), {
      stateScope: "RUN_SCOPED",
      runId: resolved.target.runId,
      runtimeStatus: resolveRuntimeStatus(persistedState),
      providerSessionId: persistedState.providerSessionId,
    });
  }
  if (
    payload.eventType === "session_registered" &&
    providerSessionId &&
    persistedState.providerSessionId !== providerSessionId
  ) {
    return fail("POC_SESSION_REGISTRATION_PERSISTENCE_FAILED", 500, {
      stateScope: "RUN_SCOPED",
      runId: resolved.target.runId,
      runtimeStatus: resolveRuntimeStatus(persistedState),
      providerSessionId: persistedState.providerSessionId,
    });
  }

  return {
    ok: true,
    status: 200,
    errorCode: "CALLBACK_ACCEPTED_AND_PERSISTED",
    accepted: true,
    persisted: true,
    stateScope: "RUN_SCOPED",
    runId: resolved.target.runId,
    runtimeStatus: resolveRuntimeStatus(persistedState),
    providerSessionId: persistedState.providerSessionId,
    event: safeEvent,
  };
}

/** Dry-run helper: construct a signed callback without network I/O. */
export function buildDryRunPocCallback(params: {
  eventType: PocCallbackPayload["eventType"];
  action?: string | null;
  operationId?: string | null;
  conferenceName?: string | null;
  callSessionHistoryId?: string | null;
  recorderState?: string | null;
  errorCode?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const secret = getPocCallbackSecret(params.env ?? process.env, {
    allowDryRunPlaceholder: true,
  });
  const payload: PocCallbackPayload = {
    scenarioKind: POC_SCENARIO_KIND,
    protocolVersion: POC_PROTOCOL_VERSION,
    eventType: params.eventType,
    action: params.action ?? null,
    operationId: params.operationId ?? null,
    conferenceName: params.conferenceName ?? null,
    callSessionHistoryId: params.callSessionHistoryId ?? null,
    recorderState: params.recorderState ?? null,
    errorCode: params.errorCode ?? null,
    timestamp: new Date().toISOString(),
    nonce: `dry-run-${Date.now().toString(16)}`,
  };
  const signed = buildSignedCallbackRequest({ payload, secret });
  return {
    payload,
    headerKeys: Object.keys(signed.headers).sort(),
    bodyLength: signed.body.length,
    signaturePresent: Boolean(signed.signature),
    // Never return the raw signature / secret in dry-run logs by default.
    signatureFingerprint: `${signed.signature.slice(0, 8)}…`,
  };
}
