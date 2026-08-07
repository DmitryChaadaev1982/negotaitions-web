import { execFileSync } from "node:child_process";
import { chmod, lstat, readdir } from "node:fs/promises";
import path from "node:path";

export type RuntimePermissionMode = "check" | "apply";
export type RuntimePermissionSource =
  | "tracked-file"
  | "tracked-directory"
  | "generated-prisma-file"
  | "generated-prisma-directory";

export type GitIndexEntry = {
  mode: string;
  path: string;
};

export type RuntimePermissionAction = {
  source: RuntimePermissionSource;
  path: string;
  currentMode: number;
  desiredMode: number;
};

export type RuntimePermissionPlan = {
  actions: RuntimePermissionAction[];
  summary: RuntimePermissionSummary;
};

export type RuntimePermissionSummary = {
  trackedFilesChecked: number;
  trackedFilesNeedingChange: number;
  trackedSymlinksSkipped: number;
  trackedExcludedSkipped: number;
  trackedDirectoriesChecked: number;
  trackedDirectoriesNeedingChange: number;
  generatedPrismaExists: boolean;
  generatedPrismaFilesChecked: number;
  generatedPrismaFilesNeedingChange: number;
  generatedPrismaDirectoriesChecked: number;
  generatedPrismaDirectoriesNeedingChange: number;
  generatedPrismaSymlinksRejected: number;
};

export class RuntimePermissionError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REPO_PATH"
      | "PATH_OUTSIDE_REPOSITORY"
      | "GENERATED_PRISMA_SYMLINK"
      | "GIT_COMMAND_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "RuntimePermissionError";
  }
}

const GENERATED_PRISMA_PARENT = "app/generated";
const GENERATED_PRISMA_ROOT = "app/generated/prisma";
const OTHER_READ = 0o004;
const OTHER_EXECUTE = 0o001;

function emptySummary(): RuntimePermissionSummary {
  return {
    trackedFilesChecked: 0,
    trackedFilesNeedingChange: 0,
    trackedSymlinksSkipped: 0,
    trackedExcludedSkipped: 0,
    trackedDirectoriesChecked: 0,
    trackedDirectoriesNeedingChange: 0,
    generatedPrismaExists: false,
    generatedPrismaFilesChecked: 0,
    generatedPrismaFilesNeedingChange: 0,
    generatedPrismaDirectoriesChecked: 0,
    generatedPrismaDirectoriesNeedingChange: 0,
    generatedPrismaSymlinksRejected: 0,
  };
}

export function normalizeRepoPath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new RuntimePermissionError(
      "INVALID_REPO_PATH",
      `Refusing invalid repository-relative path: ${input}`,
    );
  }
  const parts = normalized.split("/");
  if (
    parts.some((part) => part === "" || part === "." || part === "..") ||
    normalized.includes("\0")
  ) {
    throw new RuntimePermissionError(
      "INVALID_REPO_PATH",
      `Refusing invalid repository-relative path: ${input}`,
    );
  }
  return parts.join("/");
}

export function isRuntimePermissionExcludedPath(repoPath: string): boolean {
  const normalized = normalizeRepoPath(repoPath);
  const basename = path.posix.basename(normalized);
  const lowerBasename = basename.toLowerCase();
  const lowerPath = normalized.toLowerCase();

  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (normalized === ".git" || normalized.startsWith(".git/")) return true;
  if (normalized === "node_modules" || normalized.startsWith("node_modules/")) {
    return true;
  }
  if (
    lowerBasename.endsWith("~") ||
    lowerBasename.endsWith(".bak") ||
    lowerBasename.endsWith(".backup") ||
    lowerBasename.endsWith(".orig") ||
    lowerBasename.endsWith(".old")
  ) {
    return true;
  }
  if (
    lowerBasename === "credentials.json" ||
    lowerBasename === "credential.json" ||
    lowerBasename.endsWith(".credentials.json") ||
    lowerBasename.endsWith(".credential.json") ||
    lowerBasename.endsWith(".key") ||
    lowerBasename.endsWith(".pem") ||
    lowerBasename.endsWith(".p12") ||
    lowerBasename.endsWith(".pfx")
  ) {
    return true;
  }

  return lowerPath.startsWith("etc/");
}

export function computeRuntimePermissionMode(
  currentMode: number,
  requiredBits: number,
): number {
  return (currentMode & 0o7777) | requiredBits;
}

export function modeForPermissionPlanning(
  currentMode: number,
  type: "file" | "directory" | "symlink" | "other" | "missing",
  platform: NodeJS.Platform = process.platform,
): number {
  if (platform === "win32" && type === "directory") {
    // Windows does not expose POSIX directory traverse bits reliably through
    // stat(). The production chmod boundary remains Unix/Linux.
    return currentMode | 0o111;
  }
  return currentMode;
}

export function planTrackedFilePermission(
  entry: GitIndexEntry,
  currentMode: number,
): RuntimePermissionAction | null {
  const repoPath = normalizeRepoPath(entry.path);
  if (isRuntimePermissionExcludedPath(repoPath)) return null;
  if (entry.mode === "120000") return null;
  if (entry.mode !== "100644" && entry.mode !== "100755") return null;

  const requiredBits = entry.mode === "100755"
    ? OTHER_READ | OTHER_EXECUTE
    : OTHER_READ;
  const desiredMode = computeRuntimePermissionMode(currentMode, requiredBits);
  if (desiredMode === (currentMode & 0o7777)) return null;
  return {
    source: "tracked-file",
    path: repoPath,
    currentMode: currentMode & 0o7777,
    desiredMode,
  };
}

export function planDirectoryTraversePermission(
  repoPath: string,
  currentMode: number,
  source: "tracked-directory" | "generated-prisma-directory",
): RuntimePermissionAction | null {
  const normalized = normalizeRepoPath(repoPath);
  if (isRuntimePermissionExcludedPath(normalized)) return null;
  const desiredMode = computeRuntimePermissionMode(currentMode, OTHER_EXECUTE);
  if (desiredMode === (currentMode & 0o7777)) return null;
  return {
    source,
    path: normalized,
    currentMode: currentMode & 0o7777,
    desiredMode,
  };
}

export function planGeneratedPrismaFilePermission(
  repoPath: string,
  currentMode: number,
): RuntimePermissionAction | null {
  const normalized = normalizeRepoPath(repoPath);
  if (
    normalized !== GENERATED_PRISMA_ROOT &&
    !normalized.startsWith(`${GENERATED_PRISMA_ROOT}/`)
  ) {
    throw new RuntimePermissionError(
      "PATH_OUTSIDE_REPOSITORY",
      `Generated Prisma path is outside ${GENERATED_PRISMA_ROOT}: ${repoPath}`,
    );
  }
  const desiredMode = computeRuntimePermissionMode(currentMode, OTHER_READ);
  if (desiredMode === (currentMode & 0o7777)) return null;
  return {
    source: "generated-prisma-file",
    path: normalized,
    currentMode: currentMode & 0o7777,
    desiredMode,
  };
}

export function assertGeneratedPrismaPathType(
  repoPath: string,
  type: "file" | "directory" | "symlink" | "other" | "missing",
): void {
  const normalized = normalizeRepoPath(repoPath);
  if (
    normalized !== GENERATED_PRISMA_PARENT &&
    normalized !== GENERATED_PRISMA_ROOT &&
    !normalized.startsWith(`${GENERATED_PRISMA_ROOT}/`)
  ) {
    throw new RuntimePermissionError(
      "PATH_OUTSIDE_REPOSITORY",
      `Generated Prisma path is outside ${GENERATED_PRISMA_ROOT}: ${repoPath}`,
    );
  }
  if (type === "symlink") {
    throw new RuntimePermissionError(
      "GENERATED_PRISMA_SYMLINK",
      `Generated Prisma tree contains a symlink: ${normalized}`,
    );
  }
}

export function parseGitIndexEntries(output: Buffer | string): GitIndexEntry[] {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : output;
  return text
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d{6}) [0-9a-fA-F]+ \d+\t(.+)$/.exec(record);
      if (!match) {
        throw new RuntimePermissionError(
          "GIT_COMMAND_FAILED",
          "Could not parse git index metadata.",
        );
      }
      return { mode: match[1], path: normalizeRepoPath(match[2]) };
    });
}

export function trackedParentDirectories(entries: GitIndexEntry[]): string[] {
  const directories = new Set<string>();
  for (const entry of entries) {
    if (entry.mode === "120000") continue;
    if (entry.mode !== "100644" && entry.mode !== "100755") continue;
    if (isRuntimePermissionExcludedPath(entry.path)) continue;
    const parts = normalizeRepoPath(entry.path).split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return [...directories].sort();
}

export function resolveInsideRepo(repoRoot: string, repoPath: string): string {
  const normalized = normalizeRepoPath(repoPath);
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedPath = path.resolve(resolvedRoot, ...normalized.split("/"));
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new RuntimePermissionError(
      "PATH_OUTSIDE_REPOSITORY",
      `Refusing path outside repository: ${repoPath}`,
    );
  }
  return resolvedPath;
}

export function discoverRepoRoot(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new RuntimePermissionError(
      "GIT_COMMAND_FAILED",
      error instanceof Error ? error.message : "Could not discover repository root.",
    );
  }
}

async function lstatMode(repoRoot: string, repoPath: string): Promise<{
  mode: number;
  type: "file" | "directory" | "symlink" | "other" | "missing";
}> {
  try {
    const stats = await lstat(resolveInsideRepo(repoRoot, repoPath));
    if (stats.isSymbolicLink()) {
      return { mode: modeForPermissionPlanning(stats.mode, "symlink"), type: "symlink" };
    }
    if (stats.isFile()) {
      return { mode: modeForPermissionPlanning(stats.mode, "file"), type: "file" };
    }
    if (stats.isDirectory()) {
      return {
        mode: modeForPermissionPlanning(stats.mode, "directory"),
        type: "directory",
      };
    }
    return { mode: modeForPermissionPlanning(stats.mode, "other"), type: "other" };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { mode: 0, type: "missing" };
    }
    throw error;
  }
}

async function collectGeneratedPrismaActions(
  repoRoot: string,
  summary: RuntimePermissionSummary,
): Promise<RuntimePermissionAction[]> {
  const parentStatus = await lstatMode(repoRoot, GENERATED_PRISMA_PARENT);
  try {
    assertGeneratedPrismaPathType(GENERATED_PRISMA_PARENT, parentStatus.type);
  } catch (error) {
    summary.generatedPrismaSymlinksRejected += 1;
    throw error;
  }

  const rootStatus = await lstatMode(repoRoot, GENERATED_PRISMA_ROOT);
  if (rootStatus.type === "missing") return [];
  summary.generatedPrismaExists = true;
  try {
    assertGeneratedPrismaPathType(GENERATED_PRISMA_ROOT, rootStatus.type);
  } catch (error) {
    summary.generatedPrismaSymlinksRejected += 1;
    throw error;
  }

  const actions: RuntimePermissionAction[] = [];
  if (parentStatus.type === "directory") {
    summary.generatedPrismaDirectoriesChecked += 1;
    const parentAction = planDirectoryTraversePermission(
      GENERATED_PRISMA_PARENT,
      parentStatus.mode,
      "generated-prisma-directory",
    );
    if (parentAction) {
      summary.generatedPrismaDirectoriesNeedingChange += 1;
      actions.push(parentAction);
    }
  }

  const queue = [GENERATED_PRISMA_ROOT];
  while (queue.length > 0) {
    const repoPath = queue.shift() as string;
    const status = await lstatMode(repoRoot, repoPath);
    try {
      assertGeneratedPrismaPathType(repoPath, status.type);
    } catch (error) {
      summary.generatedPrismaSymlinksRejected += 1;
      throw error;
    }

    if (status.type === "directory") {
      summary.generatedPrismaDirectoriesChecked += 1;
      const action = planDirectoryTraversePermission(
        repoPath,
        status.mode,
        "generated-prisma-directory",
      );
      if (action) {
        summary.generatedPrismaDirectoriesNeedingChange += 1;
        actions.push(action);
      }
      const names = await readdir(resolveInsideRepo(repoRoot, repoPath));
      for (const name of names) {
        queue.push(`${repoPath}/${name}`);
      }
      continue;
    }

    if (status.type === "file") {
      summary.generatedPrismaFilesChecked += 1;
      const action = planGeneratedPrismaFilePermission(repoPath, status.mode);
      if (action) {
        summary.generatedPrismaFilesNeedingChange += 1;
        actions.push(action);
      }
    }
  }

  return actions;
}

export async function buildRuntimePermissionPlan(
  repoRoot: string,
): Promise<RuntimePermissionPlan> {
  const summary = emptySummary();
  const actions: RuntimePermissionAction[] = [];
  const indexOutput = execFileSync("git", ["ls-files", "-z", "--stage"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entries = parseGitIndexEntries(indexOutput);

  for (const entry of entries) {
    if (isRuntimePermissionExcludedPath(entry.path)) {
      summary.trackedExcludedSkipped += 1;
      continue;
    }
    if (entry.mode === "120000") {
      summary.trackedSymlinksSkipped += 1;
      continue;
    }
    if (entry.mode !== "100644" && entry.mode !== "100755") continue;

    const status = await lstatMode(repoRoot, entry.path);
    if (status.type !== "file") continue;
    summary.trackedFilesChecked += 1;
    const action = planTrackedFilePermission(entry, status.mode);
    if (action) {
      summary.trackedFilesNeedingChange += 1;
      actions.push(action);
    }
  }

  for (const repoPath of trackedParentDirectories(entries)) {
    const status = await lstatMode(repoRoot, repoPath);
    if (status.type !== "directory") continue;
    summary.trackedDirectoriesChecked += 1;
    const action = planDirectoryTraversePermission(
      repoPath,
      status.mode,
      "tracked-directory",
    );
    if (action) {
      summary.trackedDirectoriesNeedingChange += 1;
      actions.push(action);
    }
  }

  actions.push(...(await collectGeneratedPrismaActions(repoRoot, summary)));

  return { actions, summary };
}

export async function applyRuntimePermissionPlan(
  repoRoot: string,
  actions: RuntimePermissionAction[],
  mode: RuntimePermissionMode,
): Promise<number> {
  if (mode === "check") return 0;
  let changed = 0;
  for (const action of actions) {
    await chmod(resolveInsideRepo(repoRoot, action.path), action.desiredMode);
    changed += 1;
  }
  return changed;
}

export async function executeRuntimePermissionNormalization(
  mode: RuntimePermissionMode,
  cwd = process.cwd(),
): Promise<{
  ok: boolean;
  mode: RuntimePermissionMode;
  repoRoot: string;
  changed: number;
  summary: RuntimePermissionSummary;
}> {
  const repoRoot = discoverRepoRoot(cwd);
  const plan = await buildRuntimePermissionPlan(repoRoot);
  const changed = await applyRuntimePermissionPlan(repoRoot, plan.actions, mode);
  return {
    ok: mode === "apply" || plan.actions.length === 0,
    mode,
    repoRoot,
    changed,
    summary: plan.summary,
  };
}
