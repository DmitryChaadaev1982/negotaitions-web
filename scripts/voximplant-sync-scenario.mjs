/**
 * Stage 5.4.9 — Package local scenario code for VoxEngine CI.
 *
 * Reads docs/voximplant/neg-conf.main-room.scenario.js, stamps a build ID,
 * and writes the VoxEngine CI directory structure under VOX_CI_ROOT_PATH.
 *
 * VoxEngine CI uses:
 *   - app metadata/rules in: <VOX_CI_ROOT_PATH>/applications/<appDomain>/
 *   - scenario source in:     <VOX_CI_ROOT_PATH>/scenarios/src/*.voxengine.js
 *
 * This script writes:
 *   1) canonical app files (rules + app config) into the appDomain folder
 *   2) authoritative scenario source into root scenarios/src
 *   3) optional mirror scenario copies into app folders for compatibility/debugging
 *
 * Usage:
 *   node scripts/voximplant-sync-scenario.mjs
 *   node scripts/voximplant-sync-scenario.mjs --dry-run
 *
 * Required env vars (from .env.local or environment):
 *   VOXIMPLANT_APPLICATION_NAME    short app name, e.g. negotaitions-video-poc
 *   VOXIMPLANT_APPLICATION_DOMAIN  full domain, e.g. negotaitions-video-poc.dvchaadaev.voximplant.com
 *                                  (derived from APPLICATION_NAME + VOXIMPLANT_ACCOUNT_NAME if absent)
 *   VOXIMPLANT_SCENARIO_NAME       e.g. neg-conf-main-room
 *   VOXIMPLANT_RULE_NAME           e.g. negotaitions-negotiation-room-rule
 *   VOX_CI_ROOT_PATH               folder for generated files, e.g. .voxengine-ci or voxengine-ci
 *
 * Never reads or prints VOX_CI_CREDENTIALS or any secret.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ── Load .env.local if present (dev convenience) ──────────────────────────────

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

// ── Arg parsing ───────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes("--dry-run");

// ── Env resolution ────────────────────────────────────────────────────────────

const APPLICATION_NAME   = (process.env.VOXIMPLANT_APPLICATION_NAME || "").trim();
const SCENARIO_NAME      = (process.env.VOXIMPLANT_SCENARIO_NAME || "").trim();
const RULE_NAME          = (process.env.VOXIMPLANT_RULE_NAME || "").trim();
const VOX_CI_ROOT_PATH   = (process.env.VOX_CI_ROOT_PATH || ".voxengine-ci").trim();
const ACCOUNT_NAME       = (process.env.VOXIMPLANT_ACCOUNT_NAME || "").trim();

const missing = [];
if (!APPLICATION_NAME) missing.push("VOXIMPLANT_APPLICATION_NAME");
if (!SCENARIO_NAME)    missing.push("VOXIMPLANT_SCENARIO_NAME");
if (!RULE_NAME)        missing.push("VOXIMPLANT_RULE_NAME");

if (missing.length > 0) {
  console.error("[vox-sync] ERROR: Missing required env vars:", missing.join(", "));
  console.error("[vox-sync] Set them in .env.local or environment before running.");
  process.exit(1);
}

// Resolve canonical application domain (the folder name VoxEngine CI uses).
// Priority:
//   1. VOXIMPLANT_APPLICATION_DOMAIN (explicit)
//   2. Derived: APPLICATION_NAME + "." + ACCOUNT_NAME + ".voximplant.com"
//   3. Fallback: APPLICATION_NAME (with warning)
function resolveAppDomain() {
  const explicit = (process.env.VOXIMPLANT_APPLICATION_DOMAIN || "").trim();
  if (explicit) return { domain: explicit, derived: false };

  if (ACCOUNT_NAME) {
    const derived = `${APPLICATION_NAME}.${ACCOUNT_NAME}.voximplant.com`;
    console.warn(
      "[vox-sync] WARN: VOXIMPLANT_APPLICATION_DOMAIN not set.",
      `Derived from account name: ${derived}`,
    );
    return { domain: derived, derived: true };
  }

  console.warn(
    "[vox-sync] WARN: VOXIMPLANT_APPLICATION_DOMAIN not set and VOXIMPLANT_ACCOUNT_NAME unavailable.",
    `Falling back to short name: ${APPLICATION_NAME}`,
    "Set VOXIMPLANT_APPLICATION_DOMAIN explicitly to avoid folder mismatch.",
  );
  return { domain: APPLICATION_NAME, derived: false };
}

const { domain: APPLICATION_DOMAIN } = resolveAppDomain();
const domainDiffersFromName = APPLICATION_DOMAIN !== APPLICATION_NAME;

// ── Build ID generation ───────────────────────────────────────────────────────

function getGitShortSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function buildBuildId() {
  const sha = getGitShortSha();
  const now = new Date();
  const yyyymmdd = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const hhmmss = String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const datePart = `${yyyymmdd}-${hhmmss}`;
  return sha ? `dev-${datePart}-g${sha}` : `dev-${datePart}`;
}

const BUILD_ID = buildBuildId();

// ── Source file ───────────────────────────────────────────────────────────────

const SOURCE_FILE = join(PROJECT_ROOT, "docs", "voximplant", "neg-conf.main-room.scenario.js");

if (!existsSync(SOURCE_FILE)) {
  console.error("[vox-sync] ERROR: Source scenario not found:", SOURCE_FILE);
  process.exit(1);
}

const sourceContent = readFileSync(SOURCE_FILE, "utf8");

// ── Stamp build ID ────────────────────────────────────────────────────────────

const LOCAL_DEV_PLACEHOLDER = "__LOCAL_DEV_BUILD__";

if (!sourceContent.includes(LOCAL_DEV_PLACEHOLDER)) {
  console.warn(
    "[vox-sync] WARN: Placeholder '" + LOCAL_DEV_PLACEHOLDER + "' not found in source.",
    "Scenario will be copied without build ID substitution.",
  );
}

const stampedContent = sourceContent.replaceAll(LOCAL_DEV_PLACEHOLDER, BUILD_ID);

// ── SHA256 ────────────────────────────────────────────────────────────────────

const sha256 = createHash("sha256").update(stampedContent, "utf8").digest("hex");

// ── Path helpers ──────────────────────────────────────────────────────────────

const rootPath = resolve(PROJECT_ROOT, VOX_CI_ROOT_PATH);

function buildAppPaths(folderName) {
  const appDir  = join(rootPath, "applications", folderName);
  const scenDir = join(appDir, "scenarios", "src");
  return {
    appDir,
    scenDir,
    scenFile:  join(scenDir, `${SCENARIO_NAME}.voxengine.js`),
    rulesFile: join(appDir, "rules.config.json"),
    appFile:   join(appDir, "application.config.json"),
  };
}

const canonical = buildAppPaths(APPLICATION_DOMAIN);
const mirror    = domainDiffersFromName ? buildAppPaths(APPLICATION_NAME) : null;
const rootScenariosDir = join(rootPath, "scenarios", "src");
const rootScenarioFile = join(rootScenariosDir, `${SCENARIO_NAME}.voxengine.js`);

// ── Print summary ─────────────────────────────────────────────────────────────

console.log("\n[vox-sync] ─── Voximplant Scenario Prepare ─────────────────────────────");
console.log("[vox-sync] sourceFile         :", SOURCE_FILE);
console.log("[vox-sync] applicationName    :", APPLICATION_NAME, "(CLI upload arg)");
console.log("[vox-sync] applicationDomain  :", APPLICATION_DOMAIN, "(canonical folder)");
console.log("[vox-sync] scenarioName       :", SCENARIO_NAME);
console.log("[vox-sync] ruleName           :", RULE_NAME);
console.log("[vox-sync] buildId            :", BUILD_ID);
console.log("[vox-sync] sha256             :", sha256);
console.log("[vox-sync] rootPath           :", rootPath);
console.log("[vox-sync] rootScenario       :", rootScenarioFile);
console.log("[vox-sync] canonicalRules     :", canonical.rulesFile);
console.log("[vox-sync] canonicalAppConfig :", canonical.appFile);
console.log("[vox-sync] mirrorScenario     :", canonical.scenFile);
if (mirror) {
  console.log("[vox-sync] mirrorScenario     :", mirror.scenFile);
  console.log("[vox-sync] mirrorRules        :", mirror.rulesFile);
}
if (isDryRun) {
  console.log("[vox-sync] mode               : DRY RUN (no files written)");
}
console.log("[vox-sync] ──────────────────────────────────────────────────────────────\n");

if (isDryRun) {
  console.log("[vox-sync] Dry run complete. No files written.");
  console.log("[vox-sync] To prepare for real, run: npm run vox:scenario:prepare");
  process.exit(0);
}

// ── Build rules config ────────────────────────────────────────────────────────

const rulesConfig = [
  {
    ruleName: RULE_NAME,
    rulePattern: ".*",
    scenarios: [SCENARIO_NAME],
  },
];

// ── Build application config ──────────────────────────────────────────────────
// Merge with existing downloaded config if present, preserving any platform fields.

function buildAppConfig(appFile) {
  let existing = {};
  if (existsSync(appFile)) {
    try {
      existing = JSON.parse(readFileSync(appFile, "utf8"));
      console.log("[vox-sync] Merging with existing appConfig:", appFile);
    } catch {
      console.warn("[vox-sync] WARN: Could not parse existing appConfig, overwriting.");
    }
  }
  return {
    ...existing,
    applicationName: APPLICATION_NAME,
  };
}

// ── Write canonical app folder ────────────────────────────────────────────────

mkdirSync(canonical.scenDir, { recursive: true });
mkdirSync(rootScenariosDir, { recursive: true });

writeFileSync(rootScenarioFile, stampedContent, "utf8");
console.log("[vox-sync] [root]      Written scenario    :", rootScenarioFile);

// Optional mirror for easier local inspection (not authoritative for upload).
writeFileSync(canonical.scenFile, stampedContent, "utf8");
console.log("[vox-sync] [mirror]    Written scenario    :", canonical.scenFile);

writeFileSync(canonical.rulesFile, JSON.stringify(rulesConfig, null, 2) + "\n", "utf8");
console.log("[vox-sync] [canonical] Written rules       :", canonical.rulesFile);

const appConfig = buildAppConfig(canonical.appFile);
writeFileSync(canonical.appFile, JSON.stringify(appConfig, null, 2) + "\n", "utf8");
console.log("[vox-sync] [canonical] Written appConfig   :", canonical.appFile);

// ── Write mirror folder (short name) ─────────────────────────────────────────

if (mirror) {
  mkdirSync(mirror.scenDir, { recursive: true });

  writeFileSync(mirror.scenFile, stampedContent, "utf8");
  console.log("[vox-sync] [mirror]    Written scenario    :", mirror.scenFile);

  writeFileSync(mirror.rulesFile, JSON.stringify(rulesConfig, null, 2) + "\n", "utf8");
  console.log("[vox-sync] [mirror]    Written rules       :", mirror.rulesFile);

  const mirrorAppConfig = buildAppConfig(mirror.appFile);
  writeFileSync(mirror.appFile, JSON.stringify(mirrorAppConfig, null, 2) + "\n", "utf8");
  console.log("[vox-sync] [mirror]    Written appConfig   :", mirror.appFile);
}

// ── .vox-scenario-build-id — non-secret, machine-local, gitignored ────────────

const buildIdFile = join(PROJECT_ROOT, ".vox-scenario-build-id");
writeFileSync(buildIdFile, BUILD_ID, "utf8");
console.log("[vox-sync] Written buildId         :", buildIdFile, "→", BUILD_ID);

console.log("\n[vox-sync] Prepare complete.");
console.log("[vox-sync] Canonical folder:", join(rootPath, "applications", APPLICATION_DOMAIN));
if (mirror) {
  console.log("[vox-sync] Mirror folder   :", join(rootPath, "applications", APPLICATION_NAME));
}
console.log("[vox-sync] Next step: npm run vox:scenario:upload");
console.log("[vox-sync] After upload, start a new session and look for:");
console.log("[vox-sync]   [neg-conf-prod] scenario build=" + BUILD_ID + " source=" + SCENARIO_NAME);
