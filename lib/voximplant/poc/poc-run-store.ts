import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const POC_RUNS_DIR_RELATIVE = ".agent/voximplant-server-stop";
export const POC_CURRENT_POINTER_RELATIVE =
  ".agent/voximplant-server-stop/current.json";
/** Legacy single-file state (pre run-store). Read-only fallback. */
export const POC_LEGACY_STATE_RELATIVE = ".agent/voximplant-server-stop-poc.json";

export type PocCurrentPointer = {
  runId: string;
  activatedAt: string;
  linkedSessionId: string | null;
};

export type PocRunPaths = {
  root: string;
  runId: string;
  runDir: string;
  statePath: string;
  reportPath: string;
  eventsPath: string;
  logPath: string;
  cleanupManifestPath: string;
};

function findPocRepositoryRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 24; i++) {
    const packageJson = join(dir, "package.json");
    const pocLib = join(dir, "lib", "voximplant", "poc");
    if (existsSync(packageJson) && existsSync(pocLib)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Shared repository-root resolver (kept here to avoid circular imports). */
export function resolvePocRepositoryRoot(
  startDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.VOXIMPLANT_SERVER_STOP_POC_STATE_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return findPocRepositoryRoot(startDir) ?? resolve(startDir);
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, payload, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmpPath, path);
  } catch {
    writeFileSync(path, payload, { encoding: "utf8", mode: 0o600 });
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may ignore POSIX mode bits.
  }
}

export function resolvePocStateRoot(
  stateRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (stateRoot !== undefined) return resolve(stateRoot);
  return resolvePocRepositoryRoot(process.cwd(), env);
}

export function getPocRunsDir(stateRoot?: string): string {
  return join(resolvePocStateRoot(stateRoot), POC_RUNS_DIR_RELATIVE, "runs");
}

export function getPocCurrentPointerPath(stateRoot?: string): string {
  return join(resolvePocStateRoot(stateRoot), POC_CURRENT_POINTER_RELATIVE);
}

export function getPocLegacyStatePath(stateRoot?: string): string {
  return join(resolvePocStateRoot(stateRoot), POC_LEGACY_STATE_RELATIVE);
}

export function getPocRunPaths(runId: string, stateRoot?: string): PocRunPaths {
  const root = resolvePocStateRoot(stateRoot);
  const runDir = join(root, POC_RUNS_DIR_RELATIVE, "runs", runId);
  return {
    root,
    runId,
    runDir,
    statePath: join(runDir, "state.json"),
    reportPath: join(runDir, "report.json"),
    eventsPath: join(runDir, "events.json"),
    logPath: join(runDir, "voximplant.log.sanitized.txt"),
    cleanupManifestPath: join(runDir, "cleanup-manifest.json"),
  };
}

export function readCurrentPointer(
  stateRoot?: string,
): PocCurrentPointer | null {
  const path = getPocCurrentPointerPath(stateRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PocCurrentPointer>;
    if (!parsed || typeof parsed.runId !== "string" || !parsed.runId.trim()) {
      return null;
    }
    return {
      runId: parsed.runId.trim(),
      activatedAt:
        typeof parsed.activatedAt === "string"
          ? parsed.activatedAt
          : new Date(0).toISOString(),
      linkedSessionId:
        typeof parsed.linkedSessionId === "string"
          ? parsed.linkedSessionId
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Atomically activate the run pointer so the access route can bind the Session
 * without env edits or Next.js restart.
 */
export function activatePocRun(params: {
  runId: string;
  linkedSessionId?: string | null;
  stateRoot?: string;
  activatedAt?: string;
}): PocCurrentPointer {
  const pointer: PocCurrentPointer = {
    runId: params.runId,
    activatedAt: params.activatedAt ?? new Date().toISOString(),
    linkedSessionId: params.linkedSessionId ?? null,
  };
  const paths = getPocRunPaths(params.runId, params.stateRoot);
  mkdirSync(paths.runDir, { recursive: true });
  atomicWriteJson(getPocCurrentPointerPath(params.stateRoot), pointer);
  return pointer;
}

export function clearCurrentPointer(stateRoot?: string): boolean {
  const path = getPocCurrentPointerPath(stateRoot);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function listPocRunIds(stateRoot?: string): string[] {
  const dir = getPocRunsDir(stateRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resolveActiveRunPaths(stateRoot?: string): PocRunPaths | null {
  const pointer = readCurrentPointer(stateRoot);
  if (!pointer) return null;
  return getPocRunPaths(pointer.runId, stateRoot);
}

export function ensurePocRunDir(runId: string, stateRoot?: string): PocRunPaths {
  const paths = getPocRunPaths(runId, stateRoot);
  mkdirSync(paths.runDir, { recursive: true });
  return paths;
}

export function writeJsonArtifact(
  path: string,
  value: unknown,
): void {
  atomicWriteJson(path, value);
}

export function writeTextArtifact(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, text, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmpPath, path);
  } catch {
    writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}
