import { requireSafePid, runShortCommand } from "./command.mjs";
import { isPidAlive } from "./lock.mjs";
import { OUTCOMES } from "./outcomes.mjs";

export const CLEANUP_GRACE_MS = 10_000;
const MAX_TREE_NODES = 200;
const MAX_TREE_DEPTH = 32;
const COMMAND_LINE_LIMIT = 180;

export const POSIX_CLEANUP_PLAN = Object.freeze([
  { action: "signal", signal: "SIGTERM", target: "owned-process-group" },
  { action: "wait", waitMs: CLEANUP_GRACE_MS },
  { action: "signal", signal: "SIGKILL", target: "owned-process-group" },
  { action: "verify-owned-tree-gone" },
]);

export const WINDOWS_CLEANUP_PLAN = Object.freeze([
  { action: "dump-owned-tree" },
  { action: "taskkill", pidSource: "owned-root", tree: true, force: false },
  { action: "wait", waitMs: CLEANUP_GRACE_MS },
  { action: "reinspect-owned-tree" },
  { action: "revalidate-identity", when: "reparented-or-root-gone" },
  {
    action: "taskkill",
    pidSource: "identity-confirmed-owned",
    tree: false,
    force: true,
    ifSurvivors: true,
  },
  { action: "verify-owned-tree-gone" },
]);

export const IDENTITY_DIAGNOSTIC = "PID_REUSED_OR_IDENTITY_CHANGED";

export const PROCESS_PRESENCE = Object.freeze({
  GONE: "GONE",
  ALIVE_SAME_IDENTITY: "ALIVE_SAME_IDENTITY",
  PID_REUSED: "PID_REUSED",
  INSPECTION_UNCERTAIN: "INSPECTION_UNCERTAIN",
});

export function posixSignalDecision() {
  return {
    target: "owned-process-group",
    graceful: "SIGTERM",
    force: "SIGKILL",
    fallback: "owned-root",
  };
}

export function posixCleanupPlan() {
  return POSIX_CLEANUP_PLAN;
}

export function windowsCleanupPlan() {
  return WINDOWS_CLEANUP_PLAN;
}

export function buildTaskkillArgs(pid, options = {}) {
  const safePid = requireSafePid(pid);
  const args = ["/PID", String(safePid)];
  if (options.tree) {
    args.push("/T");
  }
  if (options.force) {
    args.push("/F");
  }
  if (args.includes("/IM") || args.some((arg) => /\.exe$/i.test(arg) && arg !== "/PID")) {
    throw new Error("Refusing image-name process kill");
  }
  return args;
}

export function tagProcess(entry) {
  const haystack = `${entry.name ?? ""} ${entry.commandLine ?? ""}`.toLowerCase();
  const tags = [];
  if (/\.test\.ts\b/.test(haystack)) {
    tags.push("*.test.ts");
  }
  if (haystack.includes("prisma")) {
    tags.push("prisma");
  }
  if (haystack.includes("tsx") || haystack.includes("esbuild")) {
    tags.push("tsx/esbuild");
  }
  if (haystack.includes("playwright")) {
    tags.push("playwright");
  }
  if (haystack.includes("next") && haystack.includes("build")) {
    tags.push("next build");
  }
  return tags;
}

export function truncateCommandLine(commandLine, limit = COMMAND_LINE_LIMIT) {
  const value = String(commandLine ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 3)}...`;
}

export function parseStartMs(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(value).trim() !== "") {
    return asNumber;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const POSIX_LSTART_RE =
  /^(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)\s+(.*)$/;

export function parsePosixPsLine(line) {
  const match = String(line ?? "").trim().match(POSIX_LSTART_RE);
  if (!match) {
    return null;
  }
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    startMs: parseStartMs(match[3]),
    name: match[4],
    commandLine: match[5],
    executable: match[4],
  };
}

export function normalizeProcessName(name) {
  const normalized = String(name ?? "").trim().toLowerCase().replace(/\.exe$/, "");
  return normalized === "unknown" ? "" : normalized;
}

export function classifyProcessPresence(snapshot, live) {
  if (!live?.alive) {
    return { class: PROCESS_PRESENCE.GONE };
  }
  if (live.inspectFailed) {
    return { class: PROCESS_PRESENCE.INSPECTION_UNCERTAIN };
  }
  if (snapshot?.startMs == null || live.startMs == null) {
    return { class: PROCESS_PRESENCE.INSPECTION_UNCERTAIN };
  }
  if (identitiesMatch(snapshot, live)) {
    return { class: PROCESS_PRESENCE.ALIVE_SAME_IDENTITY };
  }
  return { class: PROCESS_PRESENCE.PID_REUSED };
}

export function namesCompatible(snapshot, live) {
  const left = normalizeProcessName(snapshot?.name ?? snapshot?.executable);
  const right = normalizeProcessName(live?.name ?? live?.executable);
  if (!left || !right) {
    return true;
  }
  return left === right;
}

export function commandLinesCompatible(snapshotCmd, liveCmd) {
  const left = String(snapshotCmd ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const right = String(liveCmd ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!left || !right) {
    return true;
  }
  return left === right || left.includes(right) || right.includes(left);
}

export function snapshotProcessIdentity(entry) {
  return {
    pid: Number(entry?.pid),
    startMs: parseStartMs(entry?.startMs),
    name: entry?.name ?? null,
    executable: entry?.executable ?? null,
    commandLine: entry?.commandLine ?? "",
  };
}

export function identitiesMatch(snapshot, live) {
  if (!snapshot || !live?.alive) {
    return false;
  }
  if (Number(snapshot.pid) !== Number(live.pid)) {
    return false;
  }
  if (snapshot.startMs == null || live.startMs == null) {
    return false;
  }
  if (Number(snapshot.startMs) !== Number(live.startMs)) {
    return false;
  }
  if (!namesCompatible(snapshot, live)) {
    return false;
  }
  if (!commandLinesCompatible(snapshot.commandLine, live.commandLine)) {
    return false;
  }
  return true;
}

export function decideForceKill(snapshot, live, context = {}) {
  if (!live?.alive) {
    return { kill: false, reason: "already-gone" };
  }

  const rootPid = Number(context.rootPid);
  const relationshipGone =
    context.rootAlive !== true || Number(snapshot?.pid) !== rootPid;
  const presence = classifyProcessPresence(snapshot, live);

  if (!relationshipGone) {
    if (presence.class === PROCESS_PRESENCE.PID_REUSED) {
      return { kill: false, reason: IDENTITY_DIAGNOSTIC, diagnostic: IDENTITY_DIAGNOSTIC };
    }
    return { kill: true, reason: "owned-root-relationship-intact", tree: true };
  }

  if (presence.class === PROCESS_PRESENCE.INSPECTION_UNCERTAIN) {
    return { kill: false, reason: PROCESS_PRESENCE.INSPECTION_UNCERTAIN };
  }
  if (presence.class !== PROCESS_PRESENCE.ALIVE_SAME_IDENTITY) {
    return { kill: false, reason: IDENTITY_DIAGNOSTIC, diagnostic: IDENTITY_DIAGNOSTIC };
  }
  return { kill: true, reason: "owned-identity-confirmed", tree: false };
}

export function parseWindowsProcessJson(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({
        pid: Number(row.ProcessId ?? row.pid),
        ppid: Number(row.ParentProcessId ?? row.ppid),
        name: row.Name ?? row.name ?? null,
        commandLine: row.CommandLine ?? row.commandLine ?? "",
        executable: row.ExecutablePath ?? row.executable ?? null,
        startMs: parseStartMs(row.StartMs ?? row.startMs ?? row.CreationDate ?? row.creationDate),
      }))
      .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
  } catch {
    return [];
  }
}

export function buildProcessTree(rootPid, processes) {
  const safeRoot = requireSafePid(rootPid);
  const byParent = new Map();
  for (const processInfo of processes) {
    const list = byParent.get(processInfo.ppid) ?? [];
    list.push(processInfo);
    byParent.set(processInfo.ppid, list);
  }

  const ordered = [];
  const seen = new Set();
  const queue = [{ pid: safeRoot, depth: 0 }];
  while (queue.length > 0 && ordered.length < MAX_TREE_NODES) {
    const current = queue.shift();
    if (seen.has(current.pid) || current.depth > MAX_TREE_DEPTH) {
      continue;
    }
    seen.add(current.pid);
    const self = processes.find((item) => item.pid === current.pid);
    if (self) {
      ordered.push({ ...self, tags: tagProcess(self) });
    }
    for (const child of byParent.get(current.pid) ?? []) {
      queue.push({ pid: child.pid, depth: current.depth + 1 });
    }
  }
  return ordered;
}

function windowsProcessSelectCommand(filter) {
  return [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath,@{n='StartMs';e={if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { $null }}} | ConvertTo-Json -Compress`,
  ];
}

async function queryWindowsProcesses(filter, runner) {
  const result = await runner(
    "powershell.exe",
    windowsProcessSelectCommand(filter),
  );
  return {
    rows: parseWindowsProcessJson(result.stdout),
    timedOut: Boolean(result.timedOut),
  };
}

async function readWindowsProcess(pid, runner) {
  const queried = await queryWindowsProcesses(`ProcessId = ${requireSafePid(pid)}`, runner);
  return queried.rows;
}

async function listWindowsChildren(parentPid, runner) {
  const queried = await queryWindowsProcesses(
    `ParentProcessId = ${requireSafePid(parentPid)}`,
    runner,
  );
  return queried.rows;
}

export async function collectOwnedTree(rootPid, deps = {}) {
  const runner = deps.runShortCommand ?? runShortCommand;
  const platform = deps.platform ?? process.platform;
  let safeRoot;
  try {
    safeRoot = requireSafePid(rootPid);
  } catch {
    return [];
  }

  if (platform === "win32") {
    const collected = [];
    const seen = new Set();
    const queue = [safeRoot];
    while (queue.length > 0 && collected.length < MAX_TREE_NODES) {
      const current = queue.shift();
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const self = current === safeRoot
        ? await readWindowsProcess(current, runner)
        : [];
      const children = await listWindowsChildren(current, runner);
      const rows = current === safeRoot ? [...self, ...children] : children;
      for (const row of rows) {
        if (!seen.has(row.pid) || row.pid === current) {
          if (!collected.some((item) => item.pid === row.pid)) {
            collected.push({ ...row, tags: tagProcess(row) });
          }
        }
        if (row.pid !== current) {
          queue.push(row.pid);
        }
      }
    }
    if (!collected.some((item) => item.pid === safeRoot) && isPidAlive(safeRoot)) {
      collected.unshift({
        pid: safeRoot,
        ppid: null,
        name: null,
        commandLine: "",
        executable: null,
        startMs: null,
        inspectFailed: true,
        tags: [],
      });
    }
    return collected;
  }

  const result = await runner("ps", ["-ax", "-o", "pid=,ppid=,lstart=,comm=,args="]);
  const processes = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parsePosixPsLine(line))
    .filter(Boolean);
  return buildProcessTree(safeRoot, processes);
}

export function formatOwnedTreeDump(entries) {
  if (!entries?.length) {
    return "[validation] OWNED_PROCESS_TREE\n  (empty)";
  }
  const lines = ["[validation] OWNED_PROCESS_TREE"];
  for (const entry of entries) {
    const tags = entry.tags?.length ? ` tags=${entry.tags.join(",")}` : "";
    lines.push(
      `  pid=${entry.pid} ppid=${entry.ppid ?? "unknown"} name=${entry.name ?? "unknown"} cmd=${truncateCommandLine(entry.commandLine)}${tags}`,
    );
  }
  return lines.join("\n");
}

export function formatChildTreeSummary(entries) {
  if (!entries?.length) {
    return "CHILD_TREE: unavailable";
  }
  const compact = entries
    .slice(0, 6)
    .map((entry) => `${entry.pid} ${entry.name ?? "proc"}`)
    .join(", ");
  const extra = entries.length > 6 ? ` +${entries.length - 6}` : "";
  return `CHILD_TREE: ${entries.length} procs [${compact}${extra}]`;
}

export async function dumpOwnedTree(rootPid, logger, deps = {}) {
  const entries = await collectOwnedTree(rootPid, deps);
  logger?.line?.(formatOwnedTreeDump(entries));
  return entries;
}

function snapshotIdentities(entries, rootPid) {
  const byPid = new Map();
  for (const entry of entries ?? []) {
    if (Number.isInteger(entry.pid) && entry.pid > 0) {
      byPid.set(entry.pid, snapshotProcessIdentity(entry));
    }
  }
  const root = Number(rootPid);
  if (Number.isInteger(root) && root > 0 && !byPid.has(root)) {
    byPid.set(root, snapshotProcessIdentity({ pid: root }));
  }
  return [...byPid.values()];
}

export async function inspectProcessIdentity(pid, deps = {}) {
  const aliveFn = deps.isPidAlive ?? isPidAlive;
  let safePid;
  try {
    safePid = requireSafePid(pid);
  } catch {
    return { pid, alive: false, startMs: null, name: null, executable: null, commandLine: null };
  }

  if (!aliveFn(safePid)) {
    return { pid: safePid, alive: false, startMs: null, name: null, executable: null, commandLine: null };
  }

  const platform = deps.platform ?? process.platform;
  const runner = deps.runShortCommand ?? runShortCommand;

  if (platform === "win32") {
    const queried = await queryWindowsProcesses(`ProcessId = ${safePid}`, runner);
    if (!aliveFn(safePid)) {
      return { pid: safePid, alive: false, startMs: null, name: null, executable: null, commandLine: null };
    }
    const row = queried.rows.find((item) => item.pid === safePid) ?? queried.rows[0];
    if (!row || queried.timedOut) {
      return { pid: safePid, alive: true, startMs: null, name: null, executable: null, commandLine: null, inspectFailed: true };
    }
    return {
      pid: row.pid,
      alive: true,
      startMs: row.startMs ?? null,
      name: row.name ?? null,
      executable: row.executable ?? null,
      commandLine: row.commandLine ?? "",
    };
  }

  const result = await runner("ps", ["-p", String(safePid), "-o", "lstart=,comm=,args="]);
  if (!aliveFn(safePid)) {
    return { pid: safePid, alive: false, startMs: null, name: null, executable: null, commandLine: null };
  }
  const parsed = parsePosixPsLine(`${safePid} 0 ${String(result.stdout ?? "").trim()}`);
  if (!parsed || result.timedOut) {
    return { pid: safePid, alive: true, startMs: null, name: null, executable: null, commandLine: null, inspectFailed: true };
  }
  return {
    pid: safePid,
    alive: true,
    startMs: parsed.startMs,
    name: parsed.name,
    executable: parsed.executable,
    commandLine: parsed.commandLine,
  };
}

async function classifySurvivors(identities, inspectFn, logger, identityMismatches) {
  const ownedRemaining = [];
  for (const identity of identities) {
    const live = await inspectFn(identity.pid);
    const presence = classifyProcessPresence(identity, live);
    if (presence.class === PROCESS_PRESENCE.GONE) {
      continue;
    }
    if (presence.class === PROCESS_PRESENCE.PID_REUSED) {
      identityMismatches.push({ pid: identity.pid, diagnostic: IDENTITY_DIAGNOSTIC });
      logger?.line?.(`[validation] ${IDENTITY_DIAGNOSTIC} pid=${identity.pid}`);
      continue;
    }
    if (presence.class === PROCESS_PRESENCE.INSPECTION_UNCERTAIN) {
      logger?.line?.(`[validation] ${PROCESS_PRESENCE.INSPECTION_UNCERTAIN} pid=${identity.pid}`);
    }
    ownedRemaining.push(identity);
  }
  return ownedRemaining;
}

function aliveFromSnapshot(pids, isAliveFn = isPidAlive) {
  return pids.filter((pid) => isAliveFn(pid));
}

async function waitForOwnedPidsToExit(pids, graceMs, isAliveFn = isPidAlive) {
  const deadline = Date.now() + graceMs;
  let remaining = aliveFromSnapshot(pids, isAliveFn);
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    remaining = aliveFromSnapshot(pids, isAliveFn);
  }
  return remaining;
}

async function taskkillOwned(pid, options, runner) {
  const args = buildTaskkillArgs(pid, options);
  return runner("taskkill", args, { timeoutMs: 5_000 });
}

async function signalPosixGroup(rootPid, signal) {
  try {
    process.kill(-requireSafePid(rootPid), signal);
    return { ok: true, target: "owned-process-group" };
  } catch (groupError) {
    if (groupError && groupError.code === "ESRCH") {
      try {
        process.kill(requireSafePid(rootPid), signal);
        return { ok: true, target: "owned-root" };
      } catch (rootError) {
        if (rootError && rootError.code === "ESRCH") {
          return { ok: true, target: "already-gone" };
        }
        return { ok: false, error: rootError };
      }
    }
    try {
      process.kill(requireSafePid(rootPid), signal);
      return { ok: true, target: "owned-root-fallback" };
    } catch (rootError) {
      return { ok: false, error: rootError };
    }
  }
}

export async function cleanupOwnedTree(rootPid, options = {}) {
  const graceMs = options.graceMs ?? CLEANUP_GRACE_MS;
  const runner = options.runShortCommand ?? runShortCommand;
  const platform = options.platform ?? process.platform;
  const isAliveFn = options.isPidAlive ?? isPidAlive;
  const logger = options.logger;
  const snapshotEntries = options.snapshot ?? (await collectOwnedTree(rootPid, options));
  const identities = snapshotIdentities(snapshotEntries, rootPid);
  const ownedPids = identities.map((entry) => entry.pid);
  const inspectFn = options.inspectProcessFn
    ?? ((pid) => inspectProcessIdentity(pid, { ...options, isPidAlive: isAliveFn, runShortCommand: runner, platform }));
  const identityMismatches = [];
  const forceKills = [];

  const failCleanup = (ownedRemaining) => {
    const remaining = ownedRemaining.map((entry) => entry.pid);
    logger?.line?.(`[validation] ${OUTCOMES.CHILD_CLEANUP_FAILED} remaining=${remaining.join(",") || "none"}`);
    return {
      ok: false,
      outcome: OUTCOMES.CHILD_CLEANUP_FAILED,
      remaining,
      identityMismatches,
      forceKills,
      snapshot: snapshotEntries,
    };
  };

  const succeed = () => ({
    ok: true,
    remaining: [],
    identityMismatches,
    forceKills,
    snapshot: snapshotEntries,
  });

  if (platform === "win32") {
    if (isAliveFn(rootPid)) {
      await taskkillOwned(rootPid, { tree: true, force: false }, runner);
    }
    await waitForOwnedPidsToExit(ownedPids, graceMs, isAliveFn);
    let ownedRemaining = await classifySurvivors(identities, inspectFn, logger, identityMismatches);
    if (ownedRemaining.length === 0) {
      return identityMismatches.length > 0 ? failCleanup([]) : succeed();
    }

    if (isAliveFn(rootPid)) {
      const rootIdentity = identities.find((entry) => entry.pid === Number(rootPid))
        ?? snapshotProcessIdentity({ pid: rootPid });
      const live = await inspectFn(rootIdentity.pid);
      const decision = decideForceKill(rootIdentity, live, {
        rootAlive: true,
        rootPid,
      });
      if (decision.diagnostic === IDENTITY_DIAGNOSTIC) {
        identityMismatches.push({ pid: rootIdentity.pid, diagnostic: IDENTITY_DIAGNOSTIC });
        logger?.line?.(`[validation] ${IDENTITY_DIAGNOSTIC} pid=${rootIdentity.pid}`);
      } else if (decision.kill) {
        forceKills.push(rootIdentity.pid);
        await taskkillOwned(rootIdentity.pid, { tree: true, force: true }, runner);
      }
    } else {
      for (const identity of ownedRemaining) {
        const live = await inspectFn(identity.pid);
        const decision = decideForceKill(identity, live, {
          rootAlive: false,
          rootPid,
        });
        if (decision.diagnostic === IDENTITY_DIAGNOSTIC) {
          identityMismatches.push({ pid: identity.pid, diagnostic: IDENTITY_DIAGNOSTIC });
          logger?.line?.(`[validation] ${IDENTITY_DIAGNOSTIC} pid=${identity.pid}`);
          continue;
        }
        if (!decision.kill) {
          continue;
        }
        forceKills.push(identity.pid);
        await taskkillOwned(identity.pid, { tree: false, force: true }, runner);
      }
    }

    await waitForOwnedPidsToExit(ownedPids, 1_000, isAliveFn);
    ownedRemaining = await classifySurvivors(identities, inspectFn, logger, identityMismatches);
    if (ownedRemaining.length > 0 || identityMismatches.length > 0) {
      return failCleanup(ownedRemaining);
    }
    return succeed();
  }

  await signalPosixGroup(rootPid, "SIGTERM");
  await waitForOwnedPidsToExit(ownedPids, graceMs, isAliveFn);
  let ownedRemaining = await classifySurvivors(identities, inspectFn, logger, identityMismatches);
  if (ownedRemaining.length === 0) {
    return identityMismatches.length > 0 ? failCleanup([]) : succeed();
  }

  await signalPosixGroup(rootPid, "SIGKILL");
  await waitForOwnedPidsToExit(ownedPids, 1_000, isAliveFn);
  ownedRemaining = await classifySurvivors(identities, inspectFn, logger, identityMismatches);
  if (ownedRemaining.length > 0) {
    return failCleanup(ownedRemaining);
  }
  if (identityMismatches.length > 0) {
    return failCleanup([]);
  }
  return succeed();
}
