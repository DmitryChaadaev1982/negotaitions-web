/**
 * Browser-first provider session registration (session_registered callback).
 * Stores media-session control URL in private state only.
 */

import {
  assertPocConferenceName,
  assertPocProviderRuleIdentity,
  assertPocProviderScenarioBuild,
  assertPocProviderScenarioSource,
  POC_CONFERENCE_NAME_PREFIX,
  POC_EXPECTED_SCENARIO_BUILD,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import {
  writePrivateControlState,
} from "@/lib/voximplant/poc/private-control-state";
import {
  POC_TERMINAL_RUNTIME_STATUSES,
  resolveRuntimeStatus,
  type VoximplantServerStopPocState,
} from "@/lib/voximplant/poc/poc-state";
import { fingerprintControlUrl } from "@/lib/voximplant/poc/url-fingerprint";

export type SessionRegisteredFields = {
  conferenceName: string | null;
  callSessionHistoryId: string | null;
  providerSessionId: string | null;
  scenarioBuild: string | null;
  scenarioSource: string | null;
  routingRuleIdentity: string | null;
  mediaSessionAccessSecureUrl: string | null;
  mediaSessionAccessUrl: string | null;
  registeredAt?: string;
};

export type ApplySessionRegisteredResult =
  | {
      ok: true;
      state: VoximplantServerStopPocState;
      idempotent: boolean;
    }
  | {
      ok: false;
      code: string;
      state: VoximplantServerStopPocState;
    };

function resolveProviderSessionId(fields: SessionRegisteredFields): string | null {
  const id =
    fields.providerSessionId?.trim() ||
    fields.callSessionHistoryId?.trim() ||
    null;
  return id || null;
}

/**
 * Apply a verified session_registered callback to run state.
 * Idempotent for the same provider session ID; fails on a second distinct ID.
 */
export function applySessionRegisteredToState(
  state: VoximplantServerStopPocState,
  fields: SessionRegisteredFields,
  options: { stateRoot?: string } = {},
): ApplySessionRegisteredResult {
  const runtime = resolveRuntimeStatus(state);
  if (POC_TERMINAL_RUNTIME_STATUSES.has(runtime)) {
    return {
      ok: false,
      code: "POC_STATE_TERMINAL",
      state,
    };
  }

  const providerSessionId = resolveProviderSessionId(fields);
  if (!providerSessionId) {
    return { ok: false, code: "POC_PROVIDER_SESSION_ID_MISSING", state };
  }

  const conferenceName = fields.conferenceName?.trim() || state.conferenceName;
  try {
    assertPocConferenceName(conferenceName);
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof PocSafetyError
          ? error.code
          : "INVALID_POC_CONFERENCE_NAME",
      state,
    };
  }

  if (!conferenceName.startsWith(POC_CONFERENCE_NAME_PREFIX)) {
    return { ok: false, code: "INVALID_POC_CONFERENCE_NAME", state };
  }

  if (
    state.conferenceName &&
    conferenceName !== state.conferenceName
  ) {
    return { ok: false, code: "POC_PROVIDER_SESSION_ID_MISMATCH", state };
  }

  try {
    assertPocProviderRuleIdentity(fields.routingRuleIdentity);
    assertPocProviderScenarioSource(fields.scenarioSource);
    assertPocProviderScenarioBuild(fields.scenarioBuild);
  } catch (error) {
    return {
      ok: false,
      code: error instanceof PocSafetyError ? error.code : "POC_UNEXPECTED_SCENARIO",
      state,
    };
  }

  // Idempotent: same provider session already registered.
  if (
    state.providerSessionId &&
    state.providerSessionId === providerSessionId &&
    state.runtimeStatus === "ACTIVE" &&
    state.hasControlUrl
  ) {
    return { ok: true, state, idempotent: true };
  }

  // Second distinct provider session for this run.
  if (
    state.providerSessionId &&
    state.providerSessionId !== providerSessionId
  ) {
    const failed: VoximplantServerStopPocState = {
      ...state,
      runtimeStatus: "FAILED",
      singleProviderSessionConfirmed: false,
      updatedAt: new Date().toISOString(),
    };
    return {
      ok: false,
      code: "POC_MULTIPLE_PROVIDER_SESSIONS_DETECTED",
      state: failed,
    };
  }

  const controlUrl =
    fields.mediaSessionAccessSecureUrl?.trim() ||
    fields.mediaSessionAccessUrl?.trim() ||
    null;
  if (!controlUrl) {
    return { ok: false, code: "CONTROL_URL_MISSING", state };
  }

  const registeredAt = fields.registeredAt ?? new Date().toISOString();
  writePrivateControlState(
    {
      runId: state.pocId,
      mediaSessionAccessUrl: fields.mediaSessionAccessUrl,
      mediaSessionAccessSecureUrl: fields.mediaSessionAccessSecureUrl,
      updatedAt: registeredAt,
    },
    options.stateRoot,
  );

  const next: VoximplantServerStopPocState = {
    ...state,
    callSessionHistoryId: providerSessionId,
    providerSessionId,
    providerSessionRegisteredAt: registeredAt,
    providerScenarioBuild: fields.scenarioBuild ?? POC_EXPECTED_SCENARIO_BUILD,
    providerRuleIdentity: fields.routingRuleIdentity ?? null,
    providerConferenceName: conferenceName,
    browserConferenceName: state.browserConferenceName ?? conferenceName,
    singleProviderSessionConfirmed: true,
    mediaSessionAccessUrl: null,
    mediaSessionAccessSecureUrl: null,
    controlUrlFingerprint: fingerprintControlUrl(controlUrl),
    hasControlUrl: true,
    conferenceName,
    updatedAt: registeredAt,
    expiresAt: null,
    runtimeStatus: "ACTIVE",
  };

  return { ok: true, state: next, idempotent: false };
}

export function isProviderSessionRegistered(
  state: VoximplantServerStopPocState,
): boolean {
  const runtime = resolveRuntimeStatus(state);
  return (
    runtime === "ACTIVE" &&
    Boolean(state.providerSessionId) &&
    Boolean(state.hasControlUrl || state.controlUrlFingerprint) &&
    state.singleProviderSessionConfirmed === true
  );
}

/**
 * Correlate provider session IDs observed across phases.
 * PASS requires all non-null IDs to be equal.
 */
export function correlateProviderSessionIds(ids: {
  registeredProviderSessionId: string | null;
  browserProviderSessionId?: string | null;
  recordingProviderSessionId?: string | null;
  stopProviderSessionId?: string | null;
  historyProviderSessionId?: string | null;
}): {
  ok: boolean;
  code: string | null;
  canonicalId: string | null;
} {
  const values = [
    ids.registeredProviderSessionId,
    ids.browserProviderSessionId ?? null,
    ids.recordingProviderSessionId ?? null,
    ids.stopProviderSessionId ?? null,
    ids.historyProviderSessionId ?? null,
  ]
    .map((v) => (typeof v === "string" && v.trim() ? v.trim() : null))
    .filter((v): v is string => Boolean(v));

  if (values.length === 0) {
    return { ok: false, code: "POC_PROVIDER_SESSION_ID_MISSING", canonicalId: null };
  }

  const canonicalId = values[0]!;
  for (const value of values) {
    if (value !== canonicalId) {
      return {
        ok: false,
        code: "POC_PROVIDER_SESSION_ID_MISMATCH",
        canonicalId,
      };
    }
  }

  return { ok: true, code: null, canonicalId };
}
