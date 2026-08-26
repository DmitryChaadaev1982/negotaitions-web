import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { requireSafePid, runShortCommand } from "./command.mjs";
import { LOCK_KINDS, OUTCOMES } from "./outcomes.mjs";
import { sameFsPath, toPosixPath } from "./paths.mjs";

const OWNER_MARKERS = Object.freeze({
  [LOCK_KINDS.VALIDATION]: [
    "scripts/validation-runner.mjs",
    "scripts/validation-runner/fixtures/hold-lock.mjs",
  ],
  [LOCK_KINDS.PRISMA_GENERATE]: [
    "scripts/prisma-generate-guarded.mjs",
    "scripts/validation-runner.mjs",
    "scripts/validation-runner/fixtures/hold-lock.mjs",
  ],
});

const EXPECTED_COMMANDS = Object.freeze({
  [LOCK_KINDS.VALIDATION]: ["fast", "build", "deploy"],
  [LOCK_KINDS.PRISMA_GENERATE]: ["prisma:generate", "prisma generate"],
});

const PROCESS_START_SLACK_MS = 2_000;

export function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) {
    return false;
  }
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    if (error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

export function createLockPayload({
  runId,
  command,
  worktree,
  pid = process.pid,
  startedAt = new Date().toISOString(),
  hostname = os.hostname(),
}) {
  return {
    runId,
    pid,
    startedAt,
    command,
    worktree,
    hostname,
  };
}

export function readLockPayload(lockPath) {
  try {
    const raw = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function tryExclusiveCreate(lockPath, payload) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if (error && error.code === "EEXIST") {
      return { ok: false, code: "EEXIST" };
    }
    throw error;
  }

  try {
    writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // close before unlink so Windows can remove a failed exclusive create
    }
    fd = undefined;
    try {
      unlinkSync(lockPath);
    } catch {
      // best-effort rollback of the exclusive create
    }
    throw error;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

export function recordedCommandIsExpected(command, kind) {
  const allowed = EXPECTED_COMMANDS[kind] ?? [];
  return allowed.includes(command);
}

export function liveProcessLooksLikeOwner(commandLine, kind) {
  const normalized = toPosixPath(commandLine).toLowerCase();
  if (!normalized) {
    return false;
  }
  const markers = OWNER_MARKERS[kind] ?? [];
  return markers.some((marker) => normalized.includes(marker.toLowerCase()));
}

export function classifyExistingLock(existing, requested, inspectResult, kind) {
  if (!existing || !inspectResult?.alive) {
    return "dead";
  }

  const worktreeMatch = sameFsPath(existing.worktree, requested.worktree);
  const hostnameMatch =
    !existing.hostname || !requested.hostname || existing.hostname === requested.hostname;
  const commandExpected = recordedCommandIsExpected(existing.command, kind);
  const liveLooksLikeOwner = liveProcessLooksLikeOwner(inspectResult.commandLine, kind);
  const startedAtMs = Date.parse(existing.startedAt);
  const createdAtMs = inspectResult.startMs;

  if (worktreeMatch && hostnameMatch && commandExpected) {
    if (liveLooksLikeOwner) {
      return "owned";
    }
    if (Number.isFinite(startedAtMs) && Number.isFinite(createdAtMs)) {
      if (createdAtMs <= startedAtMs + PROCESS_START_SLACK_MS) {
        return "owned";
      }
      return "ambiguous";
    }
    return "ambiguous";
  }

  return "ambiguous";
}

export async function inspectPid(pid, deps = {}) {
  const aliveFn = deps.isAlive ?? isPidAlive;
  if (!aliveFn(pid)) {
    return { alive: false, commandLine: null, startMs: null };
  }

  const platform = deps.platform ?? process.platform;
  const runner = deps.runShortCommand ?? runShortCommand;

  try {
    requireSafePid(pid);
  } catch {
    return { alive: false, commandLine: null, startMs: null };
  }

  if (platform === "win32") {
    const result = await runner("powershell.exe", [
      "-NoProfile",
      "-Command",
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${requireSafePid(pid)}"; if (-not $p) { exit 2 }; $ms = [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds(); Write-Output ("STARTMS=" + $ms); Write-Output ("CMDLINE=" + ($p.CommandLine ?? ""))`,
    ]);
    if (result.timedOut || result.code !== 0) {
      return { alive: true, commandLine: null, startMs: null, inspectFailed: true };
    }
    const startMatch = result.stdout.match(/^STARTMS=(\d+)\s*$/m);
    const cmdMatch = result.stdout.match(/^CMDLINE=(.*)$/m);
    return {
      alive: true,
      commandLine: cmdMatch ? cmdMatch[1] : null,
      startMs: startMatch ? Number(startMatch[1]) : null,
    };
  }

  try {
    const cmdline = deps.readFileSync
      ? deps.readFileSync(`/proc/${requireSafePid(pid)}/cmdline`, "utf8")
      : null;
    const commandLine = cmdline
      ? cmdline.replace(/\u0000/g, " ").trim()
      : (await runner("ps", ["-p", String(requireSafePid(pid)), "-o", "command="])).stdout.trim();
    let startMs = null;
    if (deps.statSync) {
      const stat = deps.statSync(`/proc/${requireSafePid(pid)}`);
      startMs = stat.birthtimeMs || stat.ctimeMs || null;
    } else {
      const ps = await runner("ps", ["-p", String(requireSafePid(pid)), "-o", "lstart="]);
      const parsed = Date.parse(ps.stdout.trim());
      startMs = Number.isFinite(parsed) ? parsed : null;
    }
    return { alive: true, commandLine, startMs };
  } catch {
    return { alive: true, commandLine: null, startMs: null, inspectFailed: true };
  }
}

export function formatExistingOwner(payload) {
  if (!payload) {
    return "Existing owner: (unreadable lock)";
  }
  return [
    "Existing owner:",
    `  runId: ${payload.runId ?? "(unknown)"}`,
    `  pid: ${payload.pid ?? "(unknown)"}`,
    `  startedAt: ${payload.startedAt ?? "(unknown)"}`,
    `  command: ${payload.command ?? "(unknown)"}`,
    `  worktree: ${payload.worktree ?? "(unknown)"}`,
    `  hostname: ${payload.hostname ?? "(unknown)"}`,
  ].join("\n");
}

export function releaseWorktreeLock(lockPath, runId) {
  const existing = readLockPayload(lockPath);
  if (!existing) {
    return { released: false, reason: "missing-or-unreadable" };
  }
  if (existing.runId !== runId) {
    return { released: false, reason: "run-id-mismatch" };
  }
  try {
    unlinkSync(lockPath);
    return { released: true };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { released: false, reason: "already-gone" };
    }
    throw error;
  }
}

export async function acquireWorktreeLock(options) {
  const {
    lockPath,
    payload,
    kind,
    forceStaleLock = false,
    inspectPidFn = inspectPid,
    logger,
  } = options;

  const first = tryExclusiveCreate(lockPath, payload);
  if (first.ok) {
    return { ok: true, recoveredStale: false, payload };
  }

  const existing = readLockPayload(lockPath);
  if (!existing) {
    return {
      ok: false,
      outcome: OUTCOMES.VALIDATION_STALE_LOCK,
      reason: "unreadable-lock",
      existing,
    };
  }

  const inspectResult = await inspectPidFn(existing.pid);
  const classification = classifyExistingLock(existing, payload, inspectResult, kind);

  if (classification === "owned") {
    return {
      ok: false,
      outcome: OUTCOMES.VALIDATION_ALREADY_RUNNING,
      reason: "live-matching-owner",
      existing,
    };
  }

  if (classification === "dead") {
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        return {
          ok: false,
          outcome: OUTCOMES.VALIDATION_STALE_LOCK,
          reason: "stale-unlink-failed",
          existing,
        };
      }
    }
    logger?.line?.(`[validation] recovered stale lock (dead pid ${existing.pid})`);
    const second = tryExclusiveCreate(lockPath, payload);
    if (second.ok) {
      return { ok: true, recoveredStale: true, payload, previous: existing };
    }
    return {
      ok: false,
      outcome: OUTCOMES.VALIDATION_ALREADY_RUNNING,
      reason: "lost-race-after-stale-recovery",
      existing: readLockPayload(lockPath),
    };
  }

  if (forceStaleLock) {
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        return {
          ok: false,
          outcome: OUTCOMES.VALIDATION_STALE_LOCK,
          reason: "force-unlink-failed",
          existing,
        };
      }
    }
    logger?.line?.("[validation] force-recovered ambiguous stale lock");
    const forced = tryExclusiveCreate(lockPath, payload);
    if (forced.ok) {
      return { ok: true, recoveredStale: true, forced: true, payload, previous: existing };
    }
    return {
      ok: false,
      outcome: OUTCOMES.VALIDATION_ALREADY_RUNNING,
      reason: "lost-race-after-force-recovery",
      existing: readLockPayload(lockPath),
    };
  }

  return {
    ok: false,
    outcome: OUTCOMES.VALIDATION_STALE_LOCK,
    reason: "ambiguous-live-pid",
    existing,
  };
}
