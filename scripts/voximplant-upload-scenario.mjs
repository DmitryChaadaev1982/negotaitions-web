/**
 * Stage 5.4.9 — Windows-safe Voximplant scenario upload wrapper.
 *
 * 1. Runs voximplant-sync-scenario.mjs (prepare step).
 * 2. Validates canonical files exist and rule is present.
 * 3. Invokes: npx voxengine-ci upload --application-name <name> --rule-name <name>
 *
 * Uses child_process.spawn to avoid PowerShell env-expansion issues.
 *
 * Usage:
 *   node scripts/voximplant-upload-scenario.mjs            # prepare + validate + upload
 *   node scripts/voximplant-upload-scenario.mjs --dry-run  # prepare only, show command
 *
 * Required env vars:
 *   VOX_CI_CREDENTIALS             Path to Voximplant service account JSON
 *   VOXIMPLANT_APPLICATION_NAME    short name used for CLI --application-name arg
 *   VOXIMPLANT_APPLICATION_DOMAIN  full domain, used as canonical folder name
 *   VOXIMPLANT_SCENARIO_NAME       e.g. neg-conf-main-room
 *   VOXIMPLANT_RULE_NAME           e.g. negotaitions-negotiation-room-rule
 *   VOX_CI_ROOT_PATH               e.g. .voxengine-ci (absolute or relative to project root)
 *
 * Never prints credentials or secrets.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ── Load .env.local if present ────────────────────────────────────────────────

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

// ── Args ──────────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes("--dry-run");

// ── Env ───────────────────────────────────────────────────────────────────────

const APPLICATION_NAME   = (process.env.VOXIMPLANT_APPLICATION_NAME || "").trim();
const SCENARIO_NAME      = (process.env.VOXIMPLANT_SCENARIO_NAME || "").trim();
const RULE_NAME          = (process.env.VOXIMPLANT_RULE_NAME || "").trim();
const VOX_CI_ROOT_PATH   = (process.env.VOX_CI_ROOT_PATH || ".voxengine-ci").trim();
const CREDENTIALS_PATH   = (process.env.VOX_CI_CREDENTIALS || "").trim();
const ACCOUNT_NAME       = (process.env.VOXIMPLANT_ACCOUNT_NAME || "").trim();

// Resolve canonical application domain — same logic as sync script.
function resolveAppDomain() {
  const explicit = (process.env.VOXIMPLANT_APPLICATION_DOMAIN || "").trim();
  if (explicit) return explicit;
  if (ACCOUNT_NAME) return `${APPLICATION_NAME}.${ACCOUNT_NAME}.voximplant.com`;
  return APPLICATION_NAME;
}

const APPLICATION_DOMAIN = resolveAppDomain();
const rootPath = resolve(PROJECT_ROOT, VOX_CI_ROOT_PATH);

// Canonical paths — must match what voximplant-sync-scenario.mjs writes.
const canonicalAppDir   = join(rootPath, "applications", APPLICATION_DOMAIN);
const canonicalRulesFile = join(canonicalAppDir, "rules.config.json");
const rootScenarioFile = join(rootPath, "scenarios", "src", `${SCENARIO_NAME}.voxengine.js`);

// ── Validate required vars ────────────────────────────────────────────────────

const missingVars = [];
if (!APPLICATION_NAME) missingVars.push("VOXIMPLANT_APPLICATION_NAME");
if (!SCENARIO_NAME)    missingVars.push("VOXIMPLANT_SCENARIO_NAME");
if (!RULE_NAME)        missingVars.push("VOXIMPLANT_RULE_NAME");

if (missingVars.length > 0) {
  console.error("[vox-upload] ERROR: Missing required env vars:", missingVars.join(", "));
  process.exit(1);
}

if (!isDryRun && !CREDENTIALS_PATH) {
  console.error("[vox-upload] ERROR: VOX_CI_CREDENTIALS is not set.");
  console.error("[vox-upload] Set VOX_CI_CREDENTIALS=<absolute path to service account JSON> in .env.local.");
  process.exit(1);
}

if (!isDryRun && !existsSync(CREDENTIALS_PATH)) {
  console.error("[vox-upload] ERROR: VOX_CI_CREDENTIALS file not found.");
  console.error("[vox-upload] Download the service account JSON from Voximplant Console → API keys.");
  process.exit(1);
}

// ── Step 1: Prepare ───────────────────────────────────────────────────────────

console.log("[vox-upload] ─── Step 1: Prepare scenario ──────────────────────────────");
const prepareArgs = ["scripts/voximplant-sync-scenario.mjs"];
if (isDryRun) prepareArgs.push("--dry-run");

const prepareResult = spawnSync(process.execPath, prepareArgs, {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  env: process.env,
});

if (prepareResult.status !== 0) {
  console.error("[vox-upload] ERROR: Prepare step failed with exit code", prepareResult.status);
  process.exit(prepareResult.status ?? 1);
}

// ── Dry run: print what would happen and exit ─────────────────────────────────

if (isDryRun) {
  console.log("\n[vox-upload] ─── Dry run summary ───────────────────────────────────────");
  console.log("[vox-upload] applicationName (CLI)   :", APPLICATION_NAME);
  console.log("[vox-upload] applicationDomain (folder):", APPLICATION_DOMAIN);
  console.log("[vox-upload] scenarioName            :", SCENARIO_NAME);
  console.log("[vox-upload] ruleName                :", RULE_NAME);
  console.log("[vox-upload] rootPath                :", rootPath);
  console.log("[vox-upload] canonicalRules          :", canonicalRulesFile);
  console.log("[vox-upload] rootScenario            :", rootScenarioFile);
  console.log("[vox-upload] credentials             : [configured — not printed]");
  console.log("[vox-upload]");
  console.log("[vox-upload] Would run:");
  console.log(`[vox-upload]   npx voxengine-ci upload`);
  console.log(`[vox-upload]     --application-name "${APPLICATION_NAME}"`);
  console.log(`[vox-upload]     --rule-name "${RULE_NAME}"`);
  console.log(`[vox-upload]   with VOX_CI_ROOT_PATH=${rootPath}`);
  console.log("[vox-upload] To upload for real, run: npm run vox:scenario:upload");
  process.exit(0);
}

// ── Step 2: Pre-upload validation ─────────────────────────────────────────────

console.log("\n[vox-upload] ─── Step 2: Pre-upload validation ──────────────────────────");
console.log("[vox-upload] applicationName (CLI)    :", APPLICATION_NAME);
console.log("[vox-upload] applicationDomain (folder):", APPLICATION_DOMAIN);
console.log("[vox-upload] scenarioName             :", SCENARIO_NAME);
console.log("[vox-upload] ruleName                 :", RULE_NAME);
console.log("[vox-upload] rootPath                 :", rootPath);
console.log("[vox-upload] canonicalRules           :", canonicalRulesFile);
console.log("[vox-upload] rootScenario             :", rootScenarioFile);
console.log("[vox-upload] credentials              : [configured — not printed]");
console.log();

let validationFailed = false;

// Check canonical rules.config.json exists
if (!existsSync(canonicalRulesFile)) {
  console.error("[vox-upload] FAIL: Canonical rules.config.json not found:", canonicalRulesFile);
  console.error("[vox-upload]       Run: npm run vox:scenario:prepare");
  validationFailed = true;
} else {
  console.log("[vox-upload] OK  : canonicalRules exists");

  // Check ruleName is present in rules.config.json
  try {
    const rulesRaw = readFileSync(canonicalRulesFile, "utf8");
    const rules = JSON.parse(rulesRaw);
    const found = Array.isArray(rules) && rules.some(
      (r) => r && typeof r === "object" && r.ruleName === RULE_NAME,
    );
    if (!found) {
      console.error("[vox-upload] FAIL: ruleName not found in canonicalRules:", RULE_NAME);
      console.error("[vox-upload]       Rules file contains:", JSON.stringify(rules.map((r) => r.ruleName)));
      console.error("[vox-upload]       Run: npm run vox:scenario:prepare");
      validationFailed = true;
    } else {
      console.log("[vox-upload] OK  : ruleName found in canonicalRules:", RULE_NAME);
    }
  } catch (err) {
    console.error("[vox-upload] FAIL: Could not parse canonicalRules:", err.message);
    validationFailed = true;
  }
}

// Check authoritative root scenario source exists
if (!existsSync(rootScenarioFile)) {
  console.error("[vox-upload] FAIL: Root scenario file not found:", rootScenarioFile);
  console.error("[vox-upload]       Run: npm run vox:scenario:prepare");
  validationFailed = true;
} else {
  console.log("[vox-upload] OK  : rootScenario exists");
}

if (validationFailed) {
  console.error("\n[vox-upload] Pre-upload validation failed. Fix issues above before uploading.");
  process.exit(1);
}

console.log("\n[vox-upload] Pre-upload validation passed.");

// ── Step 3: Upload ────────────────────────────────────────────────────────────

console.log("\n[vox-upload] ─── Step 3: Upload to Voximplant ──────────────────────────");
console.log("[vox-upload] Running: npx voxengine-ci upload");
console.log(`[vox-upload]   --application-name "${APPLICATION_NAME}"`);
console.log(`[vox-upload]   --rule-name "${RULE_NAME}"`);
console.log();

const uploadEnv = {
  ...process.env,
  VOX_CI_CREDENTIALS: CREDENTIALS_PATH,
  VOX_CI_ROOT_PATH: rootPath,
};

const uploadResult = spawnSync(
  "npx",
  [
    "voxengine-ci",
    "upload",
    "--application-name", APPLICATION_NAME,
    "--rule-name", RULE_NAME,
  ],
  {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: uploadEnv,
    shell: true,
  },
);

if (uploadResult.status !== 0) {
  console.error("\n[vox-upload] ERROR: Upload failed with exit code", uploadResult.status);
  console.error("[vox-upload] Troubleshooting:");
  console.error("[vox-upload]   - Check VOX_CI_CREDENTIALS points to a valid service account JSON");
  console.error("[vox-upload]   - Verify VOXIMPLANT_APPLICATION_NAME matches Console app name exactly");
  console.error("[vox-upload]   - Verify VOXIMPLANT_APPLICATION_DOMAIN matches canonical Console folder");
  console.error("[vox-upload]   - Verify VOXIMPLANT_RULE_NAME matches Console rule name exactly");
  console.error("[vox-upload]   - Canonical rules file:", canonicalRulesFile);
  process.exit(uploadResult.status ?? 1);
}

// ── Success ───────────────────────────────────────────────────────────────────

console.log("\n[vox-upload] Upload complete.");
console.log("[vox-upload] Create a new conference session and verify in Voximplant logs:");

const buildIdFile = join(PROJECT_ROOT, ".vox-scenario-build-id");
const buildId = existsSync(buildIdFile) ? readFileSync(buildIdFile, "utf8").trim() : "<buildId>";
console.log("[vox-upload]   [neg-conf-prod] scenario build=" + buildId + " source=" + SCENARIO_NAME);
