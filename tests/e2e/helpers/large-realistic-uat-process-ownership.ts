/**
 * Ownership authority for processes the Large-Realistic UAT harness may stop.
 *
 * The harness never infers ownership from "a Next process is listening on 3100
 * or 3101". A process is terminable only when this worktree's own registry
 * recorded it at spawn time and the live process still matches that record.
 */

export const UAT_OWNED_PROCESS_REGISTRY_SCHEMA = "uat-owned-processes-v1";

export type UatRecordedListener = {
  pid: number;
  commandLine: string;
  /** Normalized Win32_Process.CreationDate captured at registration. */
  creationIdentity: string;
};

export type UatOwnedRuntimeRecord = {
  /** Port the harness asked the server to listen on. */
  port: number;
  /** Random per-spawn token also exported into the child environment. */
  sentinel: string;
  /** Absolute worktree root the harness ran from. */
  worktreeRoot: string;
  /** Next dist dir the harness pinned for this runtime. */
  distDir: string;
  /** PID of the process the harness itself spawned. */
  launcherPid: number;
  /** Normalized Win32_Process.CreationDate of the spawned launcher. */
  launcherCreationIdentity: string;
  /** Command line snapshot of the spawned process, taken at spawn time. */
  launcherCommandSignature: string;
  /** Listener PIDs observed once the spawned server became healthy. */
  listeners: UatRecordedListener[];
  spawnedAt: string;
};

export type UatOwnedProcessRegistry = {
  schema: typeof UAT_OWNED_PROCESS_REGISTRY_SCHEMA;
  records: UatOwnedRuntimeRecord[];
};

export type UatProcessEvidence = {
  pid: number;
  running: boolean;
  commandLine: string;
  /** Working directory when the platform can report it; `null` otherwise. */
  workingDirectory: string | null;
  listeningPorts: number[];
  /** Sentinel read back from the live process when the platform allows it. */
  sentinel?: string | null;
  /**
   * Live Win32_Process.CreationDate. `null` when the OS identity cannot be
   * read; that is never treated as ownership proof.
   */
  creationIdentity: string | null;
};

export type UatOwnershipRefusal =
  | "NOT_RECORDED"
  | "NOT_RUNNING"
  | "NO_EVIDENCE"
  | "PROTECTED_PID"
  | "COMMAND_MISMATCH"
  | "WORKTREE_MISMATCH"
  | "DIST_DIR_MISMATCH"
  | "PORT_MISMATCH"
  | "SENTINEL_MISMATCH"
  | "NO_PROVEN_LISTENER"
  | "PID_REUSED"
  | "OWNERSHIP_UNPROVEN";

export type UatOwnershipVerdict = {
  pid: number;
  owned: boolean;
  reason: "OWNED" | UatOwnershipRefusal;
};

export type UatOwnershipPlan = {
  terminablePids: number[];
  verdicts: UatOwnershipVerdict[];
};

function normalizePath(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/[\\/]+$/u, "").replace(/\\/gu, "/").toLowerCase();
}

function normalizeCommandLine(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a.length > 0 && a === b;
}

function commandLineMatchesRecord(observed: string, recorded: string): boolean {
  const live = normalizeCommandLine(observed);
  const snapshot = normalizeCommandLine(recorded);
  if (live.length === 0 || snapshot.length === 0) return false;
  return live === snapshot;
}

function commandLineIsInWorktree(commandLine: string, worktreeRoot: string): boolean {
  const root = normalizePath(worktreeRoot);
  if (root.length === 0) return false;
  return normalizeCommandLine(commandLine).replace(/\\/gu, "/").includes(root);
}

export function normalizeProcessCreationIdentity(
  value: string | null | undefined,
): string {
  if (!value) return "";
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

export function processCreationIdentitiesMatch(
  recorded: string | null | undefined,
  live: string | null | undefined,
): boolean {
  const a = normalizeProcessCreationIdentity(recorded);
  const b = normalizeProcessCreationIdentity(live);
  return a.length > 0 && a === b;
}

export function judgeProcessCreationIdentity(params: {
  recorded: string | null | undefined;
  live: string | null | undefined;
}): "PID_REUSED" | "OWNERSHIP_UNPROVEN" | null {
  const recorded = normalizeProcessCreationIdentity(params.recorded);
  const live = normalizeProcessCreationIdentity(params.live);
  if (recorded.length === 0 || live.length === 0) return "OWNERSHIP_UNPROVEN";
  if (recorded !== live) return "PID_REUSED";
  return null;
}

/**
 * Worktree proof accepts either a reported working directory or a command line
 * that names this worktree. Either one rules out a same-named process from a
 * sibling worktree.
 */
export function evidenceProvesWorktree(
  evidence: UatProcessEvidence,
  worktreeRoot: string,
): boolean {
  if (samePath(evidence.workingDirectory, worktreeRoot)) return true;
  return commandLineIsInWorktree(evidence.commandLine, worktreeRoot);
}

function evidenceFor(
  evidence: ReadonlyArray<UatProcessEvidence>,
  pid: number,
): UatProcessEvidence | undefined {
  return evidence.find((entry) => entry.pid === pid);
}

function judgeListener(params: {
  listener: UatRecordedListener;
  record: UatOwnedRuntimeRecord;
  evidence: ReadonlyArray<UatProcessEvidence>;
  protectedPids: ReadonlySet<number>;
  distDirPresent: boolean;
}): UatOwnershipVerdict {
  const { listener, record, protectedPids, distDirPresent } = params;
  const found = evidenceFor(params.evidence, listener.pid);
  if (protectedPids.has(listener.pid)) {
    return { pid: listener.pid, owned: false, reason: "PROTECTED_PID" };
  }
  if (!found) return { pid: listener.pid, owned: false, reason: "NO_EVIDENCE" };
  if (!found.running) return { pid: listener.pid, owned: false, reason: "NOT_RUNNING" };
  const identityRefusal = judgeProcessCreationIdentity({
    recorded: listener.creationIdentity,
    live: found.creationIdentity,
  });
  if (identityRefusal) {
    return { pid: listener.pid, owned: false, reason: identityRefusal };
  }
  if (!commandLineMatchesRecord(found.commandLine, listener.commandLine)) {
    return { pid: listener.pid, owned: false, reason: "COMMAND_MISMATCH" };
  }
  if (!evidenceProvesWorktree(found, record.worktreeRoot)) {
    return { pid: listener.pid, owned: false, reason: "WORKTREE_MISMATCH" };
  }
  if (!distDirPresent) {
    return { pid: listener.pid, owned: false, reason: "DIST_DIR_MISMATCH" };
  }
  if (!found.listeningPorts.includes(record.port)) {
    return { pid: listener.pid, owned: false, reason: "PORT_MISMATCH" };
  }
  if (typeof found.sentinel === "string" && found.sentinel !== record.sentinel) {
    return { pid: listener.pid, owned: false, reason: "SENTINEL_MISMATCH" };
  }
  return { pid: listener.pid, owned: true, reason: "OWNED" };
}

/**
 * A record is terminable only as a whole tree: at least one recorded listener
 * must still prove ownership before the spawned wrapper process is touched.
 */
export function planUatRuntimeTermination(params: {
  registry: UatOwnedProcessRegistry;
  currentWorktreeRoot: string;
  evidence: ReadonlyArray<UatProcessEvidence>;
  protectedPids?: Iterable<number>;
  distDirPresent?: boolean;
}): UatOwnershipPlan {
  const protectedPids = new Set(
    [...(params.protectedPids ?? [])].filter((pid) => Number.isInteger(pid) && pid > 0),
  );
  const distDirPresent = params.distDirPresent ?? true;
  const verdicts: UatOwnershipVerdict[] = [];
  const terminable = new Set<number>();
  const recordedPids = new Set<number>();

  for (const record of params.registry.records ?? []) {
    recordedPids.add(record.launcherPid);
    for (const listener of record.listeners ?? []) recordedPids.add(listener.pid);

    const worktreeMatches = samePath(record.worktreeRoot, params.currentWorktreeRoot);
    if (!worktreeMatches) {
      for (const pid of [record.launcherPid, ...(record.listeners ?? []).map((l) => l.pid)]) {
        verdicts.push({ pid, owned: false, reason: "WORKTREE_MISMATCH" });
      }
      continue;
    }

    const listenerVerdicts = (record.listeners ?? []).map((listener) =>
      judgeListener({
        listener,
        record,
        evidence: params.evidence,
        protectedPids,
        distDirPresent,
      }),
    );
    verdicts.push(...listenerVerdicts);
    const provenListener = listenerVerdicts.some((verdict) => verdict.owned);
    for (const verdict of listenerVerdicts) {
      if (verdict.owned) terminable.add(verdict.pid);
    }

    const launcher = evidenceFor(params.evidence, record.launcherPid);
    if (protectedPids.has(record.launcherPid)) {
      verdicts.push({ pid: record.launcherPid, owned: false, reason: "PROTECTED_PID" });
    } else if (!launcher) {
      verdicts.push({ pid: record.launcherPid, owned: false, reason: "NO_EVIDENCE" });
    } else if (!launcher.running) {
      verdicts.push({ pid: record.launcherPid, owned: false, reason: "NOT_RUNNING" });
    } else {
      const identityRefusal = judgeProcessCreationIdentity({
        recorded: record.launcherCreationIdentity,
        live: launcher.creationIdentity,
      });
      if (identityRefusal) {
        verdicts.push({ pid: record.launcherPid, owned: false, reason: identityRefusal });
      } else if (!commandLineMatchesRecord(launcher.commandLine, record.launcherCommandSignature)) {
        verdicts.push({ pid: record.launcherPid, owned: false, reason: "COMMAND_MISMATCH" });
      } else if (!distDirPresent) {
        verdicts.push({ pid: record.launcherPid, owned: false, reason: "DIST_DIR_MISMATCH" });
      } else if (!provenListener) {
        verdicts.push({ pid: record.launcherPid, owned: false, reason: "NO_PROVEN_LISTENER" });
      } else {
        verdicts.push({ pid: record.launcherPid, owned: true, reason: "OWNED" });
        terminable.add(record.launcherPid);
      }
    }
  }

  for (const entry of params.evidence) {
    if (recordedPids.has(entry.pid)) continue;
    verdicts.push({ pid: entry.pid, owned: false, reason: "NOT_RECORDED" });
  }

  return { terminablePids: [...terminable], verdicts };
}

export function recordedCreationIdentityForPid(
  registry: UatOwnedProcessRegistry,
  pid: number,
): string | undefined {
  for (const record of registry.records ?? []) {
    if (record.launcherPid === pid) {
      const identity = normalizeProcessCreationIdentity(record.launcherCreationIdentity);
      if (identity) return identity;
    }
    for (const listener of record.listeners ?? []) {
      if (listener.pid === pid) {
        const identity = normalizeProcessCreationIdentity(listener.creationIdentity);
        if (identity) return identity;
      }
    }
  }
  return undefined;
}

export function emptyUatOwnedProcessRegistry(): UatOwnedProcessRegistry {
  return { schema: UAT_OWNED_PROCESS_REGISTRY_SCHEMA, records: [] };
}

export function parseUatOwnedProcessRegistry(raw: unknown): UatOwnedProcessRegistry {
  if (!raw || typeof raw !== "object") return emptyUatOwnedProcessRegistry();
  const candidate = raw as Partial<UatOwnedProcessRegistry>;
  if (candidate.schema !== UAT_OWNED_PROCESS_REGISTRY_SCHEMA) {
    return emptyUatOwnedProcessRegistry();
  }
  const records = Array.isArray(candidate.records) ? candidate.records : [];
  return {
    schema: UAT_OWNED_PROCESS_REGISTRY_SCHEMA,
    records: records.filter(
      (record): record is UatOwnedRuntimeRecord =>
        Boolean(record) &&
        Number.isInteger(record.launcherPid) &&
        record.launcherPid > 0 &&
        Number.isInteger(record.port) &&
        typeof record.worktreeRoot === "string" &&
        typeof record.launcherCommandSignature === "string",
    ),
  };
}
