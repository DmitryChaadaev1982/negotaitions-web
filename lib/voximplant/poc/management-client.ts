import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  assertExplicitPocRuleIdForLive,
  assertLivePocConfirmation,
  assertPocConferenceName,
  assertPocRuleNotProduction,
  readProductionRuleDenyList,
  resolveDedicatedPocRule,
  type ResolvedPocRule,
} from "@/lib/voximplant/poc/poc-safety";
import { fingerprintControlUrl, redactControlUrlFields } from "@/lib/voximplant/poc/url-fingerprint";

const MANAGEMENT_API_BASE_URL = "https://api.voximplant.com/platform_api";

export type PocManagementAuth =
  | { type: "api_key"; apiKey: string }
  | { type: "service_account_jwt"; keyId: string; privateKey: string };

export type PocManagementConfig = {
  accountId: string;
  applicationId: string | null;
  applicationName: string | null;
  /** Dedicated POC rule id from VOXIMPLANT_SERVER_STOP_POC_RULE_ID only. */
  ruleId: string | null;
  /** Optional dedicated POC rule name from VOXIMPLANT_SERVER_STOP_POC_RULE_NAME. */
  ruleName: string | null;
  auth: PocManagementAuth;
};

export type StartConferenceRequestParams = {
  conferenceName: string;
  ruleId: string;
  applicationId?: string | null;
  applicationName?: string | null;
  scriptCustomData?: string | null;
};

/**
 * Verified against @voximplant/apiclient-nodejs StartConferenceRequest/Response
 * (HTTP platform_api uses snake_case equivalents).
 */
export type StartConferenceHttpParams = {
  conference_name: string;
  rule_id: string;
  application_id?: string;
  application_name?: string;
  script_custom_data?: string;
};

export type StartConferenceParsedResponse = {
  result: number | null;
  mediaSessionAccessUrl: string | null;
  mediaSessionAccessSecureUrl: string | null;
  callSessionHistoryId: string | null;
  rawKeys: string[];
};

export type PocManagementFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export class PocManagementApiError extends Error {
  readonly code = "POC_VOX_MANAGEMENT_API_ERROR";
  readonly method: string;

  constructor(method: string, message: string) {
    super(message);
    this.name = "PocManagementApiError";
    this.method = method;
  }
}

function pickFirstNonEmptyString(
  source: Record<string, unknown>,
  aliases: readonly string[],
): string {
  for (const key of aliases) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

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

function loadCredentialsFile(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PocManagementApiError(
      "config",
      "Credentials JSON must be an object.",
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve POC Management API config from env.
 * Rule identity comes only from dedicated POC vars — never production rule fallbacks.
 */
export function resolvePocManagementConfig(
  env: NodeJS.ProcessEnv = process.env,
): PocManagementConfig {
  const envApiKey = env.VOXIMPLANT_MANAGEMENT_API_KEY?.trim() ?? "";
  const envAccountId = env.VOXIMPLANT_MANAGEMENT_ACCOUNT_ID?.trim() ?? "";
  const envApplicationId = env.VOXIMPLANT_MANAGEMENT_APPLICATION_ID?.trim() ?? "";
  const apiKeyPath =
    env.VOXIMPLANT_API_KEY_PATH?.trim() || env.VOX_CI_CREDENTIALS?.trim() || "";

  let file: Record<string, unknown> = {};
  if (apiKeyPath && existsSync(apiKeyPath)) {
    file = loadCredentialsFile(apiKeyPath);
  }

  const accountId =
    envAccountId ||
    pickFirstNonEmptyString(file, ["account_id", "accountId", "accountID"]);
  const applicationId =
    envApplicationId ||
    pickFirstNonEmptyString(file, [
      "application_id",
      "applicationId",
      "applicationID",
    ]) ||
    null;
  const applicationName = env.VOXIMPLANT_APPLICATION_NAME?.trim() || null;
  const pocRule = resolveDedicatedPocRule(env);

  const fileApiKey = pickFirstNonEmptyString(file, [
    "api_key",
    "apiKey",
    "key",
    "token",
  ]);
  const keyId = pickFirstNonEmptyString(file, ["key_id", "keyId", "keyID"]);
  const privateKey = pickFirstNonEmptyString(file, ["private_key", "privateKey"]);

  const auth: PocManagementAuth | null = envApiKey
    ? { type: "api_key", apiKey: envApiKey }
    : fileApiKey
      ? { type: "api_key", apiKey: fileApiKey }
      : keyId && privateKey
        ? { type: "service_account_jwt", keyId, privateKey }
        : null;

  if (!accountId || !auth) {
    throw new PocManagementApiError(
      "config",
      "Missing Management API config. Set VOXIMPLANT_MANAGEMENT_API_KEY + VOXIMPLANT_MANAGEMENT_ACCOUNT_ID, or VOXIMPLANT_API_KEY_PATH / VOX_CI_CREDENTIALS with service-account JSON.",
    );
  }

  return {
    accountId,
    applicationId,
    applicationName,
    ruleId: pocRule.ruleId,
    ruleName: pocRule.ruleName,
    auth,
  };
}

/** Sanitize config for console output — never includes secrets. */
export function sanitizePocManagementConfig(config: PocManagementConfig) {
  return {
    accountId: config.accountId ? "configured" : "missing",
    applicationId: config.applicationId ? "configured" : "missing",
    applicationName: config.applicationName ?? null,
    pocRuleId: config.ruleId ?? null,
    pocRuleName: config.ruleName ?? null,
    authType: config.auth.type,
    // Explicitly surface that production rule env is not used for StartConference.
    usesProductionRuleFallback: false,
  };
}

export function buildStartConferenceHttpParams(
  params: StartConferenceRequestParams,
): StartConferenceHttpParams {
  const out: StartConferenceHttpParams = {
    conference_name: params.conferenceName,
    rule_id: params.ruleId,
  };
  if (params.applicationId) out.application_id = params.applicationId;
  if (params.applicationName) out.application_name = params.applicationName;
  if (params.scriptCustomData) out.script_custom_data = params.scriptCustomData;
  return out;
}

export function parseStartConferenceResponse(
  payload: unknown,
): StartConferenceParsedResponse {
  if (!payload || typeof payload !== "object") {
    throw new PocManagementApiError(
      "StartConference",
      "Invalid JSON payload from StartConference.",
    );
  }
  const obj = payload as Record<string, unknown>;
  if (obj.error) {
    throw new PocManagementApiError(
      "StartConference",
      typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error),
    );
  }

  const mediaSessionAccessUrl =
    pickFirstNonEmptyString(obj, [
      "media_session_access_url",
      "mediaSessionAccessUrl",
    ]) || null;
  const mediaSessionAccessSecureUrl =
    pickFirstNonEmptyString(obj, [
      "media_session_access_secure_url",
      "mediaSessionAccessSecureUrl",
    ]) || null;
  const callSessionHistoryId =
    pickFirstNonEmptyString(obj, [
      "call_session_history_id",
      "callSessionHistoryId",
    ]) || null;

  const resultRaw = obj.result;
  const result =
    typeof resultRaw === "number"
      ? resultRaw
      : typeof resultRaw === "string" && resultRaw.trim()
        ? Number(resultRaw)
        : null;

  return {
    result: Number.isFinite(result as number) ? (result as number) : null,
    mediaSessionAccessUrl,
    mediaSessionAccessSecureUrl,
    callSessionHistoryId,
    rawKeys: Object.keys(obj),
  };
}

export function buildStartConferencePublicResult(
  parsed: StartConferenceParsedResponse,
  conferenceName: string,
) {
  const controlUrl =
    parsed.mediaSessionAccessSecureUrl || parsed.mediaSessionAccessUrl;
  return {
    conferenceName,
    mediaSessionId: parsed.callSessionHistoryId,
    controlUrlFingerprint: controlUrl ? fingerprintControlUrl(controlUrl) : null,
    classification: controlUrl ? "success" : "error_missing_control_url",
    result: parsed.result,
  };
}

async function callManagementApi(params: {
  method: string;
  query: Record<string, string>;
  config: PocManagementConfig;
  fetchImpl: PocManagementFetch;
  dryRun?: boolean;
}): Promise<unknown> {
  const search = new URLSearchParams({
    account_id: params.config.accountId,
    ...params.query,
  });
  if (params.config.auth.type === "api_key") {
    search.set("api_key", params.config.auth.apiKey);
  }

  const url = `${MANAGEMENT_API_BASE_URL}/${params.method}/?${search.toString()}`;
  if (params.dryRun) {
    return {
      dryRun: true,
      method: params.method,
      // Redacted: never include api_key or full URL with secrets.
      queryKeys: Object.keys(params.query).sort(),
      authType: params.config.auth.type,
    };
  }

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
      typeof obj.error === "string" ? obj.error : JSON.stringify(redactControlUrlFields(obj.error)),
    );
  }
  return payload;
}

/**
 * Resolve the rule id used for StartConference.
 * Explicit POC rule id only — no GetRules / production name discovery.
 */
export function resolvePocRuleIdForStart(params: {
  config: PocManagementConfig;
  dryRun?: boolean;
}): { ruleId: string; missingPocRule: boolean; pocRule: ResolvedPocRule } {
  const pocRule: ResolvedPocRule = {
    ruleId: params.config.ruleId,
    ruleName: params.config.ruleName,
    fromDedicatedPocEnv: Boolean(params.config.ruleId || params.config.ruleName),
  };

  if (params.dryRun && !pocRule.ruleId) {
    return {
      ruleId: "<missing-poc-rule-id>",
      missingPocRule: true,
      pocRule,
    };
  }

  assertExplicitPocRuleIdForLive(pocRule);
  return {
    ruleId: pocRule.ruleId as string,
    missingPocRule: false,
    pocRule,
  };
}

/**
 * Run all StartConference safety gates that must precede any provider request.
 * Confirmation is required for live calls only; dry-run never confirms live.
 */
export function assertStartConferenceSafety(params: {
  config: PocManagementConfig;
  conferenceName: string;
  dryRun?: boolean;
  confirmLivePoc?: boolean;
  env?: NodeJS.ProcessEnv;
}): {
  pocRule: ResolvedPocRule;
  missingPocRule: boolean;
  ruleId: string;
} {
  assertPocConferenceName(params.conferenceName);

  if (!params.dryRun) {
    assertLivePocConfirmation(Boolean(params.confirmLivePoc));
  }

  const { ruleId, missingPocRule, pocRule } = resolvePocRuleIdForStart({
    config: params.config,
    dryRun: params.dryRun,
  });

  // Deny-list when a POC rule identity is present (live always; dry-run when set).
  if (pocRule.ruleId || pocRule.ruleName) {
    assertPocRuleNotProduction({
      pocRule,
      production: readProductionRuleDenyList(params.env ?? process.env),
    });
  }

  return { pocRule, missingPocRule, ruleId };
}

export async function startConference(params: {
  config: PocManagementConfig;
  conferenceName: string;
  scriptCustomData?: string | null;
  fetchImpl?: PocManagementFetch;
  dryRun?: boolean;
  /** Required for every real StartConference call. Does not bypass other gates. */
  confirmLivePoc?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  dryRun: boolean;
  request: StartConferenceHttpParams;
  parsed: StartConferenceParsedResponse | null;
  publicResult: ReturnType<typeof buildStartConferencePublicResult> | null;
  missingPocRule: boolean;
}> {
  const { ruleId, missingPocRule } = assertStartConferenceSafety({
    config: params.config,
    conferenceName: params.conferenceName,
    dryRun: params.dryRun,
    confirmLivePoc: params.confirmLivePoc,
    env: params.env,
  });

  const request = buildStartConferenceHttpParams({
    conferenceName: params.conferenceName,
    ruleId,
    applicationId: params.config.applicationId,
    applicationName: params.config.applicationName,
    scriptCustomData: params.scriptCustomData,
  });

  if (params.dryRun) {
    return {
      dryRun: true,
      request,
      parsed: null,
      publicResult: buildStartConferencePublicResult(
        {
          result: 1,
          mediaSessionAccessUrl: null,
          mediaSessionAccessSecureUrl: null,
          callSessionHistoryId: null,
          rawKeys: [],
        },
        params.conferenceName,
      ),
      missingPocRule,
    };
  }

  const query: Record<string, string> = {
    conference_name: request.conference_name,
    rule_id: request.rule_id,
  };
  if (request.application_id) query.application_id = request.application_id;
  if (request.application_name) query.application_name = request.application_name;
  if (request.script_custom_data) {
    query.script_custom_data = request.script_custom_data;
  }

  const payload = await callManagementApi({
    method: "StartConference",
    query,
    config: params.config,
    fetchImpl: params.fetchImpl ?? fetch,
  });

  const parsed = parseStartConferenceResponse(payload);
  return {
    dryRun: false,
    request,
    parsed,
    publicResult: buildStartConferencePublicResult(parsed, params.conferenceName),
    missingPocRule: false,
  };
}
