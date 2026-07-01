/**
 * Stage 5.4.9 — Drift detection between local scenario and deployed snapshot.
 *
 * Compares the local generated scenario (produced by voximplant-sync-scenario.mjs)
 * against the downloaded platform snapshot (produced by `npx voxengine-ci init --force`).
 *
 * Uses the authoritative local source path:
 *   <VOX_CI_ROOT_PATH>/scenarios/src/<scenario>.voxengine.js
 *
 * App-domain folders are still used for rules/config and best-effort remote snapshots.
 *
 * Output:
 *   LOCAL_ONLY  — local file exists but no remote snapshot to compare against
 *   MATCH       — local and remote hashes match
 *   DIFF        — hashes differ (local was changed after last upload)
 *
 * Usage:
 *   npm run vox:scenario:check
 *   node scripts/voximplant-check-scenario-drift.mjs
 *
 * If no remote snapshot is available, the script exits 0 with an actionable message.
 * Run `npx voxengine-ci init --force` with VOX_CI_CREDENTIALS set to download one.
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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

// ── Env ───────────────────────────────────────────────────────────────────────

const APPLICATION_NAME   = (process.env.VOXIMPLANT_APPLICATION_NAME || "").trim();
const SCENARIO_NAME      = (process.env.VOXIMPLANT_SCENARIO_NAME || "").trim();
const VOX_CI_ROOT_PATH   = (process.env.VOX_CI_ROOT_PATH || ".voxengine-ci").trim();
const ACCOUNT_NAME       = (process.env.VOXIMPLANT_ACCOUNT_NAME || "").trim();

function resolveAppDomain() {
  const explicit = (process.env.VOXIMPLANT_APPLICATION_DOMAIN || "").trim();
  if (explicit) return explicit;
  if (ACCOUNT_NAME) return `${APPLICATION_NAME}.${ACCOUNT_NAME}.voximplant.com`;
  return APPLICATION_NAME;
}

const APPLICATION_DOMAIN = resolveAppDomain();

const missing = [];
if (!APPLICATION_NAME) missing.push("VOXIMPLANT_APPLICATION_NAME");
if (!SCENARIO_NAME)    missing.push("VOXIMPLANT_SCENARIO_NAME");

if (missing.length > 0) {
  console.error("[vox-drift] ERROR: Missing required env vars:", missing.join(", "));
  process.exit(1);
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const rootPath = resolve(PROJECT_ROOT, VOX_CI_ROOT_PATH);
const canonicalAppDir = join(rootPath, "applications", APPLICATION_DOMAIN);
const localScenFile   = join(rootPath, "scenarios", "src", `${SCENARIO_NAME}.voxengine.js`);

// VoxEngine CI stores downloaded (remote) snapshots in a parallel path.
// After `npx voxengine-ci init --force` the remote files appear alongside local src.
// The exact path depends on @voximplant/voxengine-ci version; common patterns:
const remoteScenCandidates = [
  join(canonicalAppDir, "scenarios", "remote", `${SCENARIO_NAME}.voxengine.js`),
  join(canonicalAppDir, "scenarios", `${SCENARIO_NAME}.voxengine.js.remote`),
  join(canonicalAppDir, `${SCENARIO_NAME}.remote.voxengine.js`),
  // Also check short-name folder in case voxengine-ci uses it
  join(rootPath, "applications", APPLICATION_NAME, "scenarios", "remote", `${SCENARIO_NAME}.voxengine.js`),
];

// ── SHA256 helper ─────────────────────────────────────────────────────────────

function sha256File(filePath) {
  const content = readFileSync(filePath, "utf8");
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\n[vox-drift] ─── Voximplant Scenario Drift Check ─────────────────────────");
console.log("[vox-drift] applicationName   :", APPLICATION_NAME);
console.log("[vox-drift] applicationDomain :", APPLICATION_DOMAIN);
console.log("[vox-drift] scenarioName      :", SCENARIO_NAME);
console.log("[vox-drift] canonicalFolder   :", canonicalAppDir);
console.log("[vox-drift] localSourceFolder :", join(rootPath, "scenarios", "src"));
console.log("[vox-drift] localFile         :", localScenFile);

if (!existsSync(localScenFile)) {
  console.error("\n[vox-drift] ERROR: Local generated scenario not found.");
  console.error("[vox-drift] Run first: npm run vox:scenario:prepare");
  process.exit(1);
}

const localHash = sha256File(localScenFile);
console.log("[vox-drift] localHash         :", localHash);

// ── Find remote snapshot ──────────────────────────────────────────────────────

let remoteFile = null;
for (const candidate of remoteScenCandidates) {
  if (existsSync(candidate)) {
    remoteFile = candidate;
    break;
  }
}

if (!remoteFile) {
  console.log("\n[vox-drift] result          : LOCAL_ONLY");
  console.log("[vox-drift] No remote snapshot found to compare.");
  console.log("[vox-drift] To download the deployed scenario for comparison, run:");
  console.log("[vox-drift]   npx voxengine-ci init --force");
  console.log("[vox-drift] (requires VOX_CI_CREDENTIALS to be set in .env.local)");
  console.log("\n[vox-drift] Best-effort check: drift detection is NOT reliable without remote snapshot.");
  console.log("[vox-drift] Upload with: npm run vox:scenario:upload");
  console.log("[vox-drift] Then verify runtime build ID in Voximplant logs.");
  process.exit(0);
}

// ── Compare ───────────────────────────────────────────────────────────────────

const remoteHash = sha256File(remoteFile);
console.log("[vox-drift] remoteFile        :", remoteFile);
console.log("[vox-drift] remoteHash        :", remoteHash);

if (localHash === remoteHash) {
  console.log("\n[vox-drift] result          : MATCH");
  console.log("[vox-drift] Local scenario matches remote snapshot.");
} else {
  console.log("\n[vox-drift] result          : DIFF");
  console.log("[vox-drift] Local and remote hashes differ — local was modified since last upload.");
  console.log("[vox-drift] Upload with: npm run vox:scenario:upload");
  process.exit(2);
}
