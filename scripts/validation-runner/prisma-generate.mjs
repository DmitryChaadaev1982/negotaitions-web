import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runBoundedProcess } from "./bounded-process.mjs";
import { acquireWorktreeLock, createLockPayload, releaseWorktreeLock } from "./lock.mjs";
import { LOCK_KINDS, OUTCOMES } from "./outcomes.mjs";
import { generatedPrismaDir, prismaGenerateLockPath } from "./paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INTEGRITY_PROBE = path.join(HERE, "prisma-integrity-probe.mjs");

export const PRISMA_CLIENT_REQUIRED_FILES = Object.freeze([
  "client.ts",
  "enums.ts",
  path.join("internal", "prismaNamespace.ts"),
]);

export const PRISMA_GENERATE_TIMEOUT_MS = 120_000;
export const PRISMA_INTEGRITY_TIMEOUT_MS = 30_000;

export function resolveInstalledPrismaCli(toolchainRoot) {
  const direct = path.join(toolchainRoot, "node_modules", "prisma", "build", "index.js");
  if (existsSync(direct)) {
    return direct;
  }
  try {
    const require = createRequire(path.join(toolchainRoot, "package.json"));
    const packageJsonPath = require.resolve("prisma/package.json");
    const cli = path.join(path.dirname(packageJsonPath), "build", "index.js");
    if (existsSync(cli)) {
      return cli;
    }
  } catch {
    // refuse to fall back to npx
  }
  throw new Error(
    "Installed Prisma CLI (prisma/build/index.js) was not found in this worktree. Refusing to use npx.",
  );
}

export function resolveTsxLoader(toolchainRoot) {
  const require = createRequire(path.join(toolchainRoot, "package.json"));
  return require.resolve("tsx");
}

export function toNodeImportSpecifier(filePath) {
  if (typeof filePath === "string" && filePath.startsWith("file:")) {
    return filePath;
  }
  return pathToFileURL(filePath).href;
}

export function listMissingPrismaClientFiles(clientDir) {
  return PRISMA_CLIENT_REQUIRED_FILES.filter((relative) => !existsSync(path.join(clientDir, relative)));
}

export async function verifyPrismaClientIntegrity(options) {
  const clientDir = options.generatedClientDir ?? generatedPrismaDir(options.worktreeRoot);
  const toolchainRoot = options.toolchainRoot ?? options.worktreeRoot;
  const missing = listMissingPrismaClientFiles(clientDir);
  if (missing.length > 0) {
    return {
      ok: false,
      outcome: OUTCOMES.PRISMA_CLIENT_INTEGRITY_FAILED,
      missing,
    };
  }

  const clientPath = path.join(clientDir, "client.ts");
  const result = await runBoundedProcess({
    runId: options.runId,
    step: "prisma client integrity",
    file: process.execPath,
    args: [
      "--import",
      toNodeImportSpecifier(resolveTsxLoader(toolchainRoot)),
      INTEGRITY_PROBE,
      clientPath,
    ],
    cwd: toolchainRoot,
    env: options.env ?? process.env,
    timeoutMs: options.integrityTimeoutMs ?? PRISMA_INTEGRITY_TIMEOUT_MS,
    heartbeatMs: options.heartbeatMs ?? 0,
    signal: options.signal,
    logger: options.logger,
    forwardOutput: options.forwardOutput ?? true,
  });

  if (result.outcome !== OUTCOMES.VALIDATION_OK) {
    return {
      ok: false,
      outcome:
        result.outcome === OUTCOMES.CHILD_CLEANUP_FAILED
          ? OUTCOMES.CHILD_CLEANUP_FAILED
          : OUTCOMES.PRISMA_CLIENT_INTEGRITY_FAILED,
      probe: result,
      missing: [],
    };
  }

  return { ok: true, outcome: OUTCOMES.VALIDATION_OK, missing: [] };
}

export async function runGuardedPrismaGenerate(options) {
  const worktreeRoot = options.worktreeRoot;
  const toolchainRoot = options.toolchainRoot ?? worktreeRoot;
  const runId = options.runId;
  const lockPath = options.lockPath ?? prismaGenerateLockPath(worktreeRoot);
  const payload = createLockPayload({
    runId,
    command: "prisma:generate",
    worktree: worktreeRoot,
  });

  const acquired = await acquireWorktreeLock({
    lockPath,
    payload,
    kind: LOCK_KINDS.PRISMA_GENERATE,
    forceStaleLock: options.forceStaleLock === true,
    inspectPidFn: options.inspectPidFn,
    logger: options.logger,
  });

  if (!acquired.ok) {
    return {
      outcome: acquired.outcome,
      lock: acquired,
      lockPath,
    };
  }

  try {
    const generateInvocation = options.generateInvocation ?? {
      file: process.execPath,
      args: [resolveInstalledPrismaCli(toolchainRoot), "generate", "--no-hints"],
    };
    const generate = await runBoundedProcess({
      runId,
      step: "prisma generate",
      file: generateInvocation.file,
      args: generateInvocation.args,
      cwd: generateInvocation.cwd ?? worktreeRoot,
      env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? PRISMA_GENERATE_TIMEOUT_MS,
      heartbeatMs: options.heartbeatMs,
      signal: options.signal,
      logger: options.logger,
      forwardOutput: options.forwardOutput ?? true,
      cleanupGraceMs: options.cleanupGraceMs,
    });

    if (generate.outcome !== OUTCOMES.VALIDATION_OK) {
      return {
        outcome:
          generate.outcome === OUTCOMES.VALIDATION_FAILED
            ? OUTCOMES.PRISMA_GENERATION_FAILED
            : generate.outcome,
        timeoutLayer: generate.timeoutLayer ?? null,
        generate,
        lockPath,
      };
    }

    if (options.skipIntegrity === true) {
      return { outcome: OUTCOMES.VALIDATION_OK, generate, lockPath };
    }

    const integrity = await verifyPrismaClientIntegrity({
      worktreeRoot,
      toolchainRoot,
      generatedClientDir: options.generatedClientDir,
      runId,
      env: options.env,
      signal: options.signal,
      logger: options.logger,
      heartbeatMs: 0,
      forwardOutput: options.forwardOutput,
      integrityTimeoutMs: options.integrityTimeoutMs,
    });

    if (!integrity.ok) {
      return {
        outcome: integrity.outcome,
        generate,
        integrity,
        lockPath,
      };
    }

    return {
      outcome: OUTCOMES.VALIDATION_OK,
      generate,
      integrity,
      lockPath,
    };
  } finally {
    releaseWorktreeLock(lockPath, runId);
  }
}
