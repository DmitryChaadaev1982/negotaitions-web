import crypto from "node:crypto";

import { runBoundedProcess } from "./bounded-process.mjs";
import {
  acquireWorktreeLock,
  createLockPayload,
  formatExistingOwner,
  releaseWorktreeLock,
} from "./lock.mjs";
import { LOCK_KINDS, OUTCOMES, TIMEOUT_LAYERS } from "./outcomes.mjs";
import { resolveWorktreeRoot, validationLockPath } from "./paths.mjs";
import { runGuardedPrismaGenerate } from "./prisma-generate.mjs";
import {
  HEARTBEAT_MS,
  RUN_BUDGETS_MS,
  getBuildStepIds,
  getDeployStepIds,
  getFastStepIds,
  stepsForCommand,
} from "./steps.mjs";

const PUBLIC_COMMANDS = new Set(["fast", "build", "deploy"]);

export function parseRunnerArgs(argv) {
  const args = argv.slice(2);
  let command = null;
  let dryRun = false;
  let forceStaleLock = false;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force-stale-lock") {
      forceStaleLock = true;
      continue;
    }
    if (PUBLIC_COMMANDS.has(arg) && !command) {
      command = arg;
      continue;
    }
    throw new Error(`Unknown validation-runner argument: ${arg}`);
  }

  return { command, dryRun, forceStaleLock };
}

export function createLogger(sink = process.stdout) {
  return {
    write(text) {
      sink.write(text);
    },
    line(text) {
      sink.write(text.endsWith("\n") ? text : `${text}\n`);
    },
  };
}

export function formatDryRunPlan(plan) {
  const lines = [
    "[validation] DRY_RUN",
    `RUN_ID: ${plan.runId}`,
    `COMMAND: ${plan.command}`,
    `WORKTREE: ${plan.worktreeRoot}`,
    `VALIDATION_LOCK: ${plan.lockPath}`,
    `RUN_BUDGET: ${plan.runBudgetMs}ms`,
    `HEARTBEAT: ${plan.heartbeatMs}ms`,
    "STEPS:",
    ...plan.steps.map((step) => `  - ${step.id} timeout=${step.timeoutMs}ms kind=${step.kind}`),
    "No processes started.",
  ];
  return lines.join("\n");
}

function effectiveStepTimeout(stepTimeoutMs, remainingMs) {
  if (remainingMs <= 0) {
    return { timeoutMs: 0, timeoutLayer: TIMEOUT_LAYERS.RUN_TIMEOUT };
  }
  if (remainingMs < stepTimeoutMs) {
    return { timeoutMs: remainingMs, timeoutLayer: TIMEOUT_LAYERS.RUN_TIMEOUT };
  }
  return { timeoutMs: stepTimeoutMs, timeoutLayer: TIMEOUT_LAYERS.STEP_TIMEOUT };
}

async function executeStep(step, context) {
  if (step.kind === "function") {
    return step.run(context);
  }

  if (step.kind === "prisma-generate") {
    return runGuardedPrismaGenerate({
      worktreeRoot: context.worktreeRoot,
      toolchainRoot: context.toolchainRoot,
      runId: context.runId,
      timeoutMs: context.timeoutMs,
      heartbeatMs: context.heartbeatMs,
      signal: context.signal,
      logger: context.logger,
        forceStaleLock: context.forceStaleLock,
        env: context.env,
        cleanupGraceMs: context.cleanupGraceMs,
    });
  }

      return runBoundedProcess({
        runId: context.runId,
        step: step.id,
        file: step.file,
        args: step.args,
        cwd: context.worktreeRoot,
        env: context.env,
        timeoutMs: context.timeoutMs,
        heartbeatMs: context.heartbeatMs,
        signal: context.signal,
        logger: context.logger,
        timeoutLayer: context.timeoutLayer,
        forwardOutput: context.forwardOutput,
        cleanupGraceMs: context.cleanupGraceMs,
      });
}

export async function runValidation(options) {
  const command = options.command;
  if (!PUBLIC_COMMANDS.has(command)) {
    throw new Error(`Unsupported validation command: ${command}`);
  }

  const worktreeRoot = options.worktreeRoot ?? resolveWorktreeRoot(options.cwd ?? process.cwd());
  const toolchainRoot = options.toolchainRoot ?? worktreeRoot;
  const runId = options.runId ?? crypto.randomUUID();
  const logger = options.logger ?? createLogger();
  const lockPath = options.lockPath ?? validationLockPath(worktreeRoot);
  const runBudgetMs = options.runBudgetMs ?? RUN_BUDGETS_MS[command];
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const steps = options.steps ?? stepsForCommand(command, { worktreeRoot, toolchainRoot });
  const env = options.env ?? process.env;

  const plan = {
    runId,
    command,
    worktreeRoot,
    toolchainRoot,
    lockPath,
    runBudgetMs,
    heartbeatMs,
    steps: steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      timeoutMs: step.timeoutMs,
    })),
  };

  if (options.dryRun) {
    logger.line(formatDryRunPlan(plan));
    return { outcome: OUTCOMES.VALIDATION_OK, dryRun: true, ...plan };
  }

  const payload = createLockPayload({
    runId,
    command,
    worktree: worktreeRoot,
  });

  const acquired = await acquireWorktreeLock({
    lockPath,
    payload,
    kind: LOCK_KINDS.VALIDATION,
    forceStaleLock: options.forceStaleLock === true,
    inspectPidFn: options.inspectPidFn,
    logger,
  });

  if (!acquired.ok) {
    logger.line(`[validation] OUTCOME: ${acquired.outcome}`);
    logger.line(formatExistingOwner(acquired.existing));
    if (acquired.outcome === OUTCOMES.VALIDATION_STALE_LOCK) {
      logger.line("Re-run with --force-stale-lock only after confirming the recorded owner is not a live validation run.");
    }
    return {
      outcome: acquired.outcome,
      runId,
      command,
      worktreeRoot,
      lockPath,
      existingLock: acquired.existing,
      reason: acquired.reason,
    };
  }

  const runStartedAt = Date.now();
  const runDeadline = runStartedAt + runBudgetMs;
  const stepResults = [];
  let cancellationInProgress = false;
  const markCancellation = () => {
    if (cancellationInProgress) {
      return;
    }
    cancellationInProgress = true;
    logger.line(`[validation] CANCELLATION_IN_PROGRESS`);
  };
  if (options.signal) {
    if (options.signal.aborted) {
      markCancellation();
    } else {
      options.signal.addEventListener("abort", markCancellation, { once: true });
    }
  }

  try {
    for (const step of steps) {
      if (cancellationInProgress || options.signal?.aborted) {
        markCancellation();
        logger.line(`[validation] OUTCOME: ${OUTCOMES.VALIDATION_CANCELLED}`);
        return {
          outcome: OUTCOMES.VALIDATION_CANCELLED,
          runId,
          command,
          worktreeRoot,
          lockPath,
          steps: stepResults,
          cancelled: true,
        };
      }

      const remainingMs = runDeadline - Date.now();
      const timed = effectiveStepTimeout(step.timeoutMs, remainingMs);
      if (timed.timeoutMs <= 0) {
        logger.line(`[validation] OUTCOME: ${OUTCOMES.VALIDATION_TIMEOUT}`);
        logger.line(`[validation] TIMEOUT_LAYER: ${TIMEOUT_LAYERS.RUN_TIMEOUT}`);
        return {
          outcome: OUTCOMES.VALIDATION_TIMEOUT,
          timeoutLayer: TIMEOUT_LAYERS.RUN_TIMEOUT,
          runId,
          command,
          worktreeRoot,
          lockPath,
          steps: stepResults,
        };
      }

      logger.line(`[validation] STEP_START ${step.id}`);
      const result = await executeStep(step, {
        worktreeRoot,
        toolchainRoot,
        runId,
        timeoutMs: timed.timeoutMs,
        timeoutLayer: timed.timeoutLayer,
        heartbeatMs,
        signal: options.signal,
        logger,
        forceStaleLock: options.forceStaleLock === true,
        env,
        forwardOutput: options.forwardOutput ?? true,
        cleanupGraceMs: options.cleanupGraceMs,
        step,
      });
      stepResults.push({
        id: step.id,
        outcome: result.outcome,
        timeoutLayer: result.timeoutLayer ?? null,
        childPid: result.childPid ?? result.generate?.childPid ?? null,
      });
      logger.line(`[validation] STEP_END ${step.id} ${result.outcome}`);

      if (result.outcome !== OUTCOMES.VALIDATION_OK) {
        if (result.timeoutLayer) {
          logger.line(`[validation] TIMEOUT_LAYER: ${result.timeoutLayer}`);
        }
        logger.line(`[validation] OUTCOME: ${result.outcome}`);
        return {
          outcome: result.outcome,
          timeoutLayer: result.timeoutLayer ?? null,
          runId,
          command,
          worktreeRoot,
          lockPath,
          steps: stepResults,
          failedStep: step.id,
        };
      }
    }

    logger.line(`[validation] OUTCOME: ${OUTCOMES.VALIDATION_OK}`);
    return {
      outcome: OUTCOMES.VALIDATION_OK,
      runId,
      command,
      worktreeRoot,
      lockPath,
      steps: stepResults,
    };
  } finally {
    releaseWorktreeLock(lockPath, runId);
  }
}

export {
  getBuildStepIds,
  getDeployStepIds,
  getFastStepIds,
  RUN_BUDGETS_MS,
};
