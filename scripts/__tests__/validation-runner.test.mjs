import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSpawnOptions, runBoundedProcess } from "../validation-runner/bounded-process.mjs";
import {
  createOperatorCancellation,
  supportedOperatorSignals,
} from "../validation-runner/cancellation.mjs";
import {
  acquireWorktreeLock,
  createLockPayload,
  isPidAlive,
  readLockPayload,
  releaseWorktreeLock,
  tryExclusiveCreate,
} from "../validation-runner/lock.mjs";
import { runValidation } from "../validation-runner/orchestrator.mjs";
import { LOCK_KINDS, OUTCOMES, TIMEOUT_LAYERS } from "../validation-runner/outcomes.mjs";
import {
  prismaGenerateLockPath,
  validationLockPath,
} from "../validation-runner/paths.mjs";
import {
  cleanupOwnedTree,
  posixCleanupPlan,
  windowsCleanupPlan,
  buildTaskkillArgs,
  classifyProcessPresence,
  decideForceKill,
  IDENTITY_DIAGNOSTIC,
  inspectProcessIdentity,
  PROCESS_PRESENCE,
  posixSignalDecision,
} from "../validation-runner/process-tree.mjs";
import {
  runGuardedPrismaGenerate,
  toNodeImportSpecifier,
  verifyPrismaClientIntegrity,
} from "../validation-runner/prisma-generate.mjs";
import {
  createCanonicalSteps,
  getBuildStepIds,
  getDeployStepIds,
  getFastStepIds,
} from "../validation-runner/steps.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOLD_OPEN = path.join(REPO_ROOT, "scripts", "validation-runner", "fixtures", "hold-open.mjs");
const HOLD_LOCK = path.join(REPO_ROOT, "scripts", "validation-runner", "fixtures", "hold-lock.mjs");
const SYNTHETIC_CANCEL = path.join(
  REPO_ROOT,
  "scripts",
  "validation-runner",
  "fixtures",
  "synthetic-cancel-runner.mjs",
);
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

function makeWorktree() {
  return path.resolve(os.tmpdir(), `neg-vr-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function createWorktree() {
  const worktree = makeWorktree();
  mkdirSync(path.join(worktree, ".agent"), { recursive: true });
  return worktree;
}

function removeWorktree(worktree) {
  try {
    rmSync(worktree, { recursive: true, force: true });
  } catch {
    // temp cleanup is best-effort
  }
}

function createCaptureLogger() {
  const lines = [];
  return {
    lines,
    write(text) {
      lines.push(String(text));
    },
    line(text) {
      lines.push(String(text).replace(/\n$/, ""));
    },
    joined() {
      return lines.join("\n");
    },
  };
}

function okStep(id = "synthetic-ok") {
  return {
    id,
    kind: "function",
    timeoutMs: 2_000,
    run: async () => ({ outcome: OUTCOMES.VALIDATION_OK }),
  };
}

function hungStep(id = "synthetic-hung", timeoutMs = 10_000) {
  return {
    id,
    kind: "spawn",
    timeoutMs,
    file: process.execPath,
    args: [HOLD_OPEN, "30000"],
  };
}

async function spawnUntilOutput(file, args, marker, timeoutMs = 5_000) {
  const child = spawn(process.execPath, [file, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for ${marker}: ${output}`));
    }, timeoutMs);
    let onExit;
    const onData = (chunk) => {
      output += String(chunk);
      if (output.includes(marker)) {
        child.off("exit", onExit);
        clearTimeout(timer);
        resolve();
      }
    };
    onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited ${code} before ${marker}: ${output}`));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
  return { child, output, getOutput: () => output };
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(message ?? "waitUntil timed out");
}

async function stopChild(child) {
  if (!child?.pid) {
    return;
  }
  await cleanupOwnedTree(child.pid, { graceMs: 800 });
}

test("T01 atomic worktree lock is acquired with required payload fields", async () => {
  const worktree = createWorktree();
  const lockPath = validationLockPath(worktree);
  try {
    const payloadA = createLockPayload({
      runId: "run-a",
      command: "fast",
      worktree,
    });
    const payloadB = createLockPayload({
      runId: "run-b",
      command: "fast",
      worktree,
    });
    const [first, second] = await Promise.all([
      acquireWorktreeLock({ lockPath, payload: payloadA, kind: LOCK_KINDS.VALIDATION }),
      acquireWorktreeLock({ lockPath, payload: payloadB, kind: LOCK_KINDS.VALIDATION }),
    ]);
    const winners = [first, second].filter((result) => result.ok);
    assert.equal(winners.length, 1);
    assert.equal(tryExclusiveCreate(lockPath, payloadB).code, "EEXIST");

    const stored = readLockPayload(lockPath);
    assert.ok(stored.runId);
    assert.ok(Number.isInteger(stored.pid));
    assert.ok(stored.startedAt);
    assert.ok(stored.command);
    assert.ok(stored.worktree);
    assert.ok(stored.hostname);
  } finally {
    removeWorktree(worktree);
  }
});

test("T02 second validation in the same worktree fails fast with VALIDATION_ALREADY_RUNNING", async () => {
  const worktree = createWorktree();
  let holder;
  try {
    holder = await spawnUntilOutput(HOLD_LOCK, [worktree, "validation", "fast"], "HOLD_LOCK_PID=");
    const inspectPidFn = async (pid) => ({
      alive: isPidAlive(pid),
      commandLine: pid === holder.child.pid
        ? "node scripts/validation-runner/fixtures/hold-lock.mjs fast"
        : null,
      startMs: Date.now() - 1_000,
    });
    const result = await runValidation({
      command: "fast",
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      steps: [okStep()],
      inspectPidFn,
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.outcome, OUTCOMES.VALIDATION_ALREADY_RUNNING);
    assert.ok(existsSync(validationLockPath(worktree)));
  } finally {
    await stopChild(holder?.child);
    removeWorktree(worktree);
  }
});

test("T03 sibling worktree lock paths differ and stay worktree-scoped", () => {
  const first = validationLockPath("C:/worktrees/negotiations-a");
  const second = validationLockPath("C:/worktrees/negotiations-b");
  assert.notEqual(path.normalize(first), path.normalize(second));
  assert.match(first.replace(/\\/g, "/"), /negotiations-a\/\.agent\/validation\.lock$/);
  assert.match(second.replace(/\\/g, "/"), /negotiations-b\/\.agent\/validation\.lock$/);
  assert.doesNotMatch(first, /git-common|commondir/i);
});

test("T04 dead-PID stale lock is recovered", async () => {
  const worktree = createWorktree();
  const lockPath = validationLockPath(worktree);
  try {
    writeFileSync(
      lockPath,
      `${JSON.stringify(createLockPayload({
        runId: "dead-owner",
        command: "fast",
        worktree,
        pid: 999999,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
      }), null, 2)}\n`,
    );
    const logger = createCaptureLogger();
    const result = await acquireWorktreeLock({
      lockPath,
      payload: createLockPayload({ runId: "recovered", command: "fast", worktree }),
      kind: LOCK_KINDS.VALIDATION,
      logger,
    });
    assert.equal(result.ok, true);
    assert.equal(result.recoveredStale, true);
    assert.match(logger.joined(), /recovered stale lock/);
    assert.equal(readLockPayload(lockPath).runId, "recovered");
  } finally {
    removeWorktree(worktree);
  }
});

test("T05 ambiguous live-PID stale lock is not auto-removed", async () => {
  const worktree = createWorktree();
  let unrelated;
  try {
    unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const lockPath = validationLockPath(worktree);
    writeFileSync(
      lockPath,
      `${JSON.stringify(createLockPayload({
        runId: "ambiguous-owner",
        command: "fast",
        worktree,
        pid: unrelated.pid,
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      }), null, 2)}\n`,
    );
    const result = await acquireWorktreeLock({
      lockPath,
      payload: createLockPayload({ runId: "challenger", command: "fast", worktree }),
      kind: LOCK_KINDS.VALIDATION,
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, OUTCOMES.VALIDATION_STALE_LOCK);
    assert.equal(readLockPayload(lockPath).runId, "ambiguous-owner");
    assert.equal(isPidAlive(unrelated.pid), true);
  } finally {
    await stopChild(unrelated);
    removeWorktree(worktree);
  }
});

test("T06 deploy internal fast→build does not deadlock or reacquire the validation lock", async () => {
  const worktree = createWorktree();
  try {
    const seen = [];
    const inspectPidFn = async (pid) => ({
      alive: pid === process.pid,
      commandLine: "node scripts/validation-runner.mjs deploy",
      startMs: Date.now() - 10_000,
    });
    const result = await runValidation({
      command: "deploy",
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      inspectPidFn,
      logger: createCaptureLogger(),
      forwardOutput: false,
      steps: [
        {
          id: "internal-fast",
          kind: "function",
          timeoutMs: 2_000,
          run: async () => {
            const inner = await acquireWorktreeLock({
              lockPath: validationLockPath(worktree),
              payload: createLockPayload({ runId: "inner-fast", command: "fast", worktree }),
              kind: LOCK_KINDS.VALIDATION,
              inspectPidFn,
            });
            seen.push(inner.outcome);
            return { outcome: OUTCOMES.VALIDATION_OK };
          },
        },
        {
          id: "internal-build",
          kind: "function",
          timeoutMs: 2_000,
          run: async () => {
            const inner = await acquireWorktreeLock({
              lockPath: validationLockPath(worktree),
              payload: createLockPayload({ runId: "inner-build", command: "build", worktree }),
              kind: LOCK_KINDS.VALIDATION,
              inspectPidFn,
            });
            seen.push(inner.outcome);
            return { outcome: OUTCOMES.VALIDATION_OK };
          },
        },
      ],
    });
    assert.equal(result.outcome, OUTCOMES.VALIDATION_OK);
    assert.deepEqual(seen, [
      OUTCOMES.VALIDATION_ALREADY_RUNNING,
      OUTCOMES.VALIDATION_ALREADY_RUNNING,
    ]);
  } finally {
    removeWorktree(worktree);
  }
});

test("T07 hung synthetic child hits a bounded timeout", async () => {
  const logger = createCaptureLogger();
  const result = await runBoundedProcess({
    runId: "t07",
    step: "synthetic-hang",
    file: process.execPath,
    args: [HOLD_OPEN, "30000"],
    timeoutMs: 400,
    heartbeatMs: 0,
    cleanupGraceMs: 800,
    logger,
    forwardOutput: false,
  });
  assert.equal(result.outcome, OUTCOMES.VALIDATION_TIMEOUT);
  assert.equal(isPidAlive(result.childPid), false);
});

test("T08 timeout dump contains owned process information", async () => {
  const logger = createCaptureLogger();
  const result = await runBoundedProcess({
    runId: "t08",
    step: "synthetic-hang",
    file: process.execPath,
    args: [HOLD_OPEN, "30000", "1"],
    timeoutMs: 500,
    heartbeatMs: 0,
    cleanupGraceMs: 800,
    logger,
    forwardOutput: false,
  });
  assert.equal(result.outcome, OUTCOMES.VALIDATION_TIMEOUT);
  assert.ok(result.treeDump?.some((entry) => entry.pid === result.childPid));
  const dump = logger.joined();
  assert.match(dump, /OWNED_PROCESS_TREE/);
  assert.match(dump, new RegExp(`pid=${result.childPid}`));
  assert.match(dump, /ppid=/);
  assert.match(dump, /name=/);
  assert.match(dump, /cmd=/);
});

test("T09 owned child tree is cleaned after timeout", async () => {
  const result = await runBoundedProcess({
    runId: "t09",
    step: "synthetic-tree",
    file: process.execPath,
    args: [HOLD_OPEN, "30000", "1"],
    timeoutMs: 500,
    heartbeatMs: 0,
    cleanupGraceMs: 800,
    logger: createCaptureLogger(),
    forwardOutput: false,
  });
  assert.equal(result.outcome, OUTCOMES.VALIDATION_TIMEOUT);
  const snapshotPids = (result.treeDump ?? []).map((entry) => entry.pid);
  assert.ok(snapshotPids.includes(result.childPid));
  for (const pid of snapshotPids) {
    assert.equal(isPidAlive(pid), false, `owned pid ${pid} survived cleanup`);
  }
});

test("T10 unrelated synthetic process survives owned-child cleanup", async () => {
  let unrelated;
  try {
    unrelated = await spawnUntilOutput(HOLD_OPEN, ["30000"], "HOLD_OPEN_PID=");
    const result = await runBoundedProcess({
      runId: "t10",
      step: "owned-hang",
      file: process.execPath,
      args: [HOLD_OPEN, "30000"],
      timeoutMs: 400,
      heartbeatMs: 0,
      cleanupGraceMs: 800,
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.outcome, OUTCOMES.VALIDATION_TIMEOUT);
    assert.equal(isPidAlive(result.childPid), false);
    assert.equal(isPidAlive(unrelated.child.pid), true);
    assert.notEqual(unrelated.child.pid, result.childPid);
  } finally {
    await stopChild(unrelated?.child);
  }
});

test("T11 non-zero child exit returns VALIDATION_FAILED", async () => {
  const result = await runBoundedProcess({
    runId: "t11",
    step: "synthetic-fail",
    file: process.execPath,
    args: ["-e", "process.exit(2)"],
    timeoutMs: 5_000,
    heartbeatMs: 0,
    logger: createCaptureLogger(),
    forwardOutput: false,
  });
  assert.equal(result.outcome, OUTCOMES.VALIDATION_FAILED);
  assert.equal(result.exitCode, 2);
});

test("T12 generate guard prevents same-worktree concurrent generation", async () => {
  const worktree = createWorktree();
  let holder;
  try {
    holder = await spawnUntilOutput(
      HOLD_LOCK,
      [worktree, "prisma-generate", "prisma:generate"],
      "HOLD_LOCK_PID=",
    );
    const inspectPidFn = async (pid) => ({
      alive: isPidAlive(pid),
      commandLine: pid === holder.child.pid
        ? "node scripts/validation-runner/fixtures/hold-lock.mjs prisma:generate"
        : null,
      startMs: Date.now() - 1_000,
    });
    const result = await runGuardedPrismaGenerate({
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      runId: "t12-challenger",
      skipIntegrity: true,
      inspectPidFn,
      generateInvocation: {
        file: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.outcome, OUTCOMES.VALIDATION_ALREADY_RUNNING);
    assert.ok(existsSync(prismaGenerateLockPath(worktree)));
  } finally {
    await stopChild(holder?.child);
    removeWorktree(worktree);
  }
});

test("T13 missing generated client.ts fails with PRISMA_CLIENT_INTEGRITY_FAILED", async () => {
  const worktree = createWorktree();
  try {
    const clientDir = path.join(worktree, "app", "generated", "prisma");
    mkdirSync(path.join(clientDir, "internal"), { recursive: true });
    writeFileSync(path.join(clientDir, "enums.ts"), "export {}\n");
    writeFileSync(path.join(clientDir, "internal", "prismaNamespace.ts"), "export {}\n");
    const result = await verifyPrismaClientIntegrity({
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      generatedClientDir: clientDir,
      runId: "t13",
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, OUTCOMES.PRISMA_CLIENT_INTEGRITY_FAILED);
    assert.ok(result.missing.includes("client.ts"));
  } finally {
    removeWorktree(worktree);
  }
});

test("T14 invalid Prisma.sql probe fails with PRISMA_CLIENT_INTEGRITY_FAILED", async () => {
  const worktree = createWorktree();
  try {
    const clientDir = path.join(worktree, "app", "generated", "prisma");
    mkdirSync(path.join(clientDir, "internal"), { recursive: true });
    writeFileSync(
      path.join(clientDir, "client.ts"),
      "export const Prisma = { sql: 123, join() { return []; } };\n",
    );
    writeFileSync(path.join(clientDir, "enums.ts"), "export {}\n");
    writeFileSync(path.join(clientDir, "internal", "prismaNamespace.ts"), "export {}\n");
    const result = await verifyPrismaClientIntegrity({
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      generatedClientDir: clientDir,
      runId: "t14",
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, OUTCOMES.PRISMA_CLIENT_INTEGRITY_FAILED);
  } finally {
    removeWorktree(worktree);
  }
});

test("toNodeImportSpecifier converts Windows paths and preserves file URLs", () => {
  assert.equal(
    toNodeImportSpecifier("C:\\repo\\scripts\\bootstrap.mjs"),
    "file:///C:/repo/scripts/bootstrap.mjs",
  );
  assert.equal(
    toNodeImportSpecifier("file:///C:/repo/scripts/bootstrap.mjs"),
    "file:///C:/repo/scripts/bootstrap.mjs",
  );
  assert.equal(
    toNodeImportSpecifier("/repo/scripts/bootstrap.mjs"),
    process.platform === "win32"
      ? "file:///C:/repo/scripts/bootstrap.mjs"
      : "file:///repo/scripts/bootstrap.mjs",
  );
  assert.doesNotMatch(
    toNodeImportSpecifier("C:\\Projects\\tsx\\dist\\loader.mjs"),
    /^[A-Za-z]:/,
  );
});

test("T15 successful synthetic step returns VALIDATION_OK", async () => {
  const worktree = createWorktree();
  try {
    const result = await runValidation({
      command: "fast",
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      steps: [okStep()],
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.outcome, OUTCOMES.VALIDATION_OK);
  } finally {
    removeWorktree(worktree);
  }
});

test("T16 heartbeat is emitted for a long-enough synthetic child", async () => {
  const logger = createCaptureLogger();
  const result = await runBoundedProcess({
    runId: "t16",
    step: "test:unit",
    file: process.execPath,
    args: [HOLD_OPEN, "800"],
    timeoutMs: 5_000,
    heartbeatMs: 200,
    logger,
    forwardOutput: false,
  });
  assert.equal(result.outcome, OUTCOMES.VALIDATION_OK);
  assert.match(logger.joined(), /STATUS: RUNNING/);
  assert.match(logger.joined(), /CHILD_PID: /);
  assert.match(logger.joined(), /CURRENT_TEST: /);
});

test("T17 whole-run timeout bounds a longer step", async () => {
  const worktree = createWorktree();
  try {
    const result = await runValidation({
      command: "fast",
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      runBudgetMs: 400,
      heartbeatMs: 0,
      cleanupGraceMs: 800,
      steps: [hungStep("bounded-by-run", 10_000)],
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    assert.equal(result.outcome, OUTCOMES.VALIDATION_TIMEOUT);
    assert.equal(result.timeoutLayer, TIMEOUT_LAYERS.RUN_TIMEOUT);
  } finally {
    removeWorktree(worktree);
  }
});

test("T18 cancellation cleans the owned child", async () => {
  const worktree = createWorktree();
  const controller = new AbortController();
  try {
    const running = runValidation({
      command: "fast",
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      heartbeatMs: 0,
      cleanupGraceMs: 800,
      signal: controller.signal,
      steps: [hungStep("cancel-me", 10_000)],
      logger: createCaptureLogger(),
      forwardOutput: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    const result = await running;
    assert.equal(result.outcome, OUTCOMES.VALIDATION_CANCELLED);
    const childPid = result.steps?.[0]?.childPid;
    if (childPid) {
      assert.equal(isPidAlive(childPid), false);
    }
  } finally {
    removeWorktree(worktree);
  }
});

test("T19 validate:fast public contract maps to the internal FAST steps", () => {
  assert.match(PACKAGE_JSON.scripts["validate:fast"], /validation-runner\.mjs fast/);
  assert.deepEqual(getFastStepIds(), [
    "check:native-dialogs",
    "lint",
    "prisma validate",
    "prisma generate",
    "test:unit",
    "test:e2e:list",
  ]);
  const graph = createCanonicalSteps({ worktreeRoot: REPO_ROOT });
  assert.deepEqual(graph.fast.map((step) => step.id), getFastStepIds());
});

test("T20 validate:deploy contract is FAST then BUILD without nested public validate:fast", () => {
  assert.match(PACKAGE_JSON.scripts["validate:deploy"], /validation-runner\.mjs deploy/);
  assert.doesNotMatch(PACKAGE_JSON.scripts["validate:deploy"], /npm run validate:fast/);
  assert.deepEqual(getDeployStepIds(), [...getFastStepIds(), ...getBuildStepIds()]);
  assert.deepEqual(getBuildStepIds(), ["next build"]);
});

test("Windows and POSIX cleanup plans never kill by image name", () => {
  const posix = JSON.stringify(posixCleanupPlan());
  const windows = JSON.stringify(windowsCleanupPlan());
  assert.doesNotMatch(posix, /pkill node|killall node|taskkill \/IM/i);
  assert.doesNotMatch(windows, /\/IM|pkill node/i);
  const args = buildTaskkillArgs(4321, { tree: true, force: true });
  assert.deepEqual(args, ["/PID", "4321", "/T", "/F"]);
  assert.ok(!args.includes("/IM"));
  assert.equal(posixSignalDecision().target, "owned-process-group");
  assert.equal(posixCleanupPlan()[0].target, "owned-process-group");
  assert.equal(createSpawnOptions({ cwd: ".", env: {}, platform: "linux" }).detached, true);
  assert.equal(createSpawnOptions({ cwd: ".", env: {}, platform: "win32" }).detached, false);
});

test("T21 force cleanup refuses a snapshotted PID whose identity changed", async () => {
  const logger = createCaptureLogger();
  const reusedPid = 4242;
  const ownedRoot = 9999;
  const forceKills = [];
  const snapshot = [{
    pid: reusedPid,
    ppid: ownedRoot,
    startMs: 1_000,
    name: "node.exe",
    executable: "node.exe",
    commandLine: "node scripts/validation-runner/fixtures/hold-open.mjs",
  }];

  const refuseSameStart = decideForceKill(
    { pid: reusedPid, startMs: 1_000, name: "node.exe", commandLine: snapshot[0].commandLine },
    { pid: reusedPid, alive: true, startMs: 9_999, name: "node.exe", commandLine: "node other" },
    { rootAlive: false, rootPid: ownedRoot },
  );
  assert.equal(refuseSameStart.kill, false);
  assert.equal(refuseSameStart.diagnostic, IDENTITY_DIAGNOSTIC);

  const result = await cleanupOwnedTree(ownedRoot, {
    platform: "win32",
    snapshot,
    graceMs: 20,
    logger,
    isPidAlive: (pid) => pid === reusedPid,
    inspectProcessFn: async (pid) => ({
      pid,
      alive: pid === reusedPid,
      startMs: 9_999,
      name: "node.exe",
      executable: "node.exe",
      commandLine: "node totally-different-process",
    }),
    runShortCommand: async (file, args) => {
      if (file === "taskkill") {
        forceKills.push({ file, args });
      }
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, OUTCOMES.CHILD_CLEANUP_FAILED);
  assert.ok(result.identityMismatches.some((item) => item.pid === reusedPid));
  assert.equal(result.forceKills.length, 0);
  assert.equal(forceKills.length, 0);
  assert.match(logger.joined(), new RegExp(IDENTITY_DIAGNOSTIC));
});

test("T23 classifyProcessPresence distinguishes gone, same, reused, and uncertain", () => {
  const snapshot = {
    pid: 4242,
    startMs: 1_000,
    name: "node.exe",
    commandLine: "node scripts/validation-runner/fixtures/hold-open.mjs",
  };
  assert.equal(
    classifyProcessPresence(snapshot, { pid: 4242, alive: false }).class,
    PROCESS_PRESENCE.GONE,
  );
  assert.equal(
    classifyProcessPresence(snapshot, { ...snapshot, alive: true }).class,
    PROCESS_PRESENCE.ALIVE_SAME_IDENTITY,
  );
  assert.equal(
    classifyProcessPresence(snapshot, {
      pid: 4242,
      alive: true,
      startMs: 9_999,
      name: "node.exe",
      commandLine: "node other",
    }).class,
    PROCESS_PRESENCE.PID_REUSED,
  );
  assert.equal(
    classifyProcessPresence(snapshot, {
      pid: 4242,
      alive: true,
      startMs: null,
      name: null,
      inspectFailed: true,
    }).class,
    PROCESS_PRESENCE.INSPECTION_UNCERTAIN,
  );
  assert.equal(
    classifyProcessPresence(
      { pid: 4242, startMs: null, name: "unknown", commandLine: "" },
      { pid: 4242, alive: true, startMs: 1_000, name: "node.exe", commandLine: "node hold-open.mjs" },
    ).class,
    PROCESS_PRESENCE.INSPECTION_UNCERTAIN,
  );
  const incompleteRoot = decideForceKill(
    { pid: 4242, startMs: null, name: "unknown", commandLine: "" },
    { pid: 4242, alive: true, startMs: 1_000, name: "node.exe", commandLine: "node hold-open.mjs" },
    { rootAlive: true, rootPid: 4242 },
  );
  assert.equal(incompleteRoot.kill, true);
  assert.notEqual(incompleteRoot.diagnostic, IDENTITY_DIAGNOSTIC);
});

test("T23 inspect timeout after the process exits is GONE", async () => {
  let alive = true;
  const live = await inspectProcessIdentity(4242, {
    platform: "win32",
    isPidAlive: () => alive,
    runShortCommand: async () => {
      alive = false;
      return { code: null, stdout: "", stderr: "", timedOut: true };
    },
  });
  assert.equal(live.alive, false);
  assert.equal(classifyProcessPresence({
    pid: 4242,
    startMs: 1_000,
    name: "node.exe",
    commandLine: "node hold-open.mjs",
  }, live).class, PROCESS_PRESENCE.GONE);
});

test("T23 inspectFailed owned root is force-killed instead of false PID reuse", async () => {
  const logger = createCaptureLogger();
  const ownedRoot = 9999;
  const forceKills = [];
  let alive = true;
  const result = await cleanupOwnedTree(ownedRoot, {
    platform: "win32",
    snapshot: [{
      pid: ownedRoot,
      ppid: 1,
      startMs: 1_000,
      name: "node.exe",
      commandLine: "node scripts/validation-runner/fixtures/hold-open.mjs",
    }],
    graceMs: 20,
    logger,
    isPidAlive: () => alive,
    inspectProcessFn: async (pid) => {
      if (!alive) {
        return { pid, alive: false, startMs: null, name: null, commandLine: null };
      }
      return {
        pid,
        alive: true,
        startMs: null,
        name: null,
        commandLine: null,
        inspectFailed: true,
      };
    },
    runShortCommand: async (file, args) => {
      if (file === "taskkill" && args.includes("/F")) {
        forceKills.push({ file, args });
        alive = false;
      }
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.identityMismatches.length, 0);
  assert.ok(forceKills.length > 0);
  assert.match(logger.joined(), new RegExp(PROCESS_PRESENCE.INSPECTION_UNCERTAIN));
});

test("T23 incomplete owned-root snapshot does not leave a live child as cleanup failure", async () => {
  let holder;
  try {
    holder = await spawnUntilOutput(HOLD_OPEN, ["30000"], "HOLD_OPEN_PID=");
    const result = await cleanupOwnedTree(holder.child.pid, {
      platform: "win32",
      snapshot: [{
        pid: holder.child.pid,
        ppid: process.pid,
        startMs: null,
        name: "unknown",
        commandLine: "",
      }],
      graceMs: 800,
      logger: createCaptureLogger(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.identityMismatches.length, 0);
    assert.equal(isPidAlive(holder.child.pid), false);
  } finally {
    if (holder?.child?.pid && isPidAlive(holder.child.pid)) {
      await stopChild(holder.child);
    }
  }
});

test("lock release deletes only the current run's validation and prisma-generate locks", async () => {
  const worktree = createWorktree();
  try {
    const validationPath = validationLockPath(worktree);
    const prismaPath = prismaGenerateLockPath(worktree);
    writeFileSync(
      validationPath,
      `${JSON.stringify(createLockPayload({ runId: "run-a", command: "fast", worktree }), null, 2)}\n`,
    );
    writeFileSync(
      prismaPath,
      `${JSON.stringify(createLockPayload({ runId: "gen-a", command: "prisma:generate", worktree }), null, 2)}\n`,
    );

    assert.equal(releaseWorktreeLock(validationPath, "run-b").released, false);
    assert.equal(releaseWorktreeLock(validationPath, "run-b").reason, "run-id-mismatch");
    assert.equal(readLockPayload(validationPath).runId, "run-a");
    assert.equal(releaseWorktreeLock(prismaPath, "gen-b").released, false);
    assert.equal(readLockPayload(prismaPath).runId, "gen-a");

    assert.equal(releaseWorktreeLock(validationPath, "run-a").released, true);
    assert.equal(releaseWorktreeLock(prismaPath, "gen-a").released, true);
    assert.equal(existsSync(validationPath), false);
    assert.equal(existsSync(prismaPath), false);
  } finally {
    removeWorktree(worktree);
  }
});

test("T22 operator cancellation cleans the owned tree and releases the owned lock", async () => {
  const worktree = createWorktree();
  const controller = new AbortController();
  const logger = createCaptureLogger();
  let unrelated;
  try {
    unrelated = await spawnUntilOutput(HOLD_OPEN, ["30000"], "HOLD_OPEN_PID=");
    const lockPath = validationLockPath(worktree);
    const running = runValidation({
      command: "fast",
      worktreeRoot: worktree,
      toolchainRoot: REPO_ROOT,
      heartbeatMs: 0,
      cleanupGraceMs: 800,
      signal: controller.signal,
      steps: [hungStep("cancel-me", 10_000)],
      logger,
      forwardOutput: false,
    });
    await waitUntil(() => existsSync(lockPath), 2_000, "validation.lock never appeared");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(existsSync(lockPath));
    controller.abort();
    const result = await Promise.race([
      running,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("T22 in-process cancel exceeded bound")), 8_000);
      }),
    ]);
    assert.equal(result.outcome, OUTCOMES.VALIDATION_CANCELLED);
    assert.equal(existsSync(lockPath), false);
    const childPid = result.steps?.[0]?.childPid;
    assert.ok(childPid);
    assert.equal(isPidAlive(childPid), false);
    assert.equal(isPidAlive(unrelated.child.pid), true);
    assert.match(logger.joined(), /CANCELLATION_IN_PROGRESS/);
    assert.match(logger.joined(), /OWNED_PROCESS_TREE/);
  } finally {
    await stopChild(unrelated?.child);
    removeWorktree(worktree);
  }
});

test("operator cancellation is single-flight and documents Windows signal delivery", () => {
  const events = [];
  const cancellation = createOperatorCancellation({
    onFirst: () => events.push("first"),
    onRepeat: (signalName) => events.push(`repeat:${signalName}`),
  });
  const first = cancellation.handleSignal("SIGINT");
  const second = cancellation.handleSignal("SIGTERM");
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(cancellation.isInProgress(), true);
  assert.equal(cancellation.controller.signal.aborted, true);
  assert.deepEqual(events, ["first", "repeat:SIGTERM"]);
  const windows = supportedOperatorSignals("win32");
  assert.equal(windows.automatedDeliveryReliable, false);
  assert.match(windows.operator, /Ctrl\+C/);
  const posix = supportedOperatorSignals("linux");
  assert.equal(posix.automatedDeliveryReliable, true);
  assert.deepEqual(posix.signals, ["SIGINT", "SIGTERM"]);
});

test("T22 POSIX SIGTERM cancels a synthetic runner child", {
  skip: process.platform === "win32" ? "Windows child.kill(SIGTERM) does not deliver JS handlers" : false,
}, async () => {
  const worktree = createWorktree();
  let unrelated;
  let runner;
  try {
    unrelated = await spawnUntilOutput(HOLD_OPEN, ["30000"], "HOLD_OPEN_PID=");
    runner = await spawnUntilOutput(SYNTHETIC_CANCEL, [worktree, "20000"], "SYNTHETIC_CANCEL_READY", 8_000);
    const lockPath = validationLockPath(worktree);
    await waitUntil(() => existsSync(lockPath), 2_000, "synthetic runner lock never appeared");
    runner.child.kill("SIGTERM");
    const exit = await Promise.race([
      new Promise((resolve) => runner.child.once("exit", (code, signalName) => resolve({ code, signalName }))),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("T22 POSIX runner did not exit boundedly")), 8_000);
      }),
    ]);
    assert.ok(exit.code === 8 || exit.signalName == null);
    await waitUntil(() => !existsSync(lockPath), 2_000, "synthetic runner lock survived cancel");
    assert.equal(isPidAlive(unrelated.child.pid), true);
    assert.match(runner.output + String(runner.child.stdout ?? ""), /VALIDATION_CANCELLED|SYNTHETIC_CANCEL_READY/);
  } finally {
    if (runner?.child?.pid && isPidAlive(runner.child.pid)) {
      await stopChild(runner.child);
    }
    await stopChild(unrelated?.child);
    removeWorktree(worktree);
  }
});
