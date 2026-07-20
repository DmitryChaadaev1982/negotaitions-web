/**
 * Private POC control capability state (raw media-session URLs).
 * Never listed in remainingEvidencePaths / status / inspect / report output.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { getPocRunPaths, resolvePocStateRoot } from "@/lib/voximplant/poc/poc-run-store";

export type PocPrivateControlState = {
  runId: string;
  mediaSessionAccessUrl: string | null;
  mediaSessionAccessSecureUrl: string | null;
  updatedAt: string;
};

export function getPrivateControlStatePath(
  runId: string,
  stateRoot?: string,
): string {
  const paths = getPocRunPaths(runId, stateRoot);
  return join(paths.runDir, "private", "control-state.json");
}

export function writePrivateControlState(
  state: PocPrivateControlState,
  stateRoot?: string,
): string {
  const path = getPrivateControlStatePath(state.runId, stateRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may ignore POSIX mode bits.
  }
  return path;
}

export function readPrivateControlState(
  runId: string,
  stateRoot?: string,
): PocPrivateControlState | null {
  const path = getPrivateControlStatePath(runId, stateRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<PocPrivateControlState>;
    if (!parsed || typeof parsed.runId !== "string") return null;
    return {
      runId: parsed.runId,
      mediaSessionAccessUrl:
        typeof parsed.mediaSessionAccessUrl === "string"
          ? parsed.mediaSessionAccessUrl
          : null,
      mediaSessionAccessSecureUrl:
        typeof parsed.mediaSessionAccessSecureUrl === "string"
          ? parsed.mediaSessionAccessSecureUrl
          : null,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function deletePrivateControlState(
  runId: string,
  stateRoot?: string,
): boolean {
  const path = getPrivateControlStatePath(runId, stateRoot);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function getPrivateControlUrl(
  runId: string,
  stateRoot?: string,
): string | null {
  const privateState = readPrivateControlState(runId, stateRoot);
  if (!privateState) return null;
  return (
    privateState.mediaSessionAccessSecureUrl ||
    privateState.mediaSessionAccessUrl ||
    null
  );
}

/** True when a path is under a run's private/ directory (never print/list). */
export function isPrivateControlEvidencePath(
  path: string,
  stateRoot?: string,
): boolean {
  const root = resolvePocStateRoot(stateRoot).replace(/\\/g, "/");
  const normalized = path.replace(/\\/g, "/");
  return (
    normalized.includes("/private/control-state.json") ||
    normalized.startsWith(`${root}/.agent/voximplant-server-stop/runs/`) &&
      normalized.includes("/private/")
  );
}
