import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getPocLegacyStatePath,
  POC_CURRENT_POINTER_RELATIVE,
  POC_LEGACY_STATE_RELATIVE,
  POC_RUNS_DIR_RELATIVE,
  resolveActiveRunPaths,
  resolvePocRepositoryRoot,
  resolvePocStateRoot,
} from "@/lib/voximplant/poc/poc-run-store";

/** @deprecated Prefer run-scoped state under `.agent/voximplant-server-stop/`. */
export const POC_STATE_RELATIVE_PATH = POC_LEGACY_STATE_RELATIVE;
export const POC_WORKTREE_MARKER = "voximplant-server-stop-poc";
export { POC_CURRENT_POINTER_RELATIVE, POC_RUNS_DIR_RELATIVE };

/**
 * Resolve the repository root used for default POC ignored state.
 * Prefers VOXIMPLANT_SERVER_STOP_POC_STATE_ROOT, then walks from startDir
 * looking for package.json + lib/voximplant/poc.
 */
export function getPocRepositoryRoot(
  startDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolvePocRepositoryRoot(startDir, env);
}

/**
 * Absolute path to the active run's `state.json`.
 *
 * - When an active run pointer exists, returns that run's state path.
 * - When omitted / missing pointer, falls back to legacy single-file path for
 *   migration compatibility (read) and first-write bootstrap.
 */
export function getPocStatePath(
  stateRoot?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = resolvePocStateRoot(stateRoot, env);
  const active = resolveActiveRunPaths(root);
  if (active) return active.statePath;
  return getPocLegacyStatePath(root);
}

/** SHA-256 hex prefix of a secret (never log the secret itself). */
export function fingerprintSecretPrefix(secret: string, chars = 12): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, chars);
}

export type PocWorktreeDiagnostic = {
  worktreeFingerprint: string;
  branchOrBuildId: string;
  callbackEnabled: boolean;
  classificationHint: "EXACT_POC_WORKTREE" | "SIBLING_WORKTREE" | "UNKNOWN_PROCESS";
};

/**
 * Sanitized worktree/build identity for POC diagnostics.
 * Does not include absolute filesystem paths.
 */
export function getPocWorktreeDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
  root: string = getPocRepositoryRoot(process.cwd(), env),
): PocWorktreeDiagnostic {
  const raw = env.VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED?.trim().toLowerCase();
  const callbackEnabled = raw === "true" || raw === "1" || raw === "yes";

  let packageName = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: string;
    };
    packageName = pkg.name ?? "unknown";
  } catch {
    // ignore
  }

  const rootBase = root.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "unknown";
  const branchOrBuildId =
    env.VOXIMPLANT_SERVER_STOP_POC_BUILD_ID?.trim() ||
    env.GIT_BRANCH?.trim() ||
    (rootBase.includes("server-stop-poc")
      ? "poc/voximplant-server-stop"
      : rootBase);

  const material = [
    packageName,
    rootBase,
    branchOrBuildId,
    POC_WORKTREE_MARKER,
    existsSync(join(root, "lib", "voximplant", "poc")) ? "poc-lib" : "no-poc-lib",
  ].join("|");

  const worktreeFingerprint = createHash("sha256")
    .update(material)
    .digest("hex")
    .slice(0, 16);

  const classificationHint: PocWorktreeDiagnostic["classificationHint"] =
    rootBase.includes("voximplant-server-stop-poc") ||
    rootBase.includes("server-stop-poc")
      ? "EXACT_POC_WORKTREE"
      : rootBase.includes("negotiations-web")
        ? "SIBLING_WORKTREE"
        : "UNKNOWN_PROCESS";

  return {
    worktreeFingerprint,
    branchOrBuildId,
    callbackEnabled,
    classificationHint,
  };
}

export function classifyWorktreeMatch(params: {
  observedFingerprint: string | null | undefined;
  expectedFingerprint: string;
}): "EXACT_POC_WORKTREE" | "SIBLING_WORKTREE" | "UNKNOWN_PROCESS" {
  if (!params.observedFingerprint) return "UNKNOWN_PROCESS";
  if (params.observedFingerprint === params.expectedFingerprint) {
    return "EXACT_POC_WORKTREE";
  }
  return "SIBLING_WORKTREE";
}
