import "server-only";

import { createHash, randomBytes } from "node:crypto";

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
  apiKey: string;
  accountId: string;
  applicationId: string;
};

const MANAGEMENT_API_BASE_URL = "https://api.voximplant.com/platform_api";
const ONE_TIME_KEY_TTL_SECONDS = 300;

function getManagementConfig(): ManagementConfig {
  const apiKey = process.env.VOXIMPLANT_MANAGEMENT_API_KEY?.trim() ?? "";
  const accountId = process.env.VOXIMPLANT_MANAGEMENT_ACCOUNT_ID?.trim() ?? "";
  const applicationId =
    process.env.VOXIMPLANT_MANAGEMENT_APPLICATION_ID?.trim() ?? "";

  if (!apiKey || !accountId || !applicationId) {
    throw new VoximplantManagementApiNotImplementedError(
      "Missing Voximplant Management API env vars. Required: VOXIMPLANT_MANAGEMENT_API_KEY, VOXIMPLANT_MANAGEMENT_ACCOUNT_ID, VOXIMPLANT_MANAGEMENT_APPLICATION_ID.",
    );
  }

  return {
    apiKey,
    accountId,
    applicationId,
  };
}

function sanitizeResponseValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function callManagementApi(
  method: string,
  params: Record<string, string>,
): Promise<unknown> {
  const cfg = getManagementConfig();

  const search = new URLSearchParams({
    api_key: cfg.apiKey,
    account_id: cfg.accountId,
    ...params,
  });

  const url = `${MANAGEMENT_API_BASE_URL}/${method}/?${search.toString()}`;
  const response = await fetch(url, { method: "GET", cache: "no-store" });
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

async function findRemoteUserId(
  providerUsername: string,
): Promise<string | null> {
  const cfg = getManagementConfig();

  const payload = (await callManagementApi("GetUsers", {
    application_id: cfg.applicationId,
    user_name: providerUsername,
    count: "1",
  })) as Record<string, unknown>;

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
  void params.applicationName;
  const cfg = getManagementConfig();

  const existingId = await findRemoteUserId(params.providerUsername);
  if (existingId) {
    return {
      outcome: "already_exists",
      remoteUserId: existingId,
    };
  }

  const initialPassword = generateStrongPassword();
  try {
    const created = (await callManagementApi("AddUser", {
      application_id: cfg.applicationId,
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
    const recoveredId = await findRemoteUserId(params.providerUsername);
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
  const cfg = getManagementConfig();

  const userId = await findRemoteUserId(params.providerUsername);
  if (!userId) {
    throw new VoximplantManagementApiError(
      "GetUsers",
      "Remote Voximplant user not found for one-time key handoff.",
    );
  }

  const rotatedPassword = generateStrongPassword();
  await callManagementApi("SetUserInfo", {
    user_id: userId,
    application_id: cfg.applicationId,
    user_name: params.providerUsername,
    user_display_name: params.displayName ?? params.providerUsername,
    user_password: rotatedPassword,
  });

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
