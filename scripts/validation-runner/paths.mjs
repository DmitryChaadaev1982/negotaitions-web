import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const AGENT_DIR_NAME = ".agent";
export const VALIDATION_LOCK_NAME = "validation.lock";
export const PRISMA_GENERATE_LOCK_NAME = "prisma-generate.lock";
export const GENERATED_PRISMA_DIR = path.join("app", "generated", "prisma");

export function normalizeFsPath(value) {
  if (!value) {
    return "";
  }
  return path.resolve(String(value)).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function sameFsPath(left, right) {
  return Boolean(left) && Boolean(right) && normalizeFsPath(left) === normalizeFsPath(right);
}

export function toPosixPath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

export function agentDir(worktreeRoot) {
  return path.join(worktreeRoot, AGENT_DIR_NAME);
}

export function validationLockPath(worktreeRoot) {
  return path.join(agentDir(worktreeRoot), VALIDATION_LOCK_NAME);
}

export function prismaGenerateLockPath(worktreeRoot) {
  return path.join(agentDir(worktreeRoot), PRISMA_GENERATE_LOCK_NAME);
}

export function generatedPrismaDir(worktreeRoot) {
  return path.join(worktreeRoot, GENERATED_PRISMA_DIR);
}

export function resolveWorktreeRoot(cwd = process.cwd()) {
  const output = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return path.resolve(output.trim());
}

export function resolveWorktreeFile(worktreeRoot, parts, label) {
  const resolved = path.join(worktreeRoot, ...parts);
  if (!existsSync(resolved)) {
    throw new Error(`${label} is missing: ${parts.join("/")}`);
  }
  return resolved;
}
