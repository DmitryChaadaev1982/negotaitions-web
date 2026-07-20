import {
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";

import type { PocCallbackEventType } from "@/lib/voximplant/poc/callback-signature";
import {
  getPocStatePath as resolvePocStatePath,
  POC_STATE_RELATIVE_PATH,
} from "@/lib/voximplant/poc/poc-paths";
import {
  activatePocRun,
  clearCurrentPointer,
  ensurePocRunDir,
  getPocLegacyStatePath,
  readCurrentPointer,
  resolveActiveRunPaths,
  writeJsonArtifact,
} from "@/lib/voximplant/poc/poc-run-store";
import { fingerprintControlUrl } from "@/lib/voximplant/poc/url-fingerprint";

export { POC_STATE_RELATIVE_PATH };

/** Observed idle media-session lifetime without WebSDK participants (~60s). */
export const POC_IDLE_MEDIA_SESSION_TTL_MS = 60_000;

export const POC_CALLBACK_EVENT_LIMIT = 50;
export const POC_CALLBACK_NONCE_LIMIT = 100;

export type PocRuntimeStatus = "ACTIVE" | "EXPIRED" | "UNKNOWN";

export type PocCommandResult = {
  action: string;
  ok: boolean;
  operationId: string | null;
  state: string | null;
  errorCode: string | null;
  transportOutcome?: string | null;
  at: string;
};

export type PocCallbackEventRecord = {
  eventType: PocCallbackEventType | string;
  action: string | null;
  operationId: string | null;
  conferenceName: string | null;
  callSessionHistoryId: string | null;
  recorderState: string | null;
  errorCode: string | null;
  receivedAt: string;
  signatureVerified: boolean;
};

export type PocStopEvidence = {
  operationId: string | null;
  transportAcceptedAt: string | null;
  commandAcceptedAt: string | null;
  providerTerminalAt: string | null;
};

export type VoximplantServerStopPocState = {
  pocId: string;
  conferenceName: string;
  callSessionHistoryId: string | null;
  mediaSessionAccessUrl: string | null;
  mediaSessionAccessSecureUrl: string | null;
  controlUrlFingerprint: string | null;
  ruleId: string | null;
  applicationId: string | null;
  linkedSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Local estimate of idle media-session expiry (StartConference + ~60s). */
  expiresAt: string | null;
  runtimeStatus: PocRuntimeStatus;
  lastCommand: PocCommandResult | null;
  lastStoppedEvent: {
    at: string;
    operationId: string | null;
    recordingId: string | null;
    correlation: string | null;
  } | null;
  stopEvidence: PocStopEvidence | null;
  callbackEvents: PocCallbackEventRecord[];
  seenCallbackNonces: string[];
};

/**
 * Absolute POC state path.
 * Omit `stateRoot` to use the repository-root resolver (shared by route + CLI).
 * Pass an explicit `stateRoot` for tests / isolated temp directories.
 */
export function getPocStatePath(stateRoot?: string): string {
  return resolvePocStatePath(stateRoot);
}

function normalizeState(
  parsed: Partial<VoximplantServerStopPocState>,
): VoximplantServerStopPocState | null {
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.pocId !== "string" || typeof parsed.conferenceName !== "string") {
    return null;
  }
  return {
    pocId: parsed.pocId,
    conferenceName: parsed.conferenceName,
    callSessionHistoryId: parsed.callSessionHistoryId ?? null,
    mediaSessionAccessUrl: parsed.mediaSessionAccessUrl ?? null,
    mediaSessionAccessSecureUrl: parsed.mediaSessionAccessSecureUrl ?? null,
    controlUrlFingerprint: parsed.controlUrlFingerprint ?? null,
    ruleId: parsed.ruleId ?? null,
    applicationId: parsed.applicationId ?? null,
    linkedSessionId: parsed.linkedSessionId ?? null,
    createdAt: parsed.createdAt ?? new Date().toISOString(),
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    expiresAt: parsed.expiresAt ?? null,
    runtimeStatus: parsed.runtimeStatus ?? "UNKNOWN",
    lastCommand: parsed.lastCommand ?? null,
    lastStoppedEvent: parsed.lastStoppedEvent ?? null,
    stopEvidence: parsed.stopEvidence ?? null,
    callbackEvents: Array.isArray(parsed.callbackEvents)
      ? parsed.callbackEvents.slice(-POC_CALLBACK_EVENT_LIMIT)
      : [],
    seenCallbackNonces: Array.isArray(parsed.seenCallbackNonces)
      ? parsed.seenCallbackNonces.slice(-POC_CALLBACK_NONCE_LIMIT)
      : [],
  };
}

export function readPocState(
  stateRoot?: string,
): VoximplantServerStopPocState | null {
  const active = resolveActiveRunPaths(stateRoot);
  const candidates = [
    active?.statePath,
    getPocStatePath(stateRoot),
    getPocLegacyStatePath(stateRoot),
  ].filter((value, index, all): value is string => {
    return Boolean(value) && all.indexOf(value) === index;
  });

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(
        readFileSync(path, "utf8"),
      ) as Partial<VoximplantServerStopPocState>;
      const normalized = normalizeState(parsed);
      if (normalized) return normalized;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export function writePocState(
  state: VoximplantServerStopPocState,
  stateRoot?: string,
): string {
  const runId = state.pocId;
  const paths = ensurePocRunDir(runId, stateRoot);
  const pointer = readCurrentPointer(stateRoot);
  if (!pointer || pointer.runId !== runId) {
    activatePocRun({
      runId,
      linkedSessionId: state.linkedSessionId,
      stateRoot,
    });
  } else if (
    (pointer.linkedSessionId ?? null) !== (state.linkedSessionId ?? null)
  ) {
    activatePocRun({
      runId,
      linkedSessionId: state.linkedSessionId,
      stateRoot,
      activatedAt: pointer.activatedAt,
    });
  }

  const bounded: VoximplantServerStopPocState = {
    ...state,
    callbackEvents: state.callbackEvents.slice(-POC_CALLBACK_EVENT_LIMIT),
    seenCallbackNonces: state.seenCallbackNonces.slice(-POC_CALLBACK_NONCE_LIMIT),
  };
  writeJsonArtifact(paths.statePath, bounded);
  writeJsonArtifact(paths.eventsPath, {
    runId,
    updatedAt: bounded.updatedAt,
    callbackEvents: bounded.callbackEvents,
  });
  return paths.statePath;
}

export function clearPocState(stateRoot?: string): boolean {
  const active = resolveActiveRunPaths(stateRoot);
  let removed = false;
  if (active && existsSync(active.statePath)) {
    unlinkSync(active.statePath);
    removed = true;
  }
  const legacy = getPocLegacyStatePath(stateRoot);
  if (existsSync(legacy)) {
    unlinkSync(legacy);
    removed = true;
  }
  clearCurrentPointer(stateRoot);
  return removed;
}

/** Remove synthetic self-test callback events while keeping real provider evidence. */
export function clearSyntheticSelfTestCallbacks(
  state: VoximplantServerStopPocState,
  operationIdPrefix = "poc-callback-selftest-",
): VoximplantServerStopPocState {
  const callbackEvents = state.callbackEvents.filter(
    (event) => !event.operationId?.startsWith(operationIdPrefix),
  );
  return {
    ...state,
    callbackEvents,
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyPocState(params: {
  pocId: string;
  conferenceName: string;
  linkedSessionId?: string | null;
}): VoximplantServerStopPocState {
  const now = new Date().toISOString();
  return {
    pocId: params.pocId,
    conferenceName: params.conferenceName,
    callSessionHistoryId: null,
    mediaSessionAccessUrl: null,
    mediaSessionAccessSecureUrl: null,
    controlUrlFingerprint: null,
    ruleId: null,
    applicationId: null,
    linkedSessionId: params.linkedSessionId ?? null,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    runtimeStatus: "UNKNOWN",
    lastCommand: null,
    lastStoppedEvent: null,
    stopEvidence: null,
    callbackEvents: [],
    seenCallbackNonces: [],
  };
}

export function applyStartConferenceToState(
  state: VoximplantServerStopPocState,
  params: {
    callSessionHistoryId: string | null;
    mediaSessionAccessUrl: string | null;
    mediaSessionAccessSecureUrl: string | null;
    ruleId: string | null;
    applicationId: string | null;
    startedAt?: string;
    idleTtlMs?: number;
  },
): VoximplantServerStopPocState {
  const controlUrl =
    params.mediaSessionAccessSecureUrl || params.mediaSessionAccessUrl || null;
  const startedAt = params.startedAt ?? new Date().toISOString();
  const ttl = params.idleTtlMs ?? POC_IDLE_MEDIA_SESSION_TTL_MS;
  const expiresAt = new Date(Date.parse(startedAt) + ttl).toISOString();
  return {
    ...state,
    callSessionHistoryId: params.callSessionHistoryId,
    mediaSessionAccessUrl: params.mediaSessionAccessUrl,
    mediaSessionAccessSecureUrl: params.mediaSessionAccessSecureUrl,
    controlUrlFingerprint: controlUrl ? fingerprintControlUrl(controlUrl) : null,
    ruleId: params.ruleId,
    applicationId: params.applicationId,
    createdAt: startedAt,
    updatedAt: startedAt,
    expiresAt,
    runtimeStatus: "ACTIVE",
    callbackEvents: [],
    seenCallbackNonces: [],
    stopEvidence: null,
  };
}

export function resolveRuntimeStatus(
  state: VoximplantServerStopPocState,
  nowMs: number = Date.now(),
): PocRuntimeStatus {
  if (state.runtimeStatus === "EXPIRED") return "EXPIRED";

  let expiresMs: number | null = null;
  if (state.expiresAt) {
    const parsed = Date.parse(state.expiresAt);
    if (Number.isFinite(parsed)) expiresMs = parsed;
  } else if (state.createdAt) {
    // Legacy state without expiresAt: apply observed ~60s idle TTL from createdAt.
    const createdMs = Date.parse(state.createdAt);
    if (Number.isFinite(createdMs)) {
      expiresMs = createdMs + POC_IDLE_MEDIA_SESSION_TTL_MS;
    }
  }

  if (expiresMs != null && nowMs >= expiresMs) {
    return "EXPIRED";
  }

  if (state.mediaSessionAccessSecureUrl || state.mediaSessionAccessUrl) {
    return state.runtimeStatus === "UNKNOWN" ? "ACTIVE" : state.runtimeStatus;
  }
  return state.runtimeStatus;
}

export function markPocStateExpired(
  state: VoximplantServerStopPocState,
): VoximplantServerStopPocState {
  return {
    ...state,
    runtimeStatus: "EXPIRED",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Persist a verified callback event. Never stores secrets or control URLs.
 */
export function appendPocCallbackEvent(
  state: VoximplantServerStopPocState,
  event: PocCallbackEventRecord,
  nonce?: string | null,
): VoximplantServerStopPocState {
  const callbackEvents = [...state.callbackEvents, event].slice(
    -POC_CALLBACK_EVENT_LIMIT,
  );
  const seenCallbackNonces =
    nonce && nonce.trim()
      ? [...state.seenCallbackNonces, nonce.trim()].slice(-POC_CALLBACK_NONCE_LIMIT)
      : state.seenCallbackNonces;

  let stopEvidence = state.stopEvidence;
  const now = event.receivedAt;

  if (event.eventType === "command_accepted" && event.action === "stop_recording") {
    stopEvidence = {
      operationId: event.operationId,
      transportAcceptedAt: stopEvidence?.transportAcceptedAt ?? null,
      commandAcceptedAt: stopEvidence?.commandAcceptedAt ?? now,
      providerTerminalAt: stopEvidence?.providerTerminalAt ?? null,
    };
  }

  if (event.eventType === "recording_stopped") {
    stopEvidence = {
      operationId: event.operationId ?? stopEvidence?.operationId ?? null,
      transportAcceptedAt: stopEvidence?.transportAcceptedAt ?? null,
      commandAcceptedAt: stopEvidence?.commandAcceptedAt ?? null,
      providerTerminalAt: now,
    };
  }

  const lastStoppedEvent =
    event.eventType === "recording_stopped"
      ? {
          at: now,
          operationId: event.operationId,
          recordingId: null,
          correlation: event.operationId,
        }
      : state.lastStoppedEvent;

  return {
    ...state,
    callbackEvents,
    seenCallbackNonces,
    stopEvidence,
    lastStoppedEvent,
    updatedAt: now,
  };
}

export function findMatchingCallbackEvent(
  state: VoximplantServerStopPocState,
  params: {
    operationId: string;
    eventType: PocCallbackEventType | string;
    action?: string | null;
  },
): PocCallbackEventRecord | null {
  for (let i = state.callbackEvents.length - 1; i >= 0; i--) {
    const event = state.callbackEvents[i]!;
    if (event.operationId !== params.operationId) continue;
    if (event.eventType !== params.eventType) continue;
    if (
      params.action != null &&
      params.action !== "" &&
      event.action !== params.action
    ) {
      continue;
    }
    if (!event.signatureVerified) continue;
    return event;
  }
  return null;
}

export function recordStopTransportAccepted(
  state: VoximplantServerStopPocState,
  operationId: string,
  at: string = new Date().toISOString(),
): VoximplantServerStopPocState {
  const prior = state.stopEvidence;
  // Idempotent for repeated operationId.
  if (prior?.operationId === operationId && prior.transportAcceptedAt) {
    return state;
  }
  return {
    ...state,
    stopEvidence: {
      operationId,
      transportAcceptedAt: prior?.transportAcceptedAt ?? at,
      commandAcceptedAt: prior?.commandAcceptedAt ?? null,
      providerTerminalAt: prior?.providerTerminalAt ?? null,
    },
    updatedAt: at,
  };
}

export function isPocStopSuccessful(state: VoximplantServerStopPocState): boolean {
  return Boolean(state.stopEvidence?.providerTerminalAt);
}

/** Public-safe view: never includes full control URLs or secrets. */
export function toPublicPocStateView(state: VoximplantServerStopPocState) {
  const runtimeStatus = resolveRuntimeStatus(state);
  return {
    pocId: state.pocId,
    conferenceName: state.conferenceName,
    callSessionHistoryId: state.callSessionHistoryId,
    controlUrlFingerprint: state.controlUrlFingerprint,
    ruleId: state.ruleId,
    applicationId: state.applicationId,
    linkedSessionId: state.linkedSessionId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    expiresAt: state.expiresAt,
    runtimeStatus,
    lastCommand: state.lastCommand,
    lastStoppedEvent: state.lastStoppedEvent,
    stopEvidence: state.stopEvidence,
    stopSuccessful: isPocStopSuccessful(state),
    callbackEventCount: state.callbackEvents.length,
    recentCallbackEvents: state.callbackEvents.slice(-5).map((event) => ({
      eventType: event.eventType,
      action: event.action,
      operationId: event.operationId,
      conferenceName: event.conferenceName,
      callSessionHistoryId: event.callSessionHistoryId,
      recorderState: event.recorderState,
      errorCode: event.errorCode,
      receivedAt: event.receivedAt,
      signatureVerified: event.signatureVerified,
    })),
    hasControlUrl: Boolean(
      state.mediaSessionAccessSecureUrl || state.mediaSessionAccessUrl,
    ),
  };
}

export function getActiveControlUrl(state: VoximplantServerStopPocState): string | null {
  return state.mediaSessionAccessSecureUrl || state.mediaSessionAccessUrl || null;
}
