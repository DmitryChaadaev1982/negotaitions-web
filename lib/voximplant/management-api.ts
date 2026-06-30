import "server-only";

import { createHash, createSign, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type EnsureRemoteVoximplantUserParams = {
  applicationName: string;
  providerUsername: string;
  displayName: string | null;
};

export type EnsureRemoteVoximplantUserResult = {
  outcome: "created" | "already_exists";
  remoteUserId: string | null;
};

export type VoximplantOneTimeLoginHashParams = {
  sdkUsername: string;
  providerUsername: string;
  displayName: string | null;
  oneTimeKey: string;
};

export type VoximplantOneTimeLoginHashResult = {
  hash: string;
  expiresAt: string;
};

export class VoximplantManagementApiNotImplementedError extends Error {
  readonly code = "VOXIMPLANT_MANAGEMENT_API_NOT_IMPLEMENTED";

  constructor(message?: string) {
    super(
      message ??
        "Voximplant Management API adapter is not implemented in this environment.",
    );
    this.name = "VoximplantManagementApiNotImplementedError";
  }
}

export class VoximplantManagementApiError extends Error {
  readonly code = "VOXIMPLANT_MANAGEMENT_API_ERROR";
  readonly method: string;

  constructor(method: string, message: string) {
    super(message);
    this.name = "VoximplantManagementApiError";
    this.method = method;
  }
}

type ManagementConfig = {
  accountId: string;
  applicationId: string | null;
  auth:
    | {
        type: "api_key";
        apiKey: string;
      }
    | {
        type: "service_account_jwt";
        keyId: string;
        privateKey: string;
      };
};

const MANAGEMENT_API_BASE_URL = "https://api.voximplant.com/platform_api";
const ONE_TIME_KEY_TTL_SECONDS = 300;

const API_KEY_ALIASES = ["api_key", "apiKey", "key", "token"] as const;
const ACCOUNT_ID_ALIASES = ["account_id", "accountId", "accountID"] as const;
const APPLICATION_ID_ALIASES = [
  "application_id",
  "applicationId",
  "applicationID",
] as const;
const KEY_ID_ALIASES = ["key_id", "keyId", "keyID"] as const;
const PRIVATE_KEY_ALIASES = ["private_key", "privateKey"] as const;

function pickFirstNonEmptyString(
  source: Record<string, unknown>,
  aliases: readonly string[],
): string {
  for (const key of aliases) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function getConfigFromApiKeyPath(apiKeyPath: string): Partial<ManagementConfig> {
  const readCredentialsJson = (): string => {
    try {
      return readFileSync(apiKeyPath, "utf8");
    } catch (error) {
      const isMissingFile =
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT";
      if (!isMissingFile) {
        throw error;
      }

      // Defensive local-dev fallback: when the configured file path is stale,
      // try a single service-account JSON in the same directory.
      const credentialsDir = dirname(apiKeyPath);
      const entries = readdirSync(credentialsDir, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
        .map((entry) => entry.name);

      const privateJsonCandidates = entries.filter((name) =>
        name.toLowerCase().endsWith("_private.json"),
      );
      const selectedCandidate =
        privateJsonCandidates.length === 1
          ? privateJsonCandidates[0]
          : entries.length === 1
            ? entries[0]
            : null;

      if (!selectedCandidate) {
        throw error;
      }

      return readFileSync(`${credentialsDir}\\${selectedCandidate}`, "utf8");
    }
  };

  let parsed: unknown;
  try {
    const raw = readCredentialsJson();
    parsed = JSON.parse(raw);
  } catch {
    throw new VoximplantManagementApiNotImplementedError(
      "Voximplant Management API config is incomplete. VOXIMPLANT_API_KEY_PATH is set but credentials file is unreadable or invalid JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VoximplantManagementApiNotImplementedError(
      "Voximplant Management API config is incomplete. Credentials JSON at VOXIMPLANT_API_KEY_PATH must be an object.",
    );
  }

  const payload = parsed as Record<string, unknown>;

  const apiKey = pickFirstNonEmptyString(payload, API_KEY_ALIASES);
  const keyId = pickFirstNonEmptyString(payload, KEY_ID_ALIASES);
  const privateKey = pickFirstNonEmptyString(payload, PRIVATE_KEY_ALIASES);

  return {
    accountId: pickFirstNonEmptyString(payload, ACCOUNT_ID_ALIASES),
    applicationId:
      pickFirstNonEmptyString(payload, APPLICATION_ID_ALIASES) || undefined,
    auth: apiKey
      ? {
          type: "api_key",
          apiKey,
        }
      : keyId && privateKey
        ? {
            type: "service_account_jwt",
            keyId,
            privateKey,
          }
        : undefined,
  };
}

function getManagementConfig(): ManagementConfig {
  const envApiKey = process.env.VOXIMPLANT_MANAGEMENT_API_KEY?.trim() ?? "";
  const envAccountId = process.env.VOXIMPLANT_MANAGEMENT_ACCOUNT_ID?.trim() ?? "";
  const envApplicationId =
    process.env.VOXIMPLANT_MANAGEMENT_APPLICATION_ID?.trim() ?? "";
  const apiKeyPath = process.env.VOXIMPLANT_API_KEY_PATH?.trim() ?? "";

  if (envApiKey && envAccountId && envApplicationId) {
    return {
      accountId: envAccountId,
      applicationId: envApplicationId,
      auth: {
        type: "api_key",
        apiKey: envApiKey,
      },
    };
  }

  const fileConfig =
    apiKeyPath && (!envApiKey || !envAccountId || !envApplicationId)
      ? getConfigFromApiKeyPath(apiKeyPath)
      : {};

  const auth =
    envApiKey
      ? ({
          type: "api_key",
          apiKey: envApiKey,
        } as const)
      : fileConfig.auth;
  const accountId = envAccountId || fileConfig.accountId || "";
  const applicationId = envApplicationId || fileConfig.applicationId || null;

  if (!auth || !accountId) {
    throw new VoximplantManagementApiNotImplementedError(
      "Missing Voximplant Management API config. Provide VOXIMPLANT_MANAGEMENT_API_KEY and VOXIMPLANT_MANAGEMENT_ACCOUNT_ID, or set VOXIMPLANT_API_KEY_PATH with supported aliases (api_key/apiKey/key/token, account_id/accountId/accountID). Service-account JSON (account_id + key_id + private_key) is also supported.",
    );
  }

  return {
    auth,
    accountId,
    applicationId,
  };
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
  const signature = signer.sign(params.privateKey, "base64url");
  return `${data}.${signature}`;
}

function sanitizeResponseValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function getApplicationIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const result = obj.result;
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }
  const first = result[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const app = first as Record<string, unknown>;
  const applicationId =
    app.application_id ?? app.applicationId ?? app.applicationID ?? null;
  return applicationId === null || applicationId === undefined
    ? null
    : String(applicationId);
}

async function callManagementApi(
  method: string,
  params: Record<string, string>,
): Promise<unknown> {
  const cfg = getManagementConfig();

  const search = new URLSearchParams({
    account_id: cfg.accountId,
    ...params,
  });
  if (cfg.auth.type === "api_key") {
    search.set("api_key", cfg.auth.apiKey);
  }

  const url = `${MANAGEMENT_API_BASE_URL}/${method}/?${search.toString()}`;
  const headers: Record<string, string> = {};
  if (cfg.auth.type === "service_account_jwt") {
    const token = createServiceAccountJwt({
      accountId: cfg.accountId,
      keyId: cfg.auth.keyId,
      privateKey: cfg.auth.privateKey,
    });
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    throw new VoximplantManagementApiError(
      method,
      `HTTP ${response.status} from Voximplant Management API.`,
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload || typeof payload !== "object") {
    throw new VoximplantManagementApiError(
      method,
      "Management API returned invalid JSON payload.",
    );
  }

  if ("error" in payload && payload.error) {
    throw new VoximplantManagementApiError(
      method,
      sanitizeResponseValue(payload.error),
    );
  }

  return payload;
}

async function resolveApplicationId(
  preferredApplicationName?: string | null,
): Promise<string> {
  const cfg = getManagementConfig();
  if (cfg.applicationId) {
    return cfg.applicationId;
  }

  const applicationName =
    preferredApplicationName?.trim() ||
    process.env.VOXIMPLANT_APPLICATION_NAME?.trim() ||
    "";
  if (!applicationName) {
    throw new VoximplantManagementApiNotImplementedError(
      "Missing Voximplant application identifier. Set VOXIMPLANT_MANAGEMENT_APPLICATION_ID or VOXIMPLANT_APPLICATION_NAME.",
    );
  }

  const payload = await callManagementApi("GetApplications", {
    application_name: applicationName,
    count: "1",
  });
  const applicationId = getApplicationIdFromPayload(payload);
  if (!applicationId) {
    throw new VoximplantManagementApiNotImplementedError(
      "Unable to resolve Voximplant application id from configured application name.",
    );
  }
  return applicationId;
}

async function findRemoteUserId(
  providerUsername: string,
  applicationId?: string,
): Promise<string | null> {
  const params: Record<string, string> = {
    user_name: providerUsername,
    count: "1",
  };
  if (applicationId) {
    params.application_id = applicationId;
  }
  const payload = (await callManagementApi("GetUsers", params)) as Record<string, unknown>;

  const result = payload.result;
  if (Array.isArray(result) && result.length > 0) {
    const user = result[0] as Record<string, unknown>;
    const userId = user.user_id ?? user.userId ?? null;
    return userId ? String(userId) : null;
  }
  return null;
}

function generateStrongPassword(length = 24): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+?";
  const all = `${uppercase}${lowercase}${digits}${symbols}`;

  const requiredChars = [
    uppercase[randomBytes(1)[0] % uppercase.length],
    lowercase[randomBytes(1)[0] % lowercase.length],
    digits[randomBytes(1)[0] % digits.length],
    symbols[randomBytes(1)[0] % symbols.length],
  ];

  const remainingLength = Math.max(8, length) - requiredChars.length;
  const randomPart = Array.from(randomBytes(remainingLength)).map(
    (byte) => all[byte % all.length],
  );

  const combined = [...requiredChars, ...randomPart];
  for (let i = combined.length - 1; i > 0; i -= 1) {
    const j = randomBytes(1)[0] % (i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}

function buildOneTimeKeyHash(
  hashUsername: string,
  oneTimeKey: string,
  password: string,
): string {
  const first = createHash("md5")
    .update(`${hashUsername}:voximplant.com:${password}`)
    .digest("hex");
  return createHash("md5").update(`${oneTimeKey}|${first}`).digest("hex");
}

function extractUserIdFromAddUserResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (obj.user_id !== undefined && obj.user_id !== null) {
    return String(obj.user_id);
  }

  const result = obj.result;
  if (result && typeof result === "object") {
    const resultObj = result as Record<string, unknown>;
    if (resultObj.user_id !== undefined && resultObj.user_id !== null) {
      return String(resultObj.user_id);
    }
    if (resultObj.userId !== undefined && resultObj.userId !== null) {
      return String(resultObj.userId);
    }
  }

  return null;
}

/**
 * Stage 4 adapter boundary.
 *
 * IMPORTANT:
 * - Do not invent Voximplant API endpoints/methods.
 * - Wire official Management API calls in a follow-up step once exact auth/token
 *   flow is approved for this project environment.
 */
export async function ensureRemoteVoximplantUser(
  params: EnsureRemoteVoximplantUserParams,
): Promise<EnsureRemoteVoximplantUserResult> {
  const applicationId = await resolveApplicationId(params.applicationName);

  const existingId = await findRemoteUserId(params.providerUsername, applicationId);
  if (existingId) {
    return {
      outcome: "already_exists",
      remoteUserId: existingId,
    };
  }

  const initialPassword = generateStrongPassword();
  try {
    const created = (await callManagementApi("AddUser", {
      application_id: applicationId,
      user_name: params.providerUsername,
      user_display_name: params.displayName ?? params.providerUsername,
      user_password: initialPassword,
    })) as Record<string, unknown>;

    const createdId = extractUserIdFromAddUserResponse(created);
    return {
      outcome: "created",
      remoteUserId: createdId,
    };
  } catch {
    // If user already exists remotely due to concurrent create, recover gracefully.
    const recoveredId = await findRemoteUserId(params.providerUsername, applicationId);
    if (recoveredId) {
      return {
        outcome: "already_exists",
        remoteUserId: recoveredId,
      };
    }
    throw new VoximplantManagementApiError(
      "AddUser",
      "Failed to create or recover remote Voximplant user.",
    );
  }
}

export async function createVoximplantOneTimeLoginHash(
  params: VoximplantOneTimeLoginHashParams,
): Promise<VoximplantOneTimeLoginHashResult> {
  const applicationId = await resolveApplicationId();

  const userId = await findRemoteUserId(params.providerUsername, applicationId);
  if (!userId) {
    throw new VoximplantManagementApiError(
      "GetUsers",
      "Remote Voximplant user not found for one-time key handoff.",
    );
  }

  const rotatedPassword = generateStrongPassword();
  const setUserInfoParams: Record<string, string> = {
    user_id: userId,
    user_name: params.providerUsername,
    user_display_name: params.displayName ?? params.providerUsername,
    user_password: rotatedPassword,
  };
  if (applicationId) {
    setUserInfoParams.application_id = applicationId;
  }
  await callManagementApi("SetUserInfo", setUserInfoParams);

  const sdkUsername = params.sdkUsername.trim().toLowerCase();
  const expectedPrefix = `${params.providerUsername.toLowerCase()}@`;
  if (!sdkUsername.startsWith(expectedPrefix)) {
    throw new VoximplantManagementApiError(
      "OneTimeKeyHash",
      "SDK username does not match provisioned provider username.",
    );
  }

  // Per WebSDK typing/docs, one-time hash uses local username part.
  const hash = buildOneTimeKeyHash(params.providerUsername, params.oneTimeKey, rotatedPassword);
  const expiresAt = new Date(
    Date.now() + ONE_TIME_KEY_TTL_SECONDS * 1000,
  ).toISOString();

  return {
    hash,
    expiresAt,
  };
}
