#!/usr/bin/env node

import crypto from "node:crypto";

import { createOperatorCancellation } from "./validation-runner/cancellation.mjs";
import { exitCodeForOutcome, OUTCOMES } from "./validation-runner/outcomes.mjs";
import { resolveWorktreeRoot } from "./validation-runner/paths.mjs";
import { runGuardedPrismaGenerate } from "./validation-runner/prisma-generate.mjs";
import { createLogger } from "./validation-runner/orchestrator.mjs";

const logger = createLogger();
const forceStaleLock = process.argv.includes("--force-stale-lock");
const worktreeRoot = resolveWorktreeRoot();
const runId = crypto.randomUUID();

const cancellation = createOperatorCancellation();
const detachCancellation = cancellation.attach();

const result = await runGuardedPrismaGenerate({
  worktreeRoot,
  toolchainRoot: worktreeRoot,
  runId,
  forceStaleLock,
  signal: cancellation.controller.signal,
  logger,
});
detachCancellation();

logger.line(`[prisma:generate] OUTCOME: ${result.outcome}`);
if (result.outcome === OUTCOMES.VALIDATION_STALE_LOCK) {
  logger.line("Re-run with --force-stale-lock only after confirming the recorded owner is not a live generate run.");
}

process.exitCode = exitCodeForOutcome(result.outcome);
