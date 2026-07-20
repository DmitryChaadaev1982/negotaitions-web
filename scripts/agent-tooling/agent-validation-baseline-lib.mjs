import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { git, sha256 } from "./common.mjs";

const BASELINE_PATH = ".agent/validation-baseline.json";
const SCHEMA_VERSION = 1;
const EXCLUDED_PREFIXES = [
  "node_modules/",
  ".next/",
  "test-results/",
  "playwright-report/",
  ".agent/",
];

function isExcludedPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export async function getRepositoryContext(cwd = process.cwd(), deps = {}) {
  const gitFn = deps.git ?? git;
  const repositoryRoot = await gitFn(["rev-parse", "--show-toplevel"], { cwd });
  const worktree = cwd;
  const branch = await gitFn(["branch", "--show-current"], { cwd: repositoryRoot });
  const head = await gitFn(["rev-parse", "HEAD"], { cwd: repositoryRoot });
  return { repositoryRoot, worktree, branch, head };
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return sha256(content);
}

async function listUntrackedFiles(repositoryRoot, deps = {}) {
  const gitFn = deps.git ?? git;
  const output = await gitFn(["ls-files", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
  });
  const files = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !isExcludedPath(file));

  const entries = [];
  for (const file of files) {
    const fullPath = path.join(repositoryRoot, file);
    const contentHash = await hashFile(fullPath);
    entries.push({ path: file, contentHash });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function computeValidationFingerprint(cwd = process.cwd(), deps = {}) {
  const gitFn = deps.git ?? git;
  const context = await getRepositoryContext(cwd, { git: gitFn });
  const { repositoryRoot } = context;

  const trackedDiffRaw =
    deps.trackedDiff ??
    (await gitFn(["diff", "--binary", "--", ".", ":(exclude)node_modules", ":(exclude).next", ":(exclude)test-results", ":(exclude)playwright-report", ":(exclude).agent"], {
      cwd: repositoryRoot,
    }));
  const stagedDiffRaw =
    deps.stagedDiff ??
    (await gitFn(["diff", "--binary", "--cached", "--", ".", ":(exclude)node_modules", ":(exclude).next", ":(exclude)test-results", ":(exclude)playwright-report", ":(exclude).agent"], {
      cwd: repositoryRoot,
    }));

  const untrackedEntries = deps.untrackedEntries ?? (await listUntrackedFiles(repositoryRoot, { git: gitFn }));
  const untrackedSummary = untrackedEntries.map((entry) => `${entry.path}:${entry.contentHash}`).join("\n");

  const trackedDiffFingerprint = sha256(trackedDiffRaw);
  const stagedDiffFingerprint = sha256(stagedDiffRaw);
  const untrackedFilesFingerprint = sha256(untrackedSummary);
  const dirtyTreeFingerprint = sha256(
    JSON.stringify({
      head: context.head,
      trackedDiffFingerprint,
      stagedDiffFingerprint,
      untrackedFilesFingerprint,
    }),
  );

  const statusOutput = await gitFn(["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repositoryRoot,
  });
  const dirtyFiles = uniqueSorted(
    statusOutput
      .split(/\r?\n/)
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length >= 4)
      .map((line) => line.slice(3).trim())
      .filter((file) => !isExcludedPath(file)),
  );

  return {
    repositoryRoot: context.repositoryRoot,
    worktree: context.worktree,
    branch: context.branch,
    head: context.head,
    dirtyTreeFingerprint,
    trackedDiffFingerprint,
    stagedDiffFingerprint,
    untrackedFilesFingerprint,
    dirtyFiles,
  };
}

export async function loadBaseline(repositoryRoot, deps = {}) {
  const readFile = deps.readFile ?? fs.readFile;
  const targetPath = path.join(repositoryRoot, BASELINE_PATH);
  try {
    const raw = await readFile(targetPath, "utf8");
    return { baseline: JSON.parse(raw), path: targetPath };
  } catch {
    return { baseline: null, path: targetPath };
  }
}

export function classifyChangedFiles(files) {
  const categories = new Set();
  const escalationFiles = [];
  const lowRiskFiles = [];

  function addLowRisk(category, file) {
    categories.add(category);
    lowRiskFiles.push(file);
  }

  function addEscalation(category, file, reason) {
    categories.add(category);
    escalationFiles.push({ file, reason });
  }

  for (const file of files) {
    if (/^docs\/.*\.md$/i.test(file) || /\.md$/i.test(file)) {
      addLowRisk("docs", file);
      continue;
    }
    if (/^tests\/|\.test\./i.test(file) || /__fixtures__|fixtures\//i.test(file)) {
      addLowRisk("tests", file);
      continue;
    }
    if (/^lib\/i18n\/dictionaries\/.*\.(ts|js|json)$/i.test(file)) {
      addLowRisk("translation dictionaries", file);
      continue;
    }
    if (/\.(css|scss|sass|less)$/i.test(file)) {
      addLowRisk("styles", file);
      continue;
    }
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico|avif)$/i.test(file)) {
      addLowRisk("static assets", file);
      continue;
    }
    if (/labels|copy|messages/i.test(file) && /\.(json|ts|js)$/i.test(file)) {
      addLowRisk("labels/copy", file);
      continue;
    }
    if (/^prisma\/|schema\.prisma$|migrations\/|\.sql$/i.test(file)) {
      addEscalation("database/schema", file, "Prisma/schema or SQL change");
      continue;
    }
    if (/^app\/api\//i.test(file)) {
      addEscalation("application logic", file, "API route change");
      continue;
    }
    if (/^app\/actions\//i.test(file)) {
      addEscalation("application logic", file, "Server action change");
      continue;
    }
    if (/^components\/.*\.tsx$/i.test(file)) {
      addEscalation("application logic", file, "Stateful application component");
      continue;
    }
    if (/^lib\/.*(poll|state|auth|access|room|session|event|record|transcript|ai|service|hook)/i.test(file)) {
      addEscalation("application logic", file, "Domain/service/state logic");
      continue;
    }
    if (/^package(-lock)?\.json$/i.test(file)) {
      addEscalation("configuration/tooling", file, "Dependency or script manifest change");
      continue;
    }
    if (/^playwright.*config\.(ts|js)$/i.test(file) || /^next\.config\./i.test(file)) {
      addEscalation("configuration/tooling", file, "Test/runtime configuration change");
      continue;
    }
    if (/^scripts\/|^\.github\/|hooks?/i.test(file) || /^AGENTS\.md$/i.test(file)) {
      addEscalation("configuration/tooling", file, "Tooling/workflow configuration change");
      continue;
    }
    addEscalation("application logic", file, "Unknown or mixed-risk code path");
  }
  return {
    categories: Array.from(categories).sort((a, b) => a.localeCompare(b)),
    escalationFiles,
    lowRiskFiles,
  };
}

export function buildRecommendation({ fingerprintMatch, analysis }) {
  if (fingerprintMatch) {
    return {
      recommendation: "BASELINE_CURRENT",
      reason: "Current fingerprint exactly matches the recorded baseline.",
    };
  }
  if (analysis.escalationFiles.length === 0) {
    return {
      recommendation: "FOCUSED_VALIDATION_SUFFICIENT",
      reason: "Only low-risk docs/tests/i18n/styles/static/copy scoped files changed.",
    };
  }
  return {
    recommendation: "FULL_GATE_RECOMMENDED",
    reason: "Mixed or high-risk files changed; conservative policy escalates to full gate.",
  };
}

function equalFingerprints(current, baseline) {
  if (!baseline) {
    return false;
  }
  return (
    current.head === baseline.head &&
    current.dirtyTreeFingerprint === baseline.dirtyTreeFingerprint &&
    current.trackedDiffFingerprint === baseline.trackedDiffFingerprint &&
    current.stagedDiffFingerprint === baseline.stagedDiffFingerprint &&
    current.untrackedFilesFingerprint === baseline.untrackedFilesFingerprint
  );
}

export async function showBaseline(cwd = process.cwd(), deps = {}) {
  const context = await getRepositoryContext(cwd, { git: deps.git });
  const current = await computeValidationFingerprint(cwd, deps);
  const loaded = await loadBaseline(context.repositoryRoot, deps);
  const baseline = loaded.baseline;
  const fingerprintMatch = equalFingerprints(current, baseline);
  const changedFiles = current.dirtyFiles;
  const analysis = classifyChangedFiles(changedFiles);
  const recommendation = buildRecommendation({ fingerprintMatch, analysis });

  return {
    baseline,
    current,
    fingerprintMatch,
    changedFiles,
    categories: analysis.categories,
    escalationFiles: analysis.escalationFiles,
    lowRiskFiles: analysis.lowRiskFiles,
    recommendation: recommendation.recommendation,
    recommendationReason: recommendation.reason,
    baselinePath: loaded.path,
  };
}

export async function checkBaseline(cwd = process.cwd(), deps = {}) {
  const shown = await showBaseline(cwd, deps);
  if (!shown.baseline || shown.baseline.schemaVersion !== SCHEMA_VERSION) {
    return { ...shown, exitCode: 3 };
  }
  if (shown.fingerprintMatch) {
    return { ...shown, exitCode: 0 };
  }
  return { ...shown, exitCode: 2 };
}

export function parseRecordFlags(argv) {
  const parsed = parseArgs({
    args: argv,
    options: {
      "confirm-green": { type: "boolean", default: false },
      command: { type: "string", multiple: true },
      note: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  return {
    confirmGreen: parsed.values["confirm-green"] === true,
    commands: parsed.values.command ?? [],
    note: parsed.values.note ?? "",
  };
}

export async function recordBaseline(cwd = process.cwd(), argv = [], deps = {}) {
  const flags = parseRecordFlags(argv);
  if (!flags.confirmGreen) {
    throw new Error("Recording refused: pass --confirm-green to acknowledge a known green local run.");
  }

  const current = await computeValidationFingerprint(cwd, deps);
  const baseline = {
    schemaVersion: SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    repositoryRoot: current.repositoryRoot,
    worktree: current.worktree,
    branch: current.branch,
    head: current.head,
    dirtyTreeFingerprint: current.dirtyTreeFingerprint,
    trackedDiffFingerprint: current.trackedDiffFingerprint,
    stagedDiffFingerprint: current.stagedDiffFingerprint,
    untrackedFilesFingerprint: current.untrackedFilesFingerprint,
    dirtyFiles: current.dirtyFiles,
    commands: flags.commands,
    results: "Local execution recorded as green by user/agent confirmation.",
    note: flags.note || "",
  };

  const targetPath = path.join(current.repositoryRoot, BASELINE_PATH);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  return { baseline, baselinePath: targetPath };
}

export async function clearBaseline(cwd = process.cwd(), deps = {}) {
  const context = await getRepositoryContext(cwd, { git: deps.git });
  const targetPath = path.join(context.repositoryRoot, BASELINE_PATH);
  try {
    await fs.unlink(targetPath);
    return { removed: true, baselinePath: targetPath };
  } catch {
    return { removed: false, baselinePath: targetPath };
  }
}

export function formatShowOutput(result) {
  const lines = [];
  lines.push("Local validation baseline");
  lines.push(`Baseline path: ${result.baselinePath}`);
  lines.push(`Baseline present: ${result.baseline ? "yes" : "no"}`);
  if (result.baseline) {
    lines.push(`Recorded at: ${result.baseline.recordedAt}`);
    lines.push(`Baseline branch/head: ${result.baseline.branch} @ ${result.baseline.head}`);
  }
  lines.push(`Current branch/head: ${result.current.branch} @ ${result.current.head}`);
  lines.push(`Fingerprint identical: ${result.fingerprintMatch ? "yes" : "no"}`);
  lines.push(`Files changed since baseline: ${result.changedFiles.length}`);
  for (const file of result.changedFiles) {
    lines.push(`- ${file}`);
  }
  lines.push(
    `Broad change categories: ${result.categories.length > 0 ? result.categories.join(", ") : "(none)"}`,
  );
  if (result.escalationFiles.length > 0) {
    lines.push("Escalated by:");
    for (const entry of result.escalationFiles) {
      lines.push(`- ${entry.file} - ${entry.reason}`);
    }
  } else if (result.lowRiskFiles.length > 0) {
    lines.push("Changes:");
    for (const file of result.lowRiskFiles) {
      lines.push(`- ${file}`);
    }
  }
  lines.push("Recommendation policy:");
  lines.push("- BASELINE_CURRENT: exact fingerprint match.");
  lines.push(
    "- FOCUSED_VALIDATION_SUFFICIENT: deliberately conservative; only clearly low-risk docs/tests/i18n/styles/static/copy changes.",
  );
  lines.push(
    "- FULL_GATE_RECOMMENDED: any mixed/unknown/high-risk changes (application logic, API/service, schema, dependencies, Playwright/Next/scripts/tooling).",
  );
  lines.push(`Recommendation: ${result.recommendation}`);
  lines.push(`Reason: ${result.recommendationReason}`);
  lines.push("Note: baseline guidance is local and does not replace engineering judgment.");
  return lines.join("\n");
}
