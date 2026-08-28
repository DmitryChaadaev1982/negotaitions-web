import { execFileSync } from "node:child_process";
import { constants as fsConstants, type Stats } from "node:fs";
import { chmod, lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export type RuntimePermissionMode = "check" | "apply";
export type RuntimePermissionSource =
  | "tracked-file"
  | "tracked-directory"
  | "generated-prisma-file"
  | "generated-prisma-directory";

export type RuntimePermissionPathType =
  | "file"
  | "directory"
  | "symlink"
  | "other"
  | "missing";

export type RuntimePermissionIdentity = {
  dev: number;
  ino: number;
};

export type GitIndexEntry = {
  mode: string;
  path: string;
};

export type RuntimePermissionAction = {
  source: RuntimePermissionSource;
  path: string;
  currentMode: number;
  desiredMode: number;
  requiredBits?: number;
  expectedType?: "file" | "directory";
  identity?: RuntimePermissionIdentity;
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
      | "RUNTIME_PERMISSION_SYMLINK"
      | "RUNTIME_PERMISSION_TYPE_CHANGED"
      | "RUNTIME_PERMISSION_IDENTITY_CHANGED"
      | "UNSAFE_RUNTIME_PERMISSION_PATH"
      | "UNSAFE_GENERATED_PRISMA_ARTIFACT"
      | "GIT_COMMAND_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "RuntimePermissionError";
  }
}

const GENERATED_PRISMA_ANCESTORS = ["app", "app/generated"] as const;
const GENERATED_PRISMA_ROOT = "app/generated/prisma";
const OTHER_READ = 0o004;
const OTHER_EXECUTE = 0o001;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ROOT_RUNTIME_FILES = new Set(["package.json", "tsconfig.json"]);
// Reviewed transitive source dependencies of scripts/ops/*.ts. Keep this list
// explicit: selecting all of lib/** would make unrelated application source
// world-readable during a restrictive production deployment.
const LIB_RUNTIME_SOURCE_FILES = new Set([
  "lib/audio/config.ts",
  "lib/auth/credential-dispatch-fence.ts",
  "lib/auth/password-reset-token.ts",
  "lib/config/provider-runtime.ts",
  "lib/config/server-runtime-settings.ts",
  "lib/config/session-lifecycle-settings.ts",
  "lib/email/address.ts",
  "lib/email/canary.ts",
  "lib/email/config.ts",
  "lib/email/observability.ts",
  "lib/email/operational-cli.ts",
  "lib/email/password-reset-dispatch.ts",
  "lib/email/provider-error-classification.ts",
  "lib/email/provider-event-consumer-cli.ts",
  "lib/email/provider-event-consumer.ts",
  "lib/email/provider-event-policy.ts",
  "lib/email/provider-events.ts",
  "lib/email/provider.ts",
  "lib/email/renderer.ts",
  "lib/email/retention.ts",
  "lib/email/sensitive-payload.ts",
  "lib/email/suppression.ts",
  "lib/email/templates.ts",
  "lib/email/types.ts",
  "lib/email/worker.ts",
  "lib/email/yandex-postbox-provider-event-parser.ts",
  "lib/env.ts",
  "lib/livekit-egress.ts",
  "lib/livekit-participant-metadata.ts",
  "lib/livekit.ts",
  "lib/legacy-session-terminal-normalization.ts",
  "lib/operational-env.ts",
  "lib/prisma-connection-string.ts",
  "lib/prisma-production-migration-overlay.ts",
  "lib/prisma.ts",
  "lib/recording/recording-attempt-fencing.ts",
  "lib/recording-stop-delivery-policy.ts",
  "lib/recording/provider.ts",
  "lib/room-provider/types.ts",
  "lib/runtime-permissions.ts",
  "lib/services/error-classifier.ts",
  "lib/services/external-service-events.ts",
  "lib/services/usage-counters.ts",
  "lib/negotiation-control.ts",
  "lib/session-completion-core.ts",
  "lib/session-completion.ts",
  "lib/session-empty-room-reconciliation.ts",
  "lib/session-lifecycle-candidate-selection.ts",
  "lib/session-lifecycle-concurrency-hooks.ts",
  "lib/session-lifecycle-observability.ts",
  "lib/session-lifecycle-policy.ts",
  "lib/session-lifecycle-sql.ts",
  "lib/session-pause-intervals.ts",
  "lib/session-room-lifecycle.ts",
  "lib/session-room-occupancy-policy.ts",
  "lib/session-room-occupancy.ts",
  "lib/sql-utc-wall-clock.ts",
  "lib/stage-3-10-maintenance-utils.ts",
  "lib/stage-3-10-maintenance.ts",
  "lib/storage/s3.ts",
  "lib/test-mode.ts",
  "lib/voximplant/conference-name.ts",
  "lib/voximplant/config-settings.ts",
  "lib/voximplant/config.ts",
  "lib/voximplant/management-api-core.ts",
  "lib/voximplant/orphan-user-cleanup-io.ts",
  "lib/voximplant/orphan-user-cleanup.ts",
  "lib/voximplant/provider-fault-simulation.ts",
  "lib/voximplant/recording-control-signature.ts",
  "lib/voximplant/recording-dispatch-contract.ts",
  "lib/voximplant/recording-dispatch.ts",
  "lib/voximplant/recording-reconciliation-policy.ts",
  "lib/voximplant/recording-reconciliation.ts",
  "lib/voximplant/recording-status-fencing.ts",
  "lib/voximplant/recording-webhook-url-resolve.ts",
  "lib/voximplant/recording-webhook-url-store.ts",
  "lib/voximplant/recording-webhook-url.ts",
  "lib/voximplant/scenario-messages.ts",
  "lib/voximplant/server-stop-callback-signature.ts",
  "lib/voximplant/server-stop-client.ts",
  "lib/voximplant/server-stop-config.ts",
  "lib/voximplant/server-stop-replay-store.ts",
  "lib/voximplant/server-stop-replay.ts",
  "lib/voximplant/server-stop-settings.ts",
  "lib/voximplant/types.ts",
  "lib/voximplant/username.ts",
]);
const LIB_RUNTIME_SOURCE_DIRECTORIES = new Set([
  "lib",
  ...[...LIB_RUNTIME_SOURCE_FILES].flatMap((repoPath) => {
    const parts = repoPath.split("/");
    return parts.slice(1, -1).map((_, index) => parts.slice(0, index + 2).join("/"));
  }),
]);
const GENERATED_PRISMA_ROOT_FILES = new Set([
  "browser.ts",
  "client.ts",
  "commonInputTypes.ts",
  "enums.ts",
  "models.ts",
]);
const GENERATED_PRISMA_INTERNAL_FILES = new Set([
  "class.ts",
  "prismaNamespace.ts",
  "prismaNamespaceBrowser.ts",
]);
const PRIVATE_KEY_BASENAMES = new Set([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

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

function isPathWithin(repoPath: string, parent: string): boolean {
  return repoPath === parent || repoPath.startsWith(`${parent}/`);
}

function hasRuntimeSourceExtension(repoPath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.posix.extname(repoPath));
}

function isTestSourcePath(repoPath: string): boolean {
  const basename = path.posix.basename(repoPath).toLowerCase();
  return (
    basename.endsWith(".test.ts") ||
    basename.endsWith(".test.tsx") ||
    basename.endsWith(".spec.ts") ||
    basename.endsWith(".spec.tsx")
  );
}

function isSourceCodePath(repoPath: string): boolean {
  if (!hasRuntimeSourceExtension(repoPath) || isTestSourcePath(repoPath)) {
    return false;
  }
  return isPathWithin(repoPath, "scripts/ops") || isPathWithin(repoPath, "lib");
}

function isReviewedRuntimeSourcePath(repoPath: string): boolean {
  if (!hasRuntimeSourceExtension(repoPath) || isTestSourcePath(repoPath)) {
    return false;
  }
  return isPathWithin(repoPath, "scripts/ops") ||
    LIB_RUNTIME_SOURCE_FILES.has(repoPath);
}

export function isTrackedRuntimePermissionPath(repoPath: string): boolean {
  const normalized = normalizeRepoPath(repoPath);
  if (ROOT_RUNTIME_FILES.has(normalized)) return true;
  return isReviewedRuntimeSourcePath(normalized);
}

export function isTrackedRuntimePermissionDirectory(repoPath: string): boolean {
  const normalized = normalizeRepoPath(repoPath);
  return (
    normalized === "scripts" ||
    normalized === "scripts/ops" ||
    normalized.startsWith("scripts/ops/") ||
    LIB_RUNTIME_SOURCE_DIRECTORIES.has(normalized)
  );
}

function hasBackupOrTemporaryMarker(lowerBasename: string): boolean {
  return (
    lowerBasename.endsWith("~") ||
    lowerBasename.endsWith(".bak") ||
    lowerBasename.endsWith(".backup") ||
    lowerBasename.endsWith(".orig") ||
    lowerBasename.endsWith(".old") ||
    lowerBasename.endsWith(".tmp") ||
    lowerBasename.endsWith(".temp") ||
    lowerBasename.endsWith(".swp")
  );
}

function hasSensitiveCredentialMarker(normalized: string): boolean {
  const lowerPath = normalized.toLowerCase();
  const lowerBasename = path.posix.basename(lowerPath);
  const lowerExt = path.posix.extname(lowerBasename);
  const segments = lowerPath.split("/");

  if (PRIVATE_KEY_BASENAMES.has(lowerBasename)) return true;
  if (
    lowerBasename === "credentials.json" ||
    lowerBasename === "credential.json" ||
    lowerBasename.endsWith(".credentials.json") ||
    lowerBasename.endsWith(".credential.json") ||
    lowerExt === ".key" ||
    lowerExt === ".pem" ||
    lowerExt === ".p12" ||
    lowerExt === ".pfx"
  ) {
    return true;
  }
  if (segments.some((segment) => segment === "secrets" || segment === "credentials")) {
    return true;
  }

  return /(^|[-_.])(secret|secrets|credential|credentials|token|tokens|api-token|private-key)([-_.]|$)/.test(
    lowerBasename,
  );
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
  if (hasBackupOrTemporaryMarker(lowerBasename)) return true;
  if (hasSensitiveCredentialMarker(normalized)) {
    return !isSourceCodePath(normalized);
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
  if (!isTrackedRuntimePermissionPath(repoPath)) return null;
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
    requiredBits,
    expectedType: "file",
  };
}

export function planDirectoryTraversePermission(
  repoPath: string,
  currentMode: number,
  source: "tracked-directory" | "generated-prisma-directory",
): RuntimePermissionAction | null {
  const normalized = normalizeRepoPath(repoPath);
  if (isRuntimePermissionExcludedPath(normalized)) return null;
  if (
    source === "tracked-directory" &&
    !isTrackedRuntimePermissionDirectory(normalized)
  ) {
    return null;
  }
  if (source === "generated-prisma-directory") {
    assertGeneratedPrismaArtifactAllowed(normalized, "directory");
  }
  const desiredMode = computeRuntimePermissionMode(currentMode, OTHER_EXECUTE);
  if (desiredMode === (currentMode & 0o7777)) return null;
  return {
    source,
    path: normalized,
    currentMode: currentMode & 0o7777,
    desiredMode,
    requiredBits: OTHER_EXECUTE,
    expectedType: "directory",
  };
}

export function planGeneratedPrismaFilePermission(
  repoPath: string,
  currentMode: number,
): RuntimePermissionAction | null {
  const normalized = normalizeRepoPath(repoPath);
  assertGeneratedPrismaArtifactAllowed(normalized, "file");
  const desiredMode = computeRuntimePermissionMode(currentMode, OTHER_READ);
  if (desiredMode === (currentMode & 0o7777)) return null;
  return {
    source: "generated-prisma-file",
    path: normalized,
    currentMode: currentMode & 0o7777,
    desiredMode,
    requiredBits: OTHER_READ,
    expectedType: "file",
  };
}

export function assertGeneratedPrismaArtifactAllowed(
  repoPath: string,
  type: RuntimePermissionPathType,
): void {
  const normalized = normalizeRepoPath(repoPath);
  if (
    !GENERATED_PRISMA_ANCESTORS.some((ancestor) => ancestor === normalized) &&
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
  if (type === "missing") return;

  const allowedDirectories = new Set([
    ...GENERATED_PRISMA_ANCESTORS,
    GENERATED_PRISMA_ROOT,
    `${GENERATED_PRISMA_ROOT}/internal`,
    `${GENERATED_PRISMA_ROOT}/models`,
  ]);
  if (type === "directory") {
    if (allowedDirectories.has(normalized)) return;
    throw new RuntimePermissionError(
      "UNSAFE_GENERATED_PRISMA_ARTIFACT",
      `Generated Prisma tree contains an unexpected directory: ${normalized}`,
    );
  }

  if (type !== "file") {
    throw new RuntimePermissionError(
      "UNSAFE_GENERATED_PRISMA_ARTIFACT",
      `Generated Prisma tree contains an unsupported artifact: ${normalized}`,
    );
  }
  if (isRuntimePermissionExcludedPath(normalized)) {
    throw new RuntimePermissionError(
      "UNSAFE_GENERATED_PRISMA_ARTIFACT",
      `Generated Prisma tree contains suspicious artifact: ${normalized}`,
    );
  }

  const relative = normalized.slice(`${GENERATED_PRISMA_ROOT}/`.length);
  const dirname = path.posix.dirname(relative);
  const basename = path.posix.basename(relative);
  const lowerBasename = basename.toLowerCase();
  if (
    basename.startsWith(".") ||
    hasBackupOrTemporaryMarker(lowerBasename) ||
    hasSensitiveCredentialMarker(normalized)
  ) {
    throw new RuntimePermissionError(
      "UNSAFE_GENERATED_PRISMA_ARTIFACT",
      `Generated Prisma tree contains suspicious artifact: ${normalized}`,
    );
  }
  if (dirname === "." && GENERATED_PRISMA_ROOT_FILES.has(basename)) return;
  if (dirname === "internal" && GENERATED_PRISMA_INTERNAL_FILES.has(basename)) {
    return;
  }
  if (
    dirname === "models" &&
    path.posix.extname(basename) === ".ts" &&
    !isTestSourcePath(basename)
  ) {
    return;
  }

  throw new RuntimePermissionError(
    "UNSAFE_GENERATED_PRISMA_ARTIFACT",
    `Generated Prisma tree contains an unexpected file: ${normalized}`,
  );
}

export const assertGeneratedPrismaPathType = assertGeneratedPrismaArtifactAllowed;

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
    if (!isTrackedRuntimePermissionPath(entry.path)) continue;
    const parts = normalizeRepoPath(entry.path).split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const directory = parts.slice(0, index).join("/");
      if (isTrackedRuntimePermissionDirectory(directory)) {
        directories.add(directory);
      }
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

function identityFromStats(stats: Stats): RuntimePermissionIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(left: RuntimePermissionIdentity, right: RuntimePermissionIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function typeFromStats(stats: Stats): Exclude<RuntimePermissionPathType, "missing"> {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  return "other";
}

function isResolvedInside(resolvedRoot: string, resolvedTarget: string): boolean {
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertResolvedLocationInsideRoot(
  resolvedRoot: string,
  resolvedTarget: string,
  repoPath: string,
): void {
  if (!isResolvedInside(resolvedRoot, resolvedTarget)) {
    throw new RuntimePermissionError(
      "PATH_OUTSIDE_REPOSITORY",
      `Refusing path outside allowed runtime scope: ${repoPath}`,
    );
  }
}

type RuntimePathInspection = {
  absolutePath: string;
  mode: number;
  type: RuntimePermissionPathType;
  identity?: RuntimePermissionIdentity;
};

function isErrno(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === code;
}

async function inspectRuntimePath(
  repoRoot: string,
  repoPath: string,
  options: {
    expectedType?: "file" | "directory";
    allowedRootRepoPath?: string;
  } = {},
): Promise<RuntimePathInspection> {
  const normalized = normalizeRepoPath(repoPath);
  const rootAbsolute = path.resolve(repoRoot);
  const absolutePath = resolveInsideRepo(rootAbsolute, normalized);
  const parts = normalized.split("/");
  let current = rootAbsolute;
  let stats: Stats | null = null;

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      stats = await lstat(current);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return { absolutePath, mode: 0, type: "missing" };
      }
      throw error;
    }

    const type = typeFromStats(stats);
    if (type === "symlink") {
      throw new RuntimePermissionError(
        "RUNTIME_PERMISSION_SYMLINK",
        `Runtime permission path contains a symlink: ${normalized}`,
      );
    }
    if (index < parts.length - 1 && type !== "directory") {
      throw new RuntimePermissionError(
        "RUNTIME_PERMISSION_TYPE_CHANGED",
        `Runtime permission path component is not a directory: ${normalized}`,
      );
    }
  }

  if (!stats) return { absolutePath, mode: 0, type: "missing" };
  const type = typeFromStats(stats);
  if (options.expectedType && type !== options.expectedType) {
    throw new RuntimePermissionError(
      "RUNTIME_PERMISSION_TYPE_CHANGED",
      `Runtime permission path type changed: ${normalized}`,
    );
  }

  const targetRealPath = await realpath(absolutePath);
  const allowedRootAbsolute = options.allowedRootRepoPath
    ? resolveInsideRepo(rootAbsolute, options.allowedRootRepoPath)
    : rootAbsolute;
  const allowedRootRealPath = await realpath(allowedRootAbsolute);
  assertResolvedLocationInsideRoot(allowedRootRealPath, targetRealPath, normalized);

  return {
    absolutePath,
    mode: modeForPermissionPlanning(stats.mode, type),
    type,
    identity: identityFromStats(stats),
  };
}

function attachInspection(
  action: RuntimePermissionAction,
  inspection: RuntimePathInspection,
): RuntimePermissionAction {
  return {
    ...action,
    currentMode: inspection.mode & 0o7777,
    desiredMode: computeRuntimePermissionMode(
      inspection.mode,
      requiredBitsForAction(action),
    ),
    expectedType: action.expectedType ?? expectedTypeForAction(action),
    identity: inspection.identity,
  };
}

function expectedTypeForAction(action: RuntimePermissionAction): "file" | "directory" {
  return action.source === "tracked-directory" ||
    action.source === "generated-prisma-directory"
    ? "directory"
    : "file";
}

function requiredBitsForAction(action: RuntimePermissionAction): number {
  if (typeof action.requiredBits === "number") return action.requiredBits;
  if (expectedTypeForAction(action) === "directory") return OTHER_EXECUTE;
  return action.desiredMode & (OTHER_READ | OTHER_EXECUTE);
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

async function collectGeneratedPrismaActions(
  repoRoot: string,
  summary: RuntimePermissionSummary,
): Promise<RuntimePermissionAction[]> {
  const ancestorStatuses: Array<{
    repoPath: (typeof GENERATED_PRISMA_ANCESTORS)[number];
    status: RuntimePathInspection;
  }> = [];
  for (const repoPath of GENERATED_PRISMA_ANCESTORS) {
    const status = await inspectRuntimePath(repoRoot, repoPath, {
      allowedRootRepoPath: repoPath,
    });
    try {
      assertGeneratedPrismaArtifactAllowed(repoPath, status.type);
    } catch (error) {
      summary.generatedPrismaSymlinksRejected += 1;
      throw error;
    }
    ancestorStatuses.push({ repoPath, status });
  }

  const rootStatus = await inspectRuntimePath(repoRoot, GENERATED_PRISMA_ROOT, {
    allowedRootRepoPath: GENERATED_PRISMA_ROOT,
  });
  if (rootStatus.type === "missing") return [];
  summary.generatedPrismaExists = true;
  try {
    assertGeneratedPrismaArtifactAllowed(GENERATED_PRISMA_ROOT, rootStatus.type);
  } catch (error) {
    summary.generatedPrismaSymlinksRejected += 1;
    throw error;
  }

  const actions: RuntimePermissionAction[] = [];
  for (const { repoPath, status } of ancestorStatuses) {
    if (status.type !== "directory") continue;
    summary.generatedPrismaDirectoriesChecked += 1;
    const ancestorAction = planDirectoryTraversePermission(
      repoPath,
      status.mode,
      "generated-prisma-directory",
    );
    if (ancestorAction) {
      summary.generatedPrismaDirectoriesNeedingChange += 1;
      actions.push(attachInspection(ancestorAction, status));
    }
  }

  const queue = [GENERATED_PRISMA_ROOT];
  while (queue.length > 0) {
    const repoPath = queue.shift() as string;
    const status = await inspectRuntimePath(repoRoot, repoPath, {
      allowedRootRepoPath: GENERATED_PRISMA_ROOT,
    });
    try {
      assertGeneratedPrismaArtifactAllowed(repoPath, status.type);
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
        actions.push(attachInspection(action, status));
      }
      const names = await readdir(status.absolutePath);
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
        actions.push(attachInspection(action, status));
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
    if (!isTrackedRuntimePermissionPath(entry.path)) {
      summary.trackedExcludedSkipped += 1;
      continue;
    }
    if (entry.mode === "120000") {
      summary.trackedSymlinksSkipped += 1;
      continue;
    }
    if (entry.mode !== "100644" && entry.mode !== "100755") continue;

    const status = await inspectRuntimePath(repoRoot, entry.path, {
      expectedType: "file",
    });
    if (status.type !== "file") continue;
    summary.trackedFilesChecked += 1;
    const action = planTrackedFilePermission(entry, status.mode);
    if (action) {
      summary.trackedFilesNeedingChange += 1;
      actions.push(attachInspection(action, status));
    }
  }

  for (const repoPath of trackedParentDirectories(entries)) {
    const status = await inspectRuntimePath(repoRoot, repoPath, {
      expectedType: "directory",
    });
    if (status.type !== "directory") continue;
    summary.trackedDirectoriesChecked += 1;
    const action = planDirectoryTraversePermission(
      repoPath,
      status.mode,
      "tracked-directory",
    );
    if (action) {
      summary.trackedDirectoriesNeedingChange += 1;
      actions.push(attachInspection(action, status));
    }
  }

  actions.push(...(await collectGeneratedPrismaActions(repoRoot, summary)));

  return { actions, summary };
}

function allowedRootForAction(action: RuntimePermissionAction): string | undefined {
  if (
    action.source === "generated-prisma-file" ||
    (action.source === "generated-prisma-directory" &&
      !GENERATED_PRISMA_ANCESTORS.some((ancestor) => ancestor === action.path))
  ) {
    return GENERATED_PRISMA_ROOT;
  }
  if (action.source === "generated-prisma-directory") {
    return action.path;
  }
  return undefined;
}

function validateActionPolicy(action: RuntimePermissionAction): void {
  const normalized = normalizeRepoPath(action.path);
  if (action.source === "tracked-file") {
    if (
      isRuntimePermissionExcludedPath(normalized) ||
      !isTrackedRuntimePermissionPath(normalized)
    ) {
      throw new RuntimePermissionError(
        "UNSAFE_RUNTIME_PERMISSION_PATH",
        `Refusing tracked runtime permission path: ${normalized}`,
      );
    }
    return;
  }
  if (action.source === "tracked-directory") {
    if (
      isRuntimePermissionExcludedPath(normalized) ||
      !isTrackedRuntimePermissionDirectory(normalized)
    ) {
      throw new RuntimePermissionError(
        "UNSAFE_RUNTIME_PERMISSION_PATH",
        `Refusing tracked runtime permission directory: ${normalized}`,
      );
    }
    return;
  }
  assertGeneratedPrismaArtifactAllowed(normalized, expectedTypeForAction(action));
}

function assertPlannedIdentityStillMatches(
  action: RuntimePermissionAction,
  inspection: RuntimePathInspection,
): void {
  if (!action.identity || !inspection.identity) return;
  if (!sameIdentity(action.identity, inspection.identity)) {
    throw new RuntimePermissionError(
      "RUNTIME_PERMISSION_IDENTITY_CHANGED",
      `Runtime permission path identity changed before apply: ${action.path}`,
    );
  }
}

async function inspectActionForApply(
  repoRoot: string,
  action: RuntimePermissionAction,
): Promise<RuntimePathInspection> {
  validateActionPolicy(action);
  const expectedType = action.expectedType ?? expectedTypeForAction(action);
  const inspection = await inspectRuntimePath(repoRoot, action.path, {
    expectedType,
    allowedRootRepoPath: allowedRootForAction(action),
  });
  if (inspection.type === "missing") {
    throw new RuntimePermissionError(
      "RUNTIME_PERMISSION_TYPE_CHANGED",
      `Runtime permission path no longer exists: ${action.path}`,
    );
  }
  assertPlannedIdentityStillMatches(action, inspection);
  return inspection;
}

function shouldUseNoFollowDescriptor(): boolean {
  return process.platform !== "win32" && typeof fsConstants.O_NOFOLLOW === "number";
}

async function chmodWithNoFollowDescriptor(
  inspection: RuntimePathInspection,
  action: RuntimePermissionAction,
): Promise<boolean> {
  const expectedType = action.expectedType ?? expectedTypeForAction(action);
  const directoryFlag =
    expectedType === "directory" && typeof fsConstants.O_DIRECTORY === "number"
      ? fsConstants.O_DIRECTORY
      : 0;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      inspection.absolutePath,
      fsConstants.O_RDONLY | directoryFlag | fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    if (isErrno(error, "ELOOP")) {
      throw new RuntimePermissionError(
        "RUNTIME_PERMISSION_SYMLINK",
        `Runtime permission path became a symlink before apply: ${action.path}`,
      );
    }
    throw error;
  }

  try {
    const openStats = await handle.stat();
    const openType = typeFromStats(openStats);
    if (openType !== expectedType) {
      throw new RuntimePermissionError(
        "RUNTIME_PERMISSION_TYPE_CHANGED",
        `Runtime permission path type changed before chmod: ${action.path}`,
      );
    }
    if (
      inspection.identity &&
      !sameIdentity(inspection.identity, identityFromStats(openStats))
    ) {
      throw new RuntimePermissionError(
        "RUNTIME_PERMISSION_IDENTITY_CHANGED",
        `Runtime permission path identity changed before chmod: ${action.path}`,
      );
    }

    const currentMode = modeForPermissionPlanning(openStats.mode, openType) & 0o7777;
    const targetMode = computeRuntimePermissionMode(
      currentMode,
      requiredBitsForAction(action),
    );
    if (targetMode === currentMode) return false;
    await handle.chmod(targetMode);
    return true;
  } finally {
    await handle.close();
  }
}

async function chmodWithPathFallback(
  repoRoot: string,
  action: RuntimePermissionAction,
): Promise<boolean> {
  const inspection = await inspectActionForApply(repoRoot, action);
  const currentMode = inspection.mode & 0o7777;
  const targetMode = computeRuntimePermissionMode(
    currentMode,
    requiredBitsForAction(action),
  );
  if (targetMode === currentMode) return false;
  await chmod(inspection.absolutePath, targetMode);

  const after = await inspectActionForApply(repoRoot, action);
  if (
    inspection.identity &&
    after.identity &&
    !sameIdentity(inspection.identity, after.identity)
  ) {
    throw new RuntimePermissionError(
      "RUNTIME_PERMISSION_IDENTITY_CHANGED",
      `Runtime permission path identity changed during chmod: ${action.path}`,
    );
  }
  return true;
}

export async function applyRuntimePermissionPlan(
  repoRoot: string,
  actions: RuntimePermissionAction[],
  mode: RuntimePermissionMode,
): Promise<number> {
  if (mode === "check") return 0;
  let changed = 0;
  for (const action of actions) {
    const inspection = await inspectActionForApply(repoRoot, action);
    const mutated = shouldUseNoFollowDescriptor()
      ? await chmodWithNoFollowDescriptor(inspection, action)
      : await chmodWithPathFallback(repoRoot, action);
    if (mutated) changed += 1;
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
