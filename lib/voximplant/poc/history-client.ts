/**
 * Call history / log retrieval via Management API GetCallHistory.
 * Method name verified from @voximplant/apiclient-nodejs History.getCallHistory
 * and examples/History/getCallHistory_1.js (withRecords / callSessionHistoryId).
 */

import {
  type PocManagementConfig,
  type PocManagementFetch,
  PocManagementApiError,
} from "@/lib/voximplant/poc/management-client";
import { sanitizePocDiagnosticLog } from "@/lib/voximplant/poc/log-sanitize";
import { createSign } from "node:crypto";

const MANAGEMENT_API_BASE_URL = "https://api.voximplant.com/platform_api";

export type GetCallHistoryStatus =
  | "FETCHED"
  | "LOG_FETCH_UNAVAILABLE"
  | "SKIPPED";

export type PocCallHistoryArtifactEvidence = {
  artifactAvailable: boolean;
  artifactReferenceFingerprint: string | null;
  artifactDuration: number | null;
  artifactSize: number | null;
};

export type GetCallHistoryResult = {
  status: GetCallHistoryStatus;
  callSessionHistoryId: string;
  sanitizedPayload: unknown | null;
  sanitizedLogText: string | null;
  artifact: PocCallHistoryArtifactEvidence;
  manualRetrievalId: string;
};

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function createServiceAccountJwt(params: {
  accountId: string;
  keyId: string;
  privateKey: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64UrlJson({
    alg: "RS256",
    typ: "JWT",
    kid: params.keyId,
  });
  const body = encodeBase64UrlJson({
    iss: params.accountId,
    iat: now,
    exp: now + 64,
  });
  const data = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(params.privateKey, "base64url")}`;
}

async function callManagementApi(params: {
  method: string;
  query: Record<string, string>;
  config: PocManagementConfig;
  fetchImpl: PocManagementFetch;
}): Promise<unknown> {
  const search = new URLSearchParams({
    account_id: params.config.accountId,
    ...params.query,
  });
  if (params.config.auth.type === "api_key") {
    search.set("api_key", params.config.auth.apiKey);
  }

  const url = `${MANAGEMENT_API_BASE_URL}/${params.method}/?${search.toString()}`;
  const headers: Record<string, string> = {};
  if (params.config.auth.type === "service_account_jwt") {
    headers.Authorization = `Bearer ${createServiceAccountJwt({
      accountId: params.config.accountId,
      keyId: params.config.auth.keyId,
      privateKey: params.config.auth.privateKey,
    })}`;
  }

  const response = await params.fetchImpl(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new PocManagementApiError(
      params.method,
      `HTTP ${response.status} from Voximplant Management API.`,
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== "object") {
    throw new PocManagementApiError(
      params.method,
      "Management API returned invalid JSON payload.",
    );
  }
  const obj = payload as Record<string, unknown>;
  if (obj.error) {
    throw new PocManagementApiError(
      params.method,
      typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error),
    );
  }
  return payload;
}

function fingerprintArtifactRef(value: string): string {
  // Reuse sanitizer path: capability URLs become fingerprints.
  const sanitized = sanitizePocDiagnosticLog({ ref: value }) as { ref: string };
  return sanitized.ref;
}

function extractArtifactEvidence(payload: unknown): PocCallHistoryArtifactEvidence {
  const empty: PocCallHistoryArtifactEvidence = {
    artifactAvailable: false,
    artifactReferenceFingerprint: null,
    artifactDuration: null,
    artifactSize: null,
  };
  if (!payload || typeof payload !== "object") return empty;

  const root = payload as Record<string, unknown>;
  const result = Array.isArray(root.result) ? root.result : [];
  for (const item of result) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const records = Array.isArray(row.records)
      ? row.records
      : Array.isArray(row.Records)
        ? row.Records
        : [];
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      const rec = record as Record<string, unknown>;
      const urlCandidate =
        (typeof rec.record_url === "string" && rec.record_url) ||
        (typeof rec.recordUrl === "string" && rec.recordUrl) ||
        (typeof rec.cost_url === "string" && rec.cost_url) ||
        null;
      const durationRaw = rec.duration ?? rec.Duration ?? null;
      const sizeRaw = rec.file_size ?? rec.fileSize ?? rec.size ?? null;
      const duration =
        typeof durationRaw === "number"
          ? durationRaw
          : typeof durationRaw === "string" && durationRaw.trim()
            ? Number(durationRaw)
            : null;
      const size =
        typeof sizeRaw === "number"
          ? sizeRaw
          : typeof sizeRaw === "string" && sizeRaw.trim()
            ? Number(sizeRaw)
            : null;
      if (urlCandidate || Number.isFinite(duration as number) || Number.isFinite(size as number)) {
        return {
          artifactAvailable: true,
          artifactReferenceFingerprint: urlCandidate
            ? fingerprintArtifactRef(urlCandidate)
            : `record-${String(rec.record_id ?? rec.recordId ?? "unknown")}`,
          artifactDuration: Number.isFinite(duration as number) ? (duration as number) : null,
          artifactSize: Number.isFinite(size as number) ? (size as number) : null,
        };
      }
    }
  }
  return empty;
}

/**
 * Retrieve call history (and recording metadata when with_records=true)
 * for a completed POC media session.
 */
export async function getCallHistoryForPoc(params: {
  config: PocManagementConfig;
  callSessionHistoryId: string;
  fromDateIso: string;
  toDateIso: string;
  fetchImpl?: PocManagementFetch;
  skip?: boolean;
  dryRun?: boolean;
}): Promise<GetCallHistoryResult> {
  const manualRetrievalId = params.callSessionHistoryId;

  if (params.skip || params.dryRun) {
    return {
      status: "SKIPPED",
      callSessionHistoryId: params.callSessionHistoryId,
      sanitizedPayload: null,
      sanitizedLogText: null,
      artifact: {
        artifactAvailable: false,
        artifactReferenceFingerprint: null,
        artifactDuration: null,
        artifactSize: null,
      },
      manualRetrievalId,
    };
  }

  try {
    // Platform API snake_case equivalents of History.getCallHistory request.
    const payload = await callManagementApi({
      method: "GetCallHistory",
      query: {
        call_session_history_id: params.callSessionHistoryId,
        from_date: params.fromDateIso,
        to_date: params.toDateIso,
        with_calls: "true",
        with_records: "true",
        timezone: "Etc/GMT",
        count: "1",
      },
      config: params.config,
      fetchImpl: params.fetchImpl ?? fetch,
    });

    const sanitizedPayload = sanitizePocDiagnosticLog(payload);
    const artifact = extractArtifactEvidence(payload);
    const sanitizedLogText = `${JSON.stringify(sanitizedPayload, null, 2)}\n`;

    return {
      status: "FETCHED",
      callSessionHistoryId: params.callSessionHistoryId,
      sanitizedPayload,
      sanitizedLogText,
      artifact,
      manualRetrievalId,
    };
  } catch {
    return {
      status: "LOG_FETCH_UNAVAILABLE",
      callSessionHistoryId: params.callSessionHistoryId,
      sanitizedPayload: null,
      sanitizedLogText: null,
      artifact: {
        artifactAvailable: false,
        artifactReferenceFingerprint: null,
        artifactDuration: null,
        artifactSize: null,
      },
      manualRetrievalId,
    };
  }
}
