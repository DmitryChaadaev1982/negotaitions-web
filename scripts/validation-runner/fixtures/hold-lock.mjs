import { acquireWorktreeLock, createLockPayload } from "../lock.mjs";
import { LOCK_KINDS } from "../outcomes.mjs";
import { prismaGenerateLockPath, validationLockPath } from "../paths.mjs";

const worktreeRoot = process.argv[2];
const kind = process.argv[3] === "prisma-generate" ? LOCK_KINDS.PRISMA_GENERATE : LOCK_KINDS.VALIDATION;
const command = process.argv[4] ?? (kind === LOCK_KINDS.PRISMA_GENERATE ? "prisma:generate" : "fast");

if (!worktreeRoot) {
  process.stderr.write("hold-lock requires a worktree path\n");
  process.exit(2);
}

const lockPath = kind === LOCK_KINDS.PRISMA_GENERATE
  ? prismaGenerateLockPath(worktreeRoot)
  : validationLockPath(worktreeRoot);
const payload = createLockPayload({
  runId: `hold-lock-${process.pid}`,
  command,
  worktree: worktreeRoot,
});

const acquired = await acquireWorktreeLock({
  lockPath,
  payload,
  kind,
});

if (!acquired.ok) {
  process.stderr.write(`HOLD_LOCK_FAILED=${acquired.outcome}\n`);
  process.exit(3);
}

process.stdout.write(`HOLD_LOCK_PID=${process.pid}\n`);
process.stdout.write(`HOLD_LOCK_PATH=${lockPath}\n`);
process.stdout.write(`HOLD_LOCK_KIND=${kind}\n`);
setInterval(() => {}, 1_000);
