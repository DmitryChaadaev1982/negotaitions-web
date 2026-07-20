import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import { POC_CONFERENCE_NAME_PREFIX } from "@/lib/voximplant/poc/poc-safety";
import {
  readPocState,
  resolveRuntimeStatus,
  type PocRuntimeStatus,
} from "@/lib/voximplant/poc/poc-state";
import { readCurrentPointer } from "@/lib/voximplant/poc/poc-run-store";

export type PocConferenceSelectionSource =
  | "POC_STATE"
  | "DEFAULT_SESSION_NAME";

export type PocJoinPlan = {
  featureFlagEnabled: boolean;
  /** @deprecated Static env session binding removed; always null. */
  configuredPocSessionId: string | null;
  requestedSessionId: string;
  sessionIdMatch: boolean;
  pocStateFound: boolean;
  stateLinkedSessionId: string | null;
  stateConferenceName: string | null;
  runtimeStatus: PocRuntimeStatus | null;
  expiresAt: string | null;
  selectedConferenceName: string;
  selectionSource: PocConferenceSelectionSource;
  refusalOrFallbackReason: string | null;
  /** When state matches but is expired: name that ACTIVE matching would select. */
  wouldSelectIfActive: string | null;
  activeRunId: string | null;
};

function readEnvBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue = false,
): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

/**
 * Feature flag for server-started conference WebSDK join experiments.
 * Default false — ordinary sessions remain unchanged.
 */
export function isServerStartedConferencePocEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return readEnvBoolean(env, "VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC", false);
}

function isSafePocConferenceName(conferenceName: string): boolean {
  return conferenceName.startsWith(POC_CONFERENCE_NAME_PREFIX);
}

/**
 * A Session is POC-eligible only when explicitly linked in the active run
 * state or when its id uses the reserved local POC prefix.
 * Session binding is dynamic (run pointer / state) — not env.
 */
export function isExplicitPocSession(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  stateRoot?: string,
): boolean {
  void env;
  if (!sessionId) return false;
  if (sessionId.startsWith("poc-server-stop-")) return true;

  const pointer = readCurrentPointer(stateRoot);
  if (pointer?.linkedSessionId && pointer.linkedSessionId === sessionId) {
    return true;
  }

  const state = readPocState(stateRoot);
  if (state?.linkedSessionId && state.linkedSessionId === sessionId) {
    return true;
  }
  return false;
}

/**
 * When the POC flag is enabled and the Session has matching ACTIVE POC state,
 * return the pre-started conference name. Otherwise return null (caller uses
 * production naming). Expired state never selects POC conference / control URL.
 *
 * Selection requires all of:
 * - POC flag enabled
 * - active run exists
 * - requested Session ID equals active run linkedSessionId
 * - runtime ACTIVE
 * - conference name has safe prefix
 * - run is not expired
 */
export function tryResolvePocConferenceName(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  stateRoot?: string,
  nowMs: number = Date.now(),
): string | null {
  if (!isServerStartedConferencePocEnabled(env)) return null;

  const pointer = readCurrentPointer(stateRoot);
  if (!pointer?.linkedSessionId) return null;
  if (pointer.linkedSessionId !== sessionId) return null;

  const state = readPocState(stateRoot);
  if (!state?.conferenceName) return null;
  if (state.linkedSessionId !== sessionId) return null;

  const runtimeStatus = resolveRuntimeStatus(state, nowMs);
  if (runtimeStatus !== "ACTIVE") return null;
  if (!isSafePocConferenceName(state.conferenceName)) return null;

  return state.conferenceName;
}

/**
 * Access-route conference name resolver.
 * Preserves negotiation-{sessionId} for all non-POC Sessions.
 */
export function resolveVoximplantConferenceNameForAccess(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  stateRoot?: string,
  nowMs: number = Date.now(),
): string {
  return (
    tryResolvePocConferenceName(sessionId, env, stateRoot, nowMs) ??
    buildVoximplantConferenceName(sessionId)
  );
}

/**
 * Sanitized join-plan diagnostic (no control URL, no secrets).
 */
export function planPocConferenceJoin(params: {
  sessionId: string;
  env?: NodeJS.ProcessEnv;
  stateRoot?: string;
  nowMs?: number;
}): PocJoinPlan {
  const env = params.env ?? process.env;
  const nowMs = params.nowMs ?? Date.now();
  const sessionId = params.sessionId;
  const featureFlagEnabled = isServerStartedConferencePocEnabled(env);
  const defaultName = buildVoximplantConferenceName(sessionId);
  const pointer = readCurrentPointer(params.stateRoot);
  const state = readPocState(params.stateRoot);
  const stateLinkedSessionId =
    state?.linkedSessionId ?? pointer?.linkedSessionId ?? null;
  const sessionIdMatch = Boolean(
    stateLinkedSessionId && stateLinkedSessionId === sessionId,
  );

  const base = {
    featureFlagEnabled,
    configuredPocSessionId: null as string | null,
    requestedSessionId: sessionId,
    sessionIdMatch,
    pocStateFound: Boolean(state),
    stateLinkedSessionId,
    stateConferenceName: state?.conferenceName ?? null,
    runtimeStatus: state ? resolveRuntimeStatus(state, nowMs) : null,
    expiresAt: state?.expiresAt ?? null,
    activeRunId: pointer?.runId ?? null,
  };

  if (!featureFlagEnabled) {
    return {
      ...base,
      selectedConferenceName: defaultName,
      selectionSource: "DEFAULT_SESSION_NAME",
      refusalOrFallbackReason: "FEATURE_FLAG_DISABLED",
      wouldSelectIfActive: null,
    };
  }

  if (!pointer) {
    return {
      ...base,
      selectedConferenceName: defaultName,
      selectionSource: "DEFAULT_SESSION_NAME",
      refusalOrFallbackReason: "ACTIVE_RUN_MISSING",
      wouldSelectIfActive: null,
    };
  }

  if (!sessionIdMatch) {
    return {
      ...base,
      selectedConferenceName: defaultName,
      selectionSource: "DEFAULT_SESSION_NAME",
      refusalOrFallbackReason: "SESSION_ID_MISMATCH",
      wouldSelectIfActive: null,
    };
  }

  if (!state?.conferenceName) {
    return {
      ...base,
      pocStateFound: false,
      selectedConferenceName: defaultName,
      selectionSource: "DEFAULT_SESSION_NAME",
      refusalOrFallbackReason: "POC_STATE_MISSING",
      wouldSelectIfActive: null,
    };
  }

  if (!isSafePocConferenceName(state.conferenceName)) {
    return {
      ...base,
      selectedConferenceName: defaultName,
      selectionSource: "DEFAULT_SESSION_NAME",
      refusalOrFallbackReason: "UNSAFE_POC_CONFERENCE_NAME",
      wouldSelectIfActive: null,
    };
  }

  const runtimeStatus = resolveRuntimeStatus(state, nowMs);
  if (runtimeStatus !== "ACTIVE") {
    return {
      ...base,
      runtimeStatus,
      selectedConferenceName: defaultName,
      selectionSource: "DEFAULT_SESSION_NAME",
      refusalOrFallbackReason:
        "POC_STATE_EXPIRED_REQUIRES_FRESH_START_CONFERENCE",
      wouldSelectIfActive: state.conferenceName,
    };
  }

  return {
    ...base,
    runtimeStatus,
    selectedConferenceName: state.conferenceName,
    selectionSource: "POC_STATE",
    refusalOrFallbackReason: null,
    wouldSelectIfActive: state.conferenceName,
  };
}
