import { createOperatorCancellation } from "../cancellation.mjs";
import { createLogger, runValidation } from "../orchestrator.mjs";
import { exitCodeForOutcome } from "../outcomes.mjs";
import { prismaGenerateLockPath, resolveWorktreeRoot, validationLockPath } from "../paths.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOLD_OPEN = path.join(HERE, "hold-open.mjs");
const HOLD_MS = 10 * 60_000;
const STEP_TIMEOUT_MS = HOLD_MS + 5_000;
const RUN_BUDGET_MS = HOLD_MS + 30_000;
const HEARTBEAT_MS = 3_000;

const worktreeRoot = resolveWorktreeRoot(process.cwd());
const lockPath = validationLockPath(worktreeRoot);
const prismaLockPath = prismaGenerateLockPath(worktreeRoot);
const logger = createLogger();

logger.line("STAGE_3_21A_OPERATOR_CTRL_C_HOLD");
logger.line(`WORKTREE: ${worktreeRoot}`);
logger.line(`VALIDATION_LOCK: ${lockPath}`);
logger.line(`PRISMA_GENERATE_LOCK: ${prismaLockPath}`);
logger.line(`RUNNER_PID: ${process.pid}`);
logger.line("Press Ctrl+C once after STEP_START and STATUS: RUNNING.");
logger.line("This hold uses only fixtures/hold-open.mjs. It does not run validate:fast, validate:deploy, or prisma generate.");

const cancellation = createOperatorCancellation();
const detach = cancellation.attach();

const result = await runValidation({
  command: "fast",
  worktreeRoot,
  toolchainRoot: worktreeRoot,
  heartbeatMs: HEARTBEAT_MS,
  cleanupGraceMs: 800,
  runBudgetMs: RUN_BUDGET_MS,
  signal: cancellation.controller.signal,
  forwardOutput: true,
  logger,
  steps: [
    {
      id: "operator-ctrl-c-hold",
      kind: "spawn",
      timeoutMs: STEP_TIMEOUT_MS,
      file: process.execPath,
      args: [HOLD_OPEN, String(HOLD_MS)],
    },
  ],
});

detach();
logger.line(`OPERATOR_CTRL_C_OUTCOME=${result.outcome}`);
process.exitCode = exitCodeForOutcome(result.outcome);
