import fs from "node:fs/promises";
import path from "node:path";

import {
  areConnectionTargetsEqual,
  checkPostgresConnectivity,
  databaseDescriptor,
  detectChromiumAvailability,
  detectPort3000Owner,
  extractWorktreeFromCommandLine,
  git,
  parseDatabaseUrl,
  probeHttpHealth,
  resolveGitCommonDir,
  sameFsPath,
  runCommand,
} from "./common.mjs";

const DEFAULT_HEALTH_URL = "http://localhost:3000";
const SNAPSHOT_PATH = ".agent/preflight.json";

function statusLabel(connected, configured) {
  if (!configured) {
    return "not-configured";
  }
  return connected ? "connected" : "not-connected";
}

function sanitizeCommandLine(commandLine) {
  if (!commandLine) {
    return null;
  }
  return commandLine
    .replace(/((?:token|api[_-]?key|password|passwd|secret|cookie)\s*=\s*)[^\s"']+/gi, "$1***")
    .replace(/(authorization:\s*bearer\s+)[^\s"']+/gi, "$1***");
}

export async function resolveServerOwnership({
  portStatus,
  currentWorktree,
  currentGitCommonDir,
  resolveCommonDir = resolveGitCommonDir,
}) {
  if (portStatus.status !== "occupied") {
    return {
      ownerWorktree: null,
      sameWorktree: null,
      sameGitRepository: null,
      ownershipDeterminable: false,
    };
  }

  const ownerWorktree = extractWorktreeFromCommandLine(portStatus.commandLine);
  if (!ownerWorktree) {
    return {
      ownerWorktree: null,
      sameWorktree: null,
      sameGitRepository: null,
      ownershipDeterminable: false,
    };
  }

  const sameWorktree = sameFsPath(ownerWorktree, currentWorktree);
  let sameGitRepository = null;
  if (currentGitCommonDir) {
    const ownerGitCommonDir = await resolveCommonDir(ownerWorktree);
    if (ownerGitCommonDir) {
      sameGitRepository = sameFsPath(ownerGitCommonDir, currentGitCommonDir);
    }
  }

  return {
    ownerWorktree: ownerWorktree.replace(/\\/g, "/"),
    sameWorktree,
    sameGitRepository,
    ownershipDeterminable: true,
  };
}

export function classifyPlaywrightMode({
  portStatus,
  health,
  ownership,
}) {
  if (portStatus.status === "free") {
    return {
      mode: "MANAGED",
      reason: "Port 3000 is free; Playwright-managed webServer is safe.",
    };
  }
  if (portStatus.status !== "occupied") {
    return {
      mode: "UNAVAILABLE",
      reason: "Port ownership cannot be determined safely.",
    };
  }
  if (!health.ok) {
    return {
      mode: "PROCESS_CONFLICT",
      reason: "Port 3000 is occupied but health check failed.",
    };
  }
  if (!ownership.ownershipDeterminable) {
    return {
      mode: "UNAVAILABLE",
      reason: "Healthy server detected but owning worktree cannot be determined safely.",
    };
  }
  if (ownership.sameWorktree) {
    return {
      mode: "LIVE",
      reason: "Healthy server belongs to the exact current worktree.",
    };
  }
  if (ownership.sameGitRepository === true) {
    return {
      mode: "SIBLING_WORKTREE_CONFLICT",
      reason: "Healthy server belongs to a sibling worktree from the same Git repository.",
    };
  }
  return {
    mode: "PROCESS_CONFLICT",
    reason: "Healthy server belongs to another process/repository.",
  };
}

export async function collectPreflightSnapshot(deps = {}) {
  const runner = deps.runCommand ?? runCommand;
  const gitFn = deps.git ?? git;
  const cwd = deps.cwd ?? process.cwd();
  const repositoryRoot = deps.repositoryRoot ?? (await gitFn(["rev-parse", "--show-toplevel"], { cwd }));
  const currentWorktree = repositoryRoot;
  const currentGitCommonDir =
    deps.currentGitCommonDir ?? (await (deps.resolveGitCommonDir ?? resolveGitCommonDir)(currentWorktree, { git: gitFn }));
  const branch = deps.branch ?? (await gitFn(["branch", "--show-current"], { cwd: repositoryRoot }));
  const head = deps.head ?? (await gitFn(["rev-parse", "HEAD"], { cwd: repositoryRoot }));

  const statusOutput =
    deps.statusOutput ??
    (await gitFn(["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repositoryRoot,
    }));
  const statusLines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length >= 4);
  const trackedModifiedFiles = [];
  const untrackedFiles = [];

  for (const line of statusLines) {
    if (line.startsWith("?? ")) {
      untrackedFiles.push(line.slice(3).trim());
      continue;
    }
    trackedModifiedFiles.push(line.slice(3).trim());
  }

  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  const e2eDatabaseUrl = deps.e2eDatabaseUrl ?? process.env.E2E_DATABASE_URL?.trim() ?? "";

  const parse = deps.parseDatabaseUrl ?? parseDatabaseUrl;
  const parsedMain = deps.parsedMain ?? parse(databaseUrl);
  const parsedE2e = deps.parsedE2e ?? parse(e2eDatabaseUrl);
  const mainDescriptor = databaseDescriptor(parsedMain);
  const e2eDescriptor = databaseDescriptor(parsedE2e);

  const mainDbConfigured = Boolean(parsedMain);
  const e2eDbConfigured = Boolean(parsedE2e);

  const checkDb = deps.checkPostgresConnectivity ?? checkPostgresConnectivity;
  const mainDbAvailability = mainDbConfigured
    ? await checkDb(databaseUrl, 2_500)
    : { connected: false, reason: "not-configured" };
  const e2eDbAvailability = e2eDbConfigured
    ? await checkDb(e2eDatabaseUrl, 2_500)
    : { connected: false, reason: "not-configured" };

  const dbTargetsDistinct = mainDbConfigured && e2eDbConfigured
    ? !areConnectionTargetsEqual(parsedMain, parsedE2e)
    : null;

  const portOwnerDetector = deps.detectPort3000Owner ?? detectPort3000Owner;
  const portStatus = await portOwnerDetector({ runCommand: runner, platform: deps.platform });

  const healthProbe = deps.probeHttpHealth ?? probeHttpHealth;
  const health = await healthProbe(DEFAULT_HEALTH_URL, 2_500);
  const sanitizedCommandLine = sanitizeCommandLine(portStatus.commandLine);
  const ownership = await resolveServerOwnership({
    portStatus: { ...portStatus, commandLine: sanitizedCommandLine },
    currentWorktree,
    currentGitCommonDir,
    resolveCommonDir: async (worktree) =>
      (deps.resolveGitCommonDir ?? resolveGitCommonDir)(worktree, { git: gitFn }),
  });
  const recommendation = classifyPlaywrightMode({
    portStatus,
    health,
    ownership,
  });

  const chromiumDetector = deps.detectChromiumAvailability ?? detectChromiumAvailability;
  const chromium = await chromiumDetector({ cwd: repositoryRoot });

  return {
    generatedAt: new Date().toISOString(),
    repository: path.basename(repositoryRoot),
    repositoryRoot,
    currentWorktree,
    branch,
    head,
    dirtyFileCount: statusLines.length,
    trackedModifiedFiles,
    untrackedFiles,
    database: {
      main: {
        configured: mainDbConfigured,
        descriptor: mainDescriptor,
        availability: statusLabel(mainDbAvailability.connected, mainDbConfigured),
      },
      e2e: {
        configured: e2eDbConfigured,
        descriptor: e2eDescriptor,
        availability: statusLabel(e2eDbAvailability.connected, e2eDbConfigured),
      },
      distinctTargets: dbTargetsDistinct,
    },
    port3000: {
      status: portStatus.status,
      pid: portStatus.pid,
      processName: portStatus.processName,
      commandLine: sanitizedCommandLine,
      ownerWorktree: ownership.ownerWorktree,
      sameWorktree: ownership.sameWorktree,
      sameGitRepository: ownership.sameGitRepository,
      health,
    },
    recommendedPlaywrightMode: recommendation.mode,
    recommendationReason: recommendation.reason,
    chromium,
    timestamp: new Date().toISOString(),
  };
}

export async function writePreflightSnapshot(snapshot, repositoryRoot, deps = {}) {
  const targetPath = path.join(repositoryRoot, SNAPSHOT_PATH);
  const mkdir = deps.mkdir ?? fs.mkdir;
  const writeFile = deps.writeFile ?? fs.writeFile;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return targetPath;
}

export function formatPreflightReport(snapshot) {
  const lines = [];
  lines.push("Agent preflight");
  lines.push(`Repository: ${snapshot.repository}`);
  lines.push(`Repository root: ${snapshot.repositoryRoot}`);
  lines.push(`Current worktree: ${snapshot.currentWorktree}`);
  lines.push(`Branch: ${snapshot.branch}`);
  lines.push(`HEAD: ${snapshot.head}`);
  lines.push(`Dirty files/count: ${snapshot.dirtyFileCount}`);
  lines.push(`Tracked modified files: ${snapshot.trackedModifiedFiles.length}`);
  lines.push(`Untracked files: ${snapshot.untrackedFiles.length}`);
  lines.push(
    `Main DB configured: ${snapshot.database.main.configured ? "yes" : "no"}${
      snapshot.database.main.descriptor
        ? ` (${snapshot.database.main.descriptor.host}:${snapshot.database.main.descriptor.port}/${snapshot.database.main.descriptor.database})`
        : ""
    }`,
  );
  lines.push(`Main DB availability: ${snapshot.database.main.availability}`);
  lines.push(
    `E2E DB configured: ${snapshot.database.e2e.configured ? "yes" : "no"}${
      snapshot.database.e2e.descriptor
        ? ` (${snapshot.database.e2e.descriptor.host}:${snapshot.database.e2e.descriptor.port}/${snapshot.database.e2e.descriptor.database})`
        : ""
    }`,
  );
  lines.push(`E2E DB availability: ${snapshot.database.e2e.availability}`);
  lines.push(
    `Main and E2E DB distinct: ${
      snapshot.database.distinctTargets === null
        ? "unknown"
        : snapshot.database.distinctTargets
          ? "yes"
          : "no (unsafe)"
    }`,
  );
  lines.push(`Port 3000 status: ${snapshot.port3000.status}`);
  lines.push(`Port 3000 owning PID: ${snapshot.port3000.pid ?? "(none)"}`);
  lines.push(`Owning process name: ${snapshot.port3000.processName ?? "(none)"}`);
  lines.push(`Owning process command line: ${snapshot.port3000.commandLine ?? "(unavailable)"}`);
  lines.push(`Owner worktree: ${snapshot.port3000.ownerWorktree ?? "(unavailable)"}`);
  lines.push(
    `Same worktree: ${
      snapshot.port3000.sameWorktree === null
        ? "unknown"
        : snapshot.port3000.sameWorktree
          ? "yes"
          : "no"
    }`,
  );
  lines.push(
    `Same Git repository: ${
      snapshot.port3000.sameGitRepository === null
        ? "unknown"
        : snapshot.port3000.sameGitRepository
          ? "yes"
          : "no"
    }`,
  );
  lines.push(
    `HTTP health localhost:3000: ${
      snapshot.port3000.health.status !== null
        ? `${snapshot.port3000.health.status} (${snapshot.port3000.health.ok ? "healthy" : "unhealthy"})`
        : `unreachable (${snapshot.port3000.health.error})`
    }`,
  );
  lines.push(`Recommended Playwright mode: ${snapshot.recommendedPlaywrightMode}`);
  lines.push(`Recommendation reason: ${snapshot.recommendationReason}`);
  lines.push(
    `Chromium package/runtime availability: ${snapshot.chromium.classification} (package=${snapshot.chromium.packageAvailable ? "yes" : "no"}, runtime=${snapshot.chromium.runtimeAvailable ? "yes" : "no"})`,
  );
  lines.push(`Timestamp: ${snapshot.timestamp}`);
  return lines.join("\n");
}
