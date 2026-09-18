import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  planUatRuntimeTermination,
  UAT_OWNED_PROCESS_REGISTRY_SCHEMA,
  type UatOwnedProcessRegistry,
  type UatOwnedRuntimeRecord,
  type UatProcessEvidence,
} from "./large-realistic-uat-process-ownership";
import {
  collectProcessEvidence,
  commandMayStopOwnedRuntime,
  readLiveProcessCreationIdentity,
  stopChildTree,
  stopLabOwnedRuntime,
  terminateOwnedPidTree,
  writeUatOwnedProcessRegistry,
} from "./large-realistic-uat-runtime";

const WORKTREE = "C:/Projects/Negotiations AI/negotiations-web-stage-3-25a-bug02";
const OWNED_COMMAND = `"C:\\Program Files\\nodejs\\node.exe" "${WORKTREE.replace(
  /\//gu,
  "\\",
)}\\node_modules\\next\\dist\\server\\lib\\start-server.js"`;

function registry(records: UatOwnedRuntimeRecord[]): UatOwnedProcessRegistry {
  return { schema: UAT_OWNED_PROCESS_REGISTRY_SCHEMA, records };
}

function ownedRecord(overrides: Partial<UatOwnedRuntimeRecord> = {}): UatOwnedRuntimeRecord {
  return {
    port: 3101,
    sentinel: "sentinel-token",
    worktreeRoot: WORKTREE,
    distDir: ".next-e2e",
    launcherPid: 5000,
    launcherCreationIdentity: "id-5000",
    launcherCommandSignature: "cmd.exe /d /s /c npx next dev -H 127.0.0.1 -p 3101",
    listeners: [{ pid: 5001, commandLine: OWNED_COMMAND, creationIdentity: "id-5001" }],
    spawnedAt: "2026-09-16T09:00:00.000Z",
    ...overrides,
  };
}

function evidence(overrides: Partial<UatProcessEvidence> & { pid: number }): UatProcessEvidence {
  return {
    running: true,
    commandLine: "",
    workingDirectory: null,
    listeningPorts: [],
    creationIdentity: `id-${overrides.pid}`,
    ...overrides,
  };
}

test("UAT-PID-01 an unrelated Next-like process on 3101 survives cleanup", () => {
  const plan = planUatRuntimeTermination({
    registry: registry([]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: 7777,
        commandLine: "node C:\\Users\\dev\\other-app\\node_modules\\next\\dist\\bin\\next dev -p 3101",
        listeningPorts: [3101],
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.deepEqual(
    plan.verdicts.map((verdict) => [verdict.pid, verdict.reason]),
    [[7777, "NOT_RECORDED"]],
  );
});

test("UAT-PID-02 a recorded harness-owned runtime can be terminated", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: record.launcherPid,
        commandLine: record.launcherCommandSignature,
      }),
      evidence({
        pid: 5001,
        commandLine: OWNED_COMMAND,
        listeningPorts: [3101],
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids.sort(), [5000, 5001]);
});

test("UAT-PID-03 a reused pid with a different command line is never terminated", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: record.launcherPid,
        commandLine: record.launcherCommandSignature,
      }),
      evidence({
        pid: 5001,
        commandLine: "C:\\Windows\\System32\\svchost.exe -k NetworkService",
        listeningPorts: [3101],
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  const listener = plan.verdicts.find((verdict) => verdict.pid === 5001);
  assert.equal(listener?.reason, "COMMAND_MISMATCH");
  const launcher = plan.verdicts.find((verdict) => verdict.pid === 5000);
  assert.equal(launcher?.reason, "NO_PROVEN_LISTENER");
});

test("UAT-PID-04 a sibling worktree running the same command is never terminated", () => {
  const siblingCommand = OWNED_COMMAND.replace("bug02", "bug03");
  const record = ownedRecord({
    listeners: [{ pid: 5001, commandLine: siblingCommand, creationIdentity: "id-5001" }],
  });
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({ pid: 5000, commandLine: record.launcherCommandSignature }),
      evidence({ pid: 5001, commandLine: siblingCommand, listeningPorts: [3101] }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.equal(
    plan.verdicts.find((verdict) => verdict.pid === 5001)?.reason,
    "WORKTREE_MISMATCH",
  );

  const foreignRegistry = planUatRuntimeTermination({
    registry: registry([ownedRecord({ worktreeRoot: `${WORKTREE}-other` })]),
    currentWorktreeRoot: WORKTREE,
    evidence: [evidence({ pid: 5001, commandLine: OWNED_COMMAND, listeningPorts: [3101] })],
  });
  assert.deepEqual(foreignRegistry.terminablePids, []);
});

test("UAT-PID-04b a proven runtime whose listener moved ports is never terminated", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({ pid: 5000, commandLine: record.launcherCommandSignature }),
      evidence({ pid: 5001, commandLine: OWNED_COMMAND, listeningPorts: [3100] }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 5001)?.reason, "PORT_MISMATCH");
});

test("UAT-PID-05 provider mode stops zero browser and dev-server processes", () => {
  assert.equal(commandMayStopOwnedRuntime("provider"), false);
  assert.equal(commandMayStopOwnedRuntime("provider", "default"), false);
});

test("UAT-PID-06 report, preflight, cleanup and headless resume stop zero processes", () => {
  assert.equal(commandMayStopOwnedRuntime("report"), false);
  assert.equal(commandMayStopOwnedRuntime("preflight"), false);
  assert.equal(commandMayStopOwnedRuntime("cleanup"), false);
  assert.equal(commandMayStopOwnedRuntime("manual", "resume"), false);
  assert.equal(commandMayStopOwnedRuntime("manual", "default"), true);
  assert.equal(commandMayStopOwnedRuntime("manual", "recovery"), true);
});

test("protected ancestor pids are never terminated even when recorded", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({ pid: 5000, commandLine: record.launcherCommandSignature }),
      evidence({ pid: 5001, commandLine: OWNED_COMMAND, listeningPorts: [3101] }),
    ],
    protectedPids: [5000, 5001],
  });

  assert.deepEqual(plan.terminablePids, []);
});

test("a missing dist dir makes the recorded runtime unprovable", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({ pid: 5000, commandLine: record.launcherCommandSignature }),
      evidence({ pid: 5001, commandLine: OWNED_COMMAND, listeningPorts: [3101] }),
    ],
    distDirPresent: false,
  });

  assert.deepEqual(plan.terminablePids, []);
});

test("PID-REUSE-01 same pid/command/worktree/port/dist with a different CreationDate is not terminated", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: record.launcherPid,
        commandLine: record.launcherCommandSignature,
        creationIdentity: "reused-launcher",
      }),
      evidence({
        pid: 5001,
        commandLine: OWNED_COMMAND,
        listeningPorts: [3101],
        creationIdentity: "reused-listener",
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 5001)?.reason, "PID_REUSED");
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 5000)?.reason, "PID_REUSED");
});

test("PID-REUSE-03 exact pid + CreationDate + ownership evidence is terminable", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: record.launcherPid,
        commandLine: record.launcherCommandSignature,
      }),
      evidence({
        pid: 5001,
        commandLine: OWNED_COMMAND,
        listeningPorts: [3101],
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids.sort(), [5000, 5001]);
});

test("PID-REUSE-04 missing CreationDate fails closed", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: record.launcherPid,
        commandLine: record.launcherCommandSignature,
        creationIdentity: null,
      }),
      evidence({
        pid: 5001,
        commandLine: OWNED_COMMAND,
        listeningPorts: [3101],
        creationIdentity: null,
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.equal(
    plan.verdicts.find((verdict) => verdict.pid === 5001)?.reason,
    "OWNERSHIP_UNPROVEN",
  );
  assert.equal(
    plan.verdicts.find((verdict) => verdict.pid === 5000)?.reason,
    "OWNERSHIP_UNPROVEN",
  );
});

test("PID-REUSE-05 ancestor pids remain protected even with matching CreationDate", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({ pid: 5000, commandLine: record.launcherCommandSignature }),
      evidence({ pid: 5001, commandLine: OWNED_COMMAND, listeningPorts: [3101] }),
    ],
    protectedPids: [5000, 5001],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 5001)?.reason, "PROTECTED_PID");
});

test("PID-REUSE-06 an unrelated same-command listener is not recorded and survives", () => {
  const plan = planUatRuntimeTermination({
    registry: registry([]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: 7777,
        commandLine: OWNED_COMMAND,
        listeningPorts: [3101],
        creationIdentity: "id-7777",
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids, []);
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 7777)?.reason, "NOT_RECORDED");
});

test("PID-REUSE-07 a valid listener does not tree-kill a reused launcher/root pid", () => {
  const record = ownedRecord();
  const plan = planUatRuntimeTermination({
    registry: registry([record]),
    currentWorktreeRoot: WORKTREE,
    evidence: [
      evidence({
        pid: record.launcherPid,
        commandLine: record.launcherCommandSignature,
        creationIdentity: "reused-root",
      }),
      evidence({
        pid: 5001,
        commandLine: OWNED_COMMAND,
        listeningPorts: [3101],
      }),
    ],
  });

  assert.deepEqual(plan.terminablePids, [5001]);
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 5000)?.reason, "PID_REUSED");
  assert.equal(plan.verdicts.find((verdict) => verdict.pid === 5001)?.reason, "OWNED");
});

function listenerScript(): string {
  return [
    "import { createServer } from 'node:http';",
    "const port = Number(process.argv[2]);",
    "createServer((_req, res) => res.end('ok')).listen(port, '127.0.0.1', () => {",
    "  process.stdout.write('listening\\n');",
    "});",
  ].join("\n");
}

function waitForListening(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fixture server did not listen")), 20_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

test(
  "UAT-PID-01/02 at process level: only the registered fixture process is terminated",
  { skip: process.platform !== "win32" ? "Windows-only process ownership probe" : false },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "uat-pid-ownership-"));
    await mkdir(path.join(root, ".next-e2e"), { recursive: true });
    const scriptPath = path.join(root, "fixture-listener.mjs");
    await writeFile(scriptPath, listenerScript(), "utf8");

    const ownedPort = 39101;
    const unrelatedPort = 39102;
    const owned = spawn(process.execPath, [scriptPath, String(ownedPort)], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const unrelated = spawn(process.execPath, [scriptPath, String(unrelatedPort)], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    t.after(() => {
      owned.kill();
      unrelated.kill();
    });

    await Promise.all([waitForListening(owned), waitForListening(unrelated)]);
    assert.ok(owned.pid && unrelated.pid);

    const ownedEvidence = await collectProcessEvidence(owned.pid);
    assert.equal(ownedEvidence.running, true);
    assert.ok(ownedEvidence.listeningPorts.includes(ownedPort));
    const ownedIdentity = ownedEvidence.creationIdentity;
    assert.ok(ownedIdentity);
    assert.match(ownedIdentity, /^\d{14}\.\d+[+-]\d+$/u);

    await writeUatOwnedProcessRegistry(root, {
      schema: UAT_OWNED_PROCESS_REGISTRY_SCHEMA,
      records: [
        {
          port: ownedPort,
          sentinel: "fixture-sentinel",
          worktreeRoot: root,
          distDir: ".next-e2e",
          launcherPid: owned.pid,
          launcherCreationIdentity: ownedIdentity,
          launcherCommandSignature: ownedEvidence.commandLine,
          listeners: [
            {
              pid: owned.pid,
              commandLine: ownedEvidence.commandLine,
              creationIdentity: ownedIdentity,
            },
          ],
          spawnedAt: new Date().toISOString(),
        },
      ],
    });

    const stopped = await stopLabOwnedRuntime({ repoRoot: root });
    assert.deepEqual(stopped.stoppedPids, [owned.pid]);

    const unrelatedAfter = await collectProcessEvidence(unrelated.pid);
    assert.equal(unrelatedAfter.running, true, "unrelated fixture process must survive cleanup");
  },
);

test(
  "PID-REUSE-02 owned child exit then simulated PID reuse does not kill the replacement",
  { skip: process.platform !== "win32" ? "Windows-only process ownership probe" : false },
  async (t) => {
    const scriptPath = path.join(await mkdtemp(path.join(tmpdir(), "uat-pid-reuse-")), "fixture-listener.mjs");
    await writeFile(scriptPath, listenerScript(), "utf8");

    const original = spawn(process.execPath, [scriptPath, "39111"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    await waitForListening(original);
    assert.ok(original.pid);
    const originalIdentity = await readLiveProcessCreationIdentity(original.pid);
    assert.ok(originalIdentity);

    original.kill();
    await new Promise((resolve) => original.once("exit", resolve));

    const replacement = spawn(process.execPath, [scriptPath, "39112"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    t.after(() => {
      replacement.kill();
    });
    await waitForListening(replacement);
    assert.ok(replacement.pid);
    const replacementIdentity = await readLiveProcessCreationIdentity(replacement.pid);
    assert.ok(replacementIdentity);
    assert.notEqual(replacementIdentity, originalIdentity);

    const reusedPidResult = await terminateOwnedPidTree(replacement.pid, originalIdentity);
    assert.equal(reusedPidResult, "PID_REUSED");
    const stillRunning = await collectProcessEvidence(replacement.pid);
    assert.equal(stillRunning.running, true, "replacement process must survive identity mismatch");

    await stopChildTree(original, originalIdentity);
    const afterStaleCleanup = await collectProcessEvidence(replacement.pid);
    assert.equal(afterStaleCleanup.running, true);
  },
);

test(
  "PID-REUSE-03/04 at process level: matching CreationDate kills; missing evidence fails closed",
  { skip: process.platform !== "win32" ? "Windows-only process ownership probe" : false },
  async (t) => {
    const scriptPath = path.join(await mkdtemp(path.join(tmpdir(), "uat-pid-identity-")), "fixture-listener.mjs");
    await writeFile(scriptPath, listenerScript(), "utf8");

    const owned = spawn(process.execPath, [scriptPath, "39113"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const unrelated = spawn(process.execPath, [scriptPath, "39114"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    t.after(() => {
      owned.kill();
      unrelated.kill();
    });
    await Promise.all([waitForListening(owned), waitForListening(unrelated)]);
    assert.ok(owned.pid && unrelated.pid);

    const ownedIdentity = await readLiveProcessCreationIdentity(owned.pid);
    assert.ok(ownedIdentity);
    const capturedAgain = await readLiveProcessCreationIdentity(owned.pid);
    assert.equal(capturedAgain, ownedIdentity);

    assert.equal(await terminateOwnedPidTree(owned.pid, ""), "OWNERSHIP_UNPROVEN");
    assert.equal((await collectProcessEvidence(owned.pid)).running, true);

    assert.equal(await terminateOwnedPidTree(owned.pid, ownedIdentity), "KILLED");
    assert.equal((await collectProcessEvidence(owned.pid)).running, false);

    assert.equal((await collectProcessEvidence(unrelated.pid)).running, true);
  },
);
