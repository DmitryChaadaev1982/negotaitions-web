#!/usr/bin/env node

import { createOperatorCancellation } from "./validation-runner/cancellation.mjs";
import { exitCodeForOutcome } from "./validation-runner/outcomes.mjs";
import {
  createLogger,
  parseRunnerArgs,
  runValidation,
} from "./validation-runner/orchestrator.mjs";

const logger = createLogger();

let parsed;
try {
  parsed = parseRunnerArgs(process.argv);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
  process.exit();
}

if (!parsed.command) {
  process.stderr.write("Usage: node scripts/validation-runner.mjs <fast|build|deploy> [--dry-run] [--force-stale-lock]\n");
  process.exitCode = 1;
  process.exit();
}

const cancellation = createOperatorCancellation();
const detachCancellation = cancellation.attach();

const result = await runValidation({
  command: parsed.command,
  dryRun: parsed.dryRun,
  forceStaleLock: parsed.forceStaleLock,
  signal: cancellation.controller.signal,
  logger,
});

detachCancellation();
process.exitCode = exitCodeForOutcome(result.outcome);
