import { spawn } from "node:child_process";

import { OUTCOMES, TIMEOUT_LAYERS } from "./outcomes.mjs";
import {
  cleanupOwnedTree,
  collectOwnedTree,
  dumpOwnedTree,
  formatChildTreeSummary,
} from "./process-tree.mjs";

export const DEFAULT_HEARTBEAT_MS = 25_000;
export const DEFAULT_OUTPUT_TAIL_BYTES = 16 * 1024;

const CURRENT_TEST_RE =
  /(?:^|[\\/\s"'`])((?:lib|app|components|scripts)[/\\][\w./\\-]+\.test\.ts)\b/i;

export function createBoundedTail(maxBytes = DEFAULT_OUTPUT_TAIL_BYTES) {
  const chunks = [];
  let size = 0;
  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buf);
      size += buf.length;
      while (size > maxBytes && chunks.length > 1) {
        size -= chunks.shift().length;
      }
      if (size > maxBytes && chunks.length === 1) {
        chunks[0] = chunks[0].subarray(chunks[0].length - maxBytes);
        size = maxBytes;
      }
    },
    toString() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function inferCurrentTest({ descendants = [], outputTail = "" } = {}) {
  for (const entry of descendants) {
    const match = String(entry.commandLine ?? "").match(CURRENT_TEST_RE);
    if (match) {
      return match[1].replace(/\\/g, "/");
    }
  }
  const fromOutput = String(outputTail).match(CURRENT_TEST_RE);
  if (fromOutput) {
    return fromOutput[1].replace(/\\/g, "/");
  }
  return "unknown";
}

export function formatHeartbeat(info) {
  const lastOutputAgeSec = Math.max(
    0,
    Math.floor((info.now - info.lastOutputAt) / 1000),
  );
  return [
    "[validation]",
    `RUN_ID: ${info.runId}`,
    `STEP: ${info.step}`,
    `STATUS: ${info.status ?? "RUNNING"}`,
    `ELAPSED: ${formatDuration(info.now - info.startedAt)}`,
    `TIMEOUT: ${formatDuration(info.timeoutMs)}`,
    `CHILD_PID: ${info.childPid}`,
    `LAST_OUTPUT_AGE: ${lastOutputAgeSec}s`,
    `CURRENT_TEST: ${info.currentTest ?? "unknown"}`,
    info.childTreeSummary ?? "CHILD_TREE: unavailable",
  ].join("\n");
}

export function createSpawnOptions({ cwd, env, platform = process.platform }) {
  if (platform === "win32") {
    return {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
    };
  }
  return {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  };
}

export async function runBoundedProcess(options) {
  const {
    runId,
    step,
    file,
    args = [],
    cwd = process.cwd(),
    env = process.env,
    timeoutMs,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
    signal,
    logger,
    forwardOutput = true,
    timeoutLayer = TIMEOUT_LAYERS.STEP_TIMEOUT,
    cleanupGraceMs,
  } = options;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      outcome: OUTCOMES.VALIDATION_TIMEOUT,
      timeoutLayer,
      childPid: null,
      reason: "non-positive-timeout",
    };
  }

  const startedAt = Date.now();
  let lastOutputAt = startedAt;
  const stdoutTail = createBoundedTail();
  const stderrTail = createBoundedTail();
  let childPid = null;
  let heartbeatTimer = null;
  let timeoutTimer = null;
  let settled = false;
  let abortHandler = null;
  let lastTreeSummary = "CHILD_TREE: unavailable";

  const child = spawn(file, args, createSpawnOptions({
    cwd,
    env: {
      ...env,
      VALIDATION_RUN_ID: runId,
    },
  }));
  childPid = child.pid ?? null;

  const stopWatchers = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
  };

  const finish = (result) => ({
    childPid,
    startedAt,
    endedAt: Date.now(),
    stdoutTail: stdoutTail.toString(),
    stderrTail: stderrTail.toString(),
    ...result,
  });

  child.stdout.on("data", (chunk) => {
    lastOutputAt = Date.now();
    stdoutTail.push(chunk);
    if (forwardOutput) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on("data", (chunk) => {
    lastOutputAt = Date.now();
    stderrTail.push(chunk);
    if (forwardOutput) {
      process.stderr.write(chunk);
    }
  });

  const emitHeartbeat = () => {
    if (settled || !childPid) {
      return;
    }
    const text = formatHeartbeat({
      runId,
      step,
      status: "RUNNING",
      now: Date.now(),
      startedAt,
      timeoutMs,
      lastOutputAt,
      childPid,
      currentTest: inferCurrentTest({
        descendants: [],
        outputTail: `${stdoutTail.toString()}\n${stderrTail.toString()}`,
      }),
      childTreeSummary: lastTreeSummary,
    });
    logger?.line?.(text);
    if (!logger) {
      process.stderr.write(`${text}\n`);
    }
    collectOwnedTree(childPid)
      .then((descendants) => {
        lastTreeSummary = formatChildTreeSummary(descendants);
      })
      .catch(() => {});
  };

  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(emitHeartbeat, heartbeatMs);
  }

  return new Promise((resolve) => {
    const settle = (result) => {
      if (settled) {
        return false;
      }
      settled = true;
      stopWatchers();
      resolve(finish(result));
      return true;
    };

    child.on("error", (error) => {
      settle({
        outcome: OUTCOMES.VALIDATION_FAILED,
        error,
        exitCode: null,
      });
    });

    child.on("exit", (exitCode, signalName) => {
      if (settled) {
        return;
      }
      if (exitCode === 0) {
        settle({
          outcome: OUTCOMES.VALIDATION_OK,
          exitCode,
          signalName,
        });
        return;
      }
      settle({
        outcome: OUTCOMES.VALIDATION_FAILED,
        exitCode,
        signalName,
      });
    });

    timeoutTimer = setTimeout(async () => {
      if (settled) {
        return;
      }
      settled = true;
      stopWatchers();
      let treeDump = [];
      try {
        treeDump = await dumpOwnedTree(childPid, logger);
      } catch (error) {
        logger?.line?.(`[validation] process-tree dump failed: ${error.message}`);
      }
      const cleanup = await cleanupOwnedTree(childPid, {
        graceMs: cleanupGraceMs,
        logger,
        snapshot: treeDump,
      });
      resolve(finish({
        outcome: cleanup.ok ? OUTCOMES.VALIDATION_TIMEOUT : OUTCOMES.CHILD_CLEANUP_FAILED,
        timeoutLayer,
        treeDump,
        cleanup,
      }));
    }, timeoutMs);

    if (signal) {
      abortHandler = async () => {
        if (settled) {
          return;
        }
        settled = true;
        stopWatchers();
        let treeDump = [];
        try {
          treeDump = await dumpOwnedTree(childPid, logger);
        } catch (error) {
          logger?.line?.(`[validation] process-tree dump failed: ${error.message}`);
          treeDump = [];
        }
        const cleanup = await cleanupOwnedTree(childPid, {
          graceMs: cleanupGraceMs,
          logger,
          snapshot: treeDump,
        });
        resolve(finish({
          outcome: cleanup.ok ? OUTCOMES.VALIDATION_CANCELLED : OUTCOMES.CHILD_CLEANUP_FAILED,
          treeDump,
          cleanup,
        }));
      };
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }
  });
}
