import { createOperatorCancellation } from "../cancellation.mjs";
import { runValidation } from "../orchestrator.mjs";
import { exitCodeForOutcome } from "../outcomes.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOLD_OPEN = path.join(HERE, "hold-open.mjs");
const worktreeRoot = process.argv[2];
const holdMs = process.argv[3] ?? "20000";

if (!worktreeRoot) {
  process.stderr.write("synthetic-cancel-runner requires a worktree path\n");
  process.exit(2);
}

const cancellation = createOperatorCancellation();
const detach = cancellation.attach();

process.stdout.write(`SYNTHETIC_CANCEL_READY pid=${process.pid}\n`);

const result = await runValidation({
  command: "fast",
  worktreeRoot,
  toolchainRoot: worktreeRoot,
  heartbeatMs: 0,
  cleanupGraceMs: 800,
  runBudgetMs: 15_000,
  signal: cancellation.controller.signal,
  forwardOutput: false,
  steps: [
    {
      id: "synthetic-hold",
      kind: "spawn",
      timeoutMs: 12_000,
      file: process.execPath,
      args: [HOLD_OPEN, holdMs],
    },
  ],
});

detach();
process.stdout.write(`SYNTHETIC_CANCEL_OUTCOME=${result.outcome}\n`);
process.exitCode = exitCodeForOutcome(result.outcome);
