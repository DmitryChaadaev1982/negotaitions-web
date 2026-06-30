/**
 * Stage 5.4.10 — Direct Voximplant scenario upload fallback via Management API SetScenarioInfo.
 *
 * Purpose:
 * - bypass VoxEngine CI TypeScript build step when it fails (e.g. TS5042);
 * - upload stamped JS scenario body directly to existing Voximplant scenario.
 *
 * Usage:
 *   node scripts/voximplant-upload-scenario-direct.mjs
 *
 * Required env:
 *   VOX_CI_CREDENTIALS        absolute path to service account/API key JSON
 *   VOXIMPLANT_SCENARIO_NAME  e.g. neg-conf-main-room
 *
 * Optional env:
 *   VOXIMPLANT_SCENARIO_ID               explicit scenario id (preferred when duplicated names exist)
 *   VOXIMPLANT_DIRECT_UPLOAD_ENABLED     default true; set false to hard-disable direct uploads
 *   VOXIMPLANT_DIRECT_UPLOAD_FORCE       when true, bypasses the ENABLED guard
 *
 * Security:
 * - never prints credentials path, JWT, private key, webhook secrets, or full request body.
 */

import { createHash, createSign } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

const MANAGEMENT_API_BASE_URL = "https://api.voximplant.com/platform_api";
const SOURCE_FILE = join(
  PROJECT_ROOT,
  "docs",
  "voximplant",
  "neg-conf.main-room.scenario.js",
);
const SCRIPT_WARN_BYTES = 120 * 1024; // proactive warning/fail threshold
const SCRIPT_LIMIT_BYTES = 128 * 1024; // documented hard limit

function loadEnvLocal() {
  const envPath = join(PROJECT_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith("\"") && val.endsWith("\"")) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function getEnvBoolean(key, defaultValue = false) {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

function pickFirstNonEmptyString(source, aliases) {
  for (const key of aliases) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function parseCredentials(credentialsPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(credentialsPath, "utf8"));
  } catch {
    throw new Error(
      "VOX_CI_CREDENTIALS is unreadable or not valid JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("VOX_CI_CREDENTIALS must be a JSON object.");
  }

  const payload = parsed;
  const accountId = pickFirstNonEmptyString(payload, [
    "account_id",
    "accountId",
    "accountID",
  ]);
  const applicationId = pickFirstNonEmptyString(payload, [
    "application_id",
    "applicationId",
    "applicationID",
  ]);
  const apiKey = pickFirstNonEmptyString(payload, [
    "api_key",
    "apiKey",
    "key",
    "token",
  ]);
  const keyId = pickFirstNonEmptyString(payload, ["key_id", "keyId", "keyID"]);
  const privateKey = pickFirstNonEmptyString(payload, [
    "private_key",
    "privateKey",
  ]);

  if (!accountId) {
    throw new Error("Credentials JSON must include account_id.");
  }

  if (apiKey) {
    return {
      accountId,
      applicationId: applicationId || null,
      auth: { type: "api_key", apiKey },
    };
  }

  if (keyId && privateKey) {
    return {
      accountId,
      applicationId: applicationId || null,
      auth: { type: "service_account_jwt", keyId, privateKey },
    };
  }

  throw new Error(
    "Credentials JSON must contain either api_key or (key_id + private_key).",
  );
}

function encodeBase64UrlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function createServiceAccountJwt({ accountId, keyId, privateKey }) {
  // Mirrors existing logic from lib/voximplant/management-api.ts.
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64UrlJson({
    alg: "RS256",
    typ: "JWT",
    kid: keyId,
  });
  const body = encodeBase64UrlJson({
    iss: accountId,
    iat: now,
    exp: now + 64,
  });
  const data = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  return `${data}.${signature}`;
}

async function callManagementApi(method, params, creds) {
  const form = new URLSearchParams();
  form.set("account_id", creds.accountId);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      form.set(k, String(v));
    }
  }
  if (creds.auth.type === "api_key") {
    form.set("api_key", creds.auth.apiKey);
  }

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (creds.auth.type === "service_account_jwt") {
    headers.Authorization = `Bearer ${createServiceAccountJwt({
      accountId: creds.accountId,
      keyId: creds.auth.keyId,
      privateKey: creds.auth.privateKey,
    })}`;
  }

  const response = await fetch(`${MANAGEMENT_API_BASE_URL}/${method}`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: form.toString(),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from Voximplant Management API (${method}).`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new Error(`Invalid JSON response from Voximplant Management API (${method}).`);
  }
  if ("error" in payload && payload.error) {
    throw new Error(`Voximplant Management API ${method} error: ${String(payload.error)}`);
  }
  return payload;
}

function getGitShortSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function buildBuildId() {
  const sha = getGitShortSha();
  const now = new Date();
  const yyyymmdd =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const hhmmss =
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const stamp = `${yyyymmdd}-${hhmmss}`;
  return sha ? `dev-${stamp}-g${sha}` : `dev-${stamp}`;
}

function stampScenarioSource(sourceText, buildId) {
  // First, replace explicit placeholder if present.
  let stamped = sourceText.replaceAll("__LOCAL_DEV_BUILD__", buildId);

  // Then enforce SCENARIO_BUILD_ID assignment, regardless of old value.
  const before = stamped;
  stamped = stamped.replace(
    /var\s+SCENARIO_BUILD_ID\s*=\s*["'][^"']*["'];/,
    `var SCENARIO_BUILD_ID = "${buildId}";`,
  );

  if (before === stamped && !sourceText.includes("__LOCAL_DEV_BUILD__")) {
    throw new Error(
      'SCENARIO_BUILD_ID marker not found. Expected either "__LOCAL_DEV_BUILD__" or var SCENARIO_BUILD_ID = "...";',
    );
  }

  return stamped;
}

function extractScenarioMatches(payload) {
  if (!payload || typeof payload !== "object") return [];
  const result = payload.result;
  if (!Array.isArray(result)) return [];
  return result
    .filter((x) => x && typeof x === "object")
    .map((x) => x);
}

async function main() {
  loadEnvLocal();

  const scenarioName = (process.env.VOXIMPLANT_SCENARIO_NAME || "").trim();
  const scenarioId = (process.env.VOXIMPLANT_SCENARIO_ID || "").trim();
  const credentialsPath = (process.env.VOX_CI_CREDENTIALS || "").trim();
  const directEnabled = getEnvBoolean("VOXIMPLANT_DIRECT_UPLOAD_ENABLED", true);
  const directForce = getEnvBoolean("VOXIMPLANT_DIRECT_UPLOAD_FORCE", false);

  if (!directEnabled && !directForce) {
    throw new Error(
      "Direct upload is disabled (VOXIMPLANT_DIRECT_UPLOAD_ENABLED=false). Set VOXIMPLANT_DIRECT_UPLOAD_FORCE=true to override.",
    );
  }

  if (!scenarioName && !scenarioId) {
    throw new Error(
      "Set VOXIMPLANT_SCENARIO_NAME or VOXIMPLANT_SCENARIO_ID.",
    );
  }

  if (!credentialsPath) {
    throw new Error("VOX_CI_CREDENTIALS is not set.");
  }
  if (!existsSync(credentialsPath)) {
    throw new Error("VOX_CI_CREDENTIALS file does not exist.");
  }
  if (!existsSync(SOURCE_FILE)) {
    throw new Error(`Source scenario file not found: ${SOURCE_FILE}`);
  }

  const creds = parseCredentials(credentialsPath);
  const buildId = buildBuildId();
  const sourceText = readFileSync(SOURCE_FILE, "utf8");
  const stampedScenario = stampScenarioSource(sourceText, buildId);
  const scriptSizeBytes = Buffer.byteLength(stampedScenario, "utf8");
  const scriptSha256 = createHash("sha256")
    .update(stampedScenario, "utf8")
    .digest("hex");

  console.log("[vox-direct] ─── Direct Scenario Upload (SetScenarioInfo) ─────────────");
  console.log("[vox-direct] scenarioName         :", scenarioName || "(resolved by id)");
  console.log("[vox-direct] scenarioId (env)     :", scenarioId || "(not provided)");
  console.log("[vox-direct] sourceFile           :", SOURCE_FILE);
  console.log("[vox-direct] credentials          : [configured — not printed]");
  console.log("[vox-direct] buildId              :", buildId);
  console.log("[vox-direct] scriptSizeBytes      :", scriptSizeBytes);
  console.log("[vox-direct] scriptSha256         :", scriptSha256);

  if (scriptSizeBytes > SCRIPT_WARN_BYTES) {
    throw new Error(
      `Scenario script is too large (${scriptSizeBytes} bytes). Refusing upload above ${SCRIPT_WARN_BYTES} bytes to avoid 128KB limit.`,
    );
  }
  if (scriptSizeBytes > SCRIPT_LIMIT_BYTES) {
    throw new Error(
      `Scenario script exceeds Voximplant hard limit (${SCRIPT_LIMIT_BYTES} bytes).`,
    );
  }

  let resolvedScenarioId = scenarioId || null;
  let resolvedBy = scenarioId ? "id" : "name";

  if (!scenarioId) {
    // Best-effort existence/uniqueness check by scenario name.
    const lookupPayload = await callManagementApi(
      "GetScenarios",
      {
        scenario_name: scenarioName,
        count: "100",
        ...(creds.applicationId ? { application_id: creds.applicationId } : {}),
      },
      creds,
    );

    const matches = extractScenarioMatches(lookupPayload).filter((sc) => {
      const n =
        sc.scenario_name ?? sc.scenarioName ?? sc.required_scenario_name ?? null;
      return n !== null && String(n) === scenarioName;
    });

    if (matches.length === 0) {
      throw new Error(
        `No scenario found by name "${scenarioName}". Set VOXIMPLANT_SCENARIO_ID or verify rule/scenario names in Voximplant Console.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple scenarios found with name "${scenarioName}". Set VOXIMPLANT_SCENARIO_ID for an unambiguous upload.`,
      );
    }

    const single = matches[0];
    const foundId = single.scenario_id ?? single.scenarioId ?? null;
    resolvedScenarioId = foundId !== null ? String(foundId) : null;
  }

  const setParams = {
    ...(resolvedScenarioId
      ? { scenario_id: resolvedScenarioId }
      : { required_scenario_name: scenarioName }),
    scenario_name: scenarioName || undefined,
    scenario_script: stampedScenario,
  };

  await callManagementApi("SetScenarioInfo", setParams, creds);

  const expectedSourceName = scenarioName || "neg-conf-main-room";
  const expectedMarker = `[neg-conf-prod] scenario build=${buildId} source=${expectedSourceName}`;

  console.log("[vox-direct] resolvedBy           :", resolvedBy);
  console.log("[vox-direct] resolvedScenarioId   :", resolvedScenarioId || "(not returned)");
  console.log("[vox-direct] result               : success");
  console.log("[vox-direct] expectedLogMarker    :", expectedMarker);
  console.log("[vox-direct] NOTE                 : routing rules are unchanged; create a NEW session to verify runtime marker.");
  console.log("[vox-direct] ─────────────────────────────────────────────────────────────");
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "Unknown direct upload error.";
  console.error("[vox-direct] result               : fail");
  console.error("[vox-direct] error                :", message);
  process.exit(1);
});

