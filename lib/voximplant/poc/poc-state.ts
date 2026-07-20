import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { fingerprintControlUrl } from "@/lib/voximplant/poc/url-fingerprint";

export const POC_STATE_RELATIVE_PATH = ".agent/voximplant-server-stop-poc.json";

export type PocCommandResult = {
  action: string;
  ok: boolean;
  operationId: string | null;
  state: string | null;
  errorCode: string | null;
  at: string;
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
  lastCommand: PocCommandResult | null;
  lastStoppedEvent: {
    at: string;
    operationId: string | null;
    recordingId: string | null;
    correlation: string | null;
  } | null;
};

export function getPocStatePath(cwd: string = process.cwd()): string {
  return resolve(cwd, POC_STATE_RELATIVE_PATH);
}

export function readPocState(cwd: string = process.cwd()): VoximplantServerStopPocState | null {
  const path = getPocStatePath(cwd);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as VoximplantServerStopPocState;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePocState(
  state: VoximplantServerStopPocState,
  cwd: string = process.cwd(),
): string {
  const path = getPocStatePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may ignore POSIX mode bits; best-effort only.
  }
  return path;
}

export function clearPocState(cwd: string = process.cwd()): boolean {
  const path = getPocStatePath(cwd);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
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
    lastCommand: null,
    lastStoppedEvent: null,
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
  },
): VoximplantServerStopPocState {
  const controlUrl =
    params.mediaSessionAccessSecureUrl || params.mediaSessionAccessUrl || null;
  return {
    ...state,
    callSessionHistoryId: params.callSessionHistoryId,
    mediaSessionAccessUrl: params.mediaSessionAccessUrl,
    mediaSessionAccessSecureUrl: params.mediaSessionAccessSecureUrl,
    controlUrlFingerprint: controlUrl ? fingerprintControlUrl(controlUrl) : null,
    ruleId: params.ruleId,
    applicationId: params.applicationId,
    updatedAt: new Date().toISOString(),
  };
}

/** Public-safe view: never includes full control URLs. */
export function toPublicPocStateView(state: VoximplantServerStopPocState) {
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
    lastCommand: state.lastCommand,
    lastStoppedEvent: state.lastStoppedEvent,
    hasControlUrl: Boolean(
      state.mediaSessionAccessSecureUrl || state.mediaSessionAccessUrl,
    ),
  };
}

export function getActiveControlUrl(state: VoximplantServerStopPocState): string | null {
  return state.mediaSessionAccessSecureUrl || state.mediaSessionAccessUrl || null;
}
