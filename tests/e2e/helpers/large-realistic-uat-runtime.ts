import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

import { buildE2eServerEnvironment } from "./e2e-database";
import {
  LARGE_REALISTIC_UAT_DIST_DIR,
  LARGE_REALISTIC_UAT_REPORT_DIR,
} from "./large-realistic-uat-constants";
import {
  emptyUatOwnedProcessRegistry,
  normalizeProcessCreationIdentity,
  parseUatOwnedProcessRegistry,
  planUatRuntimeTermination,
  recordedCreationIdentityForPid,
  type UatOwnedProcessRegistry,
  type UatOwnedRuntimeRecord,
  type UatOwnershipVerdict,
  type UatProcessEvidence,
} from "./large-realistic-uat-process-ownership";
import { applyFrozenEnhancementEnv } from "./large-realistic-uat-safety";

export const UAT_OWNED_PROCESS_REGISTRY_FILE = "owned-processes.json";
export const UAT_OWNER_SENTINEL_ENV = "LARGE_REALISTIC_UAT_OWNER_SENTINEL";

/**
 * Only headed operator modes ever consider stopping a previously spawned
 * runtime. Automated modes must leave every browser and dev server alone.
 */
const HEADED_MODES = new Set(["default", "recovery"]);

export type ListeningPid = {
  pid: number;
  port: number;
  commandLine: string;
};

const spawnedChildCreationIdentities = new WeakMap<ChildProcess, string>();

async function rememberSpawnedChildIdentity(target: ChildProcess): Promise<void> {
  if (!target.pid) return;
  const identity = await readLiveProcessCreationIdentity(target.pid);
  if (identity) spawnedChildCreationIdentities.set(target, identity);
}

function execText(command: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("exit", () => resolve(stdout));
    child.on("error", () => resolve(""));
  });
}

async function commandLineForPid(pid: number): Promise<string> {
  const raw = await execText(
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
  );
  return raw.trim();
}

export async function readLiveProcessCreationIdentity(
  pid: number,
): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== "win32") return null;
  const raw = await execText(
    [
      "[Console]::OutputEncoding = [System.Text.Encoding]::ASCII;",
      `$wmi = Get-WmiObject -Class Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue;`,
      "if ($null -ne $wmi -and $wmi.CreationDate) { [string]$wmi.CreationDate } else {",
      `$p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue;`,
      "  if ($null -eq $p) { '' } elseif ($p.CimInstanceProperties['CreationDate'].Value -is [datetime]) {",
      "    [System.Management.ManagementDateTimeConverter]::ToDmtfDateTime($p.CimInstanceProperties['CreationDate'].Value)",
      "  } else { [string]$p.CimInstanceProperties['CreationDate'].Value }",
      "}",
    ].join(" "),
  );
  const identity = normalizeProcessCreationIdentity(raw);
  return identity.length > 0 ? identity : null;
}

export type TerminateOwnedPidResult =
  | "KILLED"
  | "NOT_RUNNING"
  | "PID_REUSED"
  | "OWNERSHIP_UNPROVEN";

/**
 * Re-reads live Win32_Process.CreationDate immediately before taskkill.
 * PID alone is never termination authority.
 */
export async function terminateOwnedPidTree(
  pid: number,
  recordedCreationIdentity: string,
): Promise<TerminateOwnedPidResult> {
  const recorded = normalizeProcessCreationIdentity(recordedCreationIdentity);
  if (recorded.length === 0) return "OWNERSHIP_UNPROVEN";

  const liveIdentity = await readLiveProcessCreationIdentity(pid);
  if (!liveIdentity) {
    const commandLine = await commandLineForPid(pid);
    return commandLine.length === 0 ? "NOT_RUNNING" : "OWNERSHIP_UNPROVEN";
  }
  if (liveIdentity !== recorded) return "PID_REUSED";

  await taskkillPidTree(pid);
  return "KILLED";
}

export async function listListeningPids(ports: number[]): Promise<ListeningPid[]> {
  const portList = ports.join(",");
  const raw = await execText(
    `Get-NetTCPConnection -LocalPort ${portList} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
  );
  const pids = [
    ...new Set(
      raw
        .split(/\s+/u)
        .map((token) => Number(token.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    ),
  ];
  const results: ListeningPid[] = [];
  for (const pid of pids) {
    const commandLine = await commandLineForPid(pid);
    for (const port of ports) {
      results.push({ pid, port, commandLine });
    }
  }
  return results;
}

async function listeningPortsForPid(pid: number): Promise<number[]> {
  const raw = await execText(
    `Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort`,
  );
  return [
    ...new Set(
      raw
        .split(/\s+/u)
        .map((token) => Number(token.trim()))
        .filter((port) => Number.isInteger(port) && port > 0),
    ),
  ];
}

export async function collectProcessEvidence(pid: number): Promise<UatProcessEvidence> {
  const commandLine = await commandLineForPid(pid);
  if (!commandLine) {
    return {
      pid,
      running: false,
      commandLine: "",
      workingDirectory: null,
      listeningPorts: [],
      creationIdentity: null,
    };
  }
  return {
    pid,
    running: true,
    commandLine,
    // Windows does not expose a process working directory through CIM; the
    // command line carries the worktree path for the processes we record.
    workingDirectory: null,
    listeningPorts: await listeningPortsForPid(pid),
    creationIdentity: await readLiveProcessCreationIdentity(pid),
  };
}

export function uatOwnedProcessRegistryPath(repoRoot: string): string {
  return path.join(repoRoot, LARGE_REALISTIC_UAT_REPORT_DIR, UAT_OWNED_PROCESS_REGISTRY_FILE);
}

export async function readUatOwnedProcessRegistry(
  repoRoot: string,
): Promise<UatOwnedProcessRegistry> {
  try {
    const raw = await readFile(uatOwnedProcessRegistryPath(repoRoot), "utf8");
    return parseUatOwnedProcessRegistry(JSON.parse(raw));
  } catch {
    return emptyUatOwnedProcessRegistry();
  }
}

export async function writeUatOwnedProcessRegistry(
  repoRoot: string,
  registry: UatOwnedProcessRegistry,
): Promise<void> {
  const file = uatOwnedProcessRegistryPath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function recordOwnedRuntime(
  repoRoot: string,
  record: UatOwnedRuntimeRecord,
): Promise<void> {
  const registry = await readUatOwnedProcessRegistry(repoRoot);
  const records = registry.records.filter(
    (entry) => entry.launcherPid !== record.launcherPid || entry.port !== record.port,
  );
  records.push(record);
  await writeUatOwnedProcessRegistry(repoRoot, { ...registry, records });
}

async function forgetOwnedRuntimePids(repoRoot: string, pids: Iterable<number>): Promise<void> {
  const gone = new Set(pids);
  if (gone.size === 0) return;
  const registry = await readUatOwnedProcessRegistry(repoRoot);
  const records = registry.records.filter((record) => !gone.has(record.launcherPid));
  await writeUatOwnedProcessRegistry(repoRoot, { ...registry, records });
}

export async function collectAncestorPids(startPid: number): Promise<Set<number>> {
  const pids = new Set<number>();
  if (Number.isInteger(startPid) && startPid > 0) pids.add(startPid);
  if (process.ppid > 0) pids.add(process.ppid);
  if (process.platform !== "win32") return pids;

  let current = startPid;
  for (let depth = 0; depth < 16; depth += 1) {
    const raw = await execText(
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${current}").ParentProcessId`,
    );
    const parent = Number(raw.trim());
    if (!Number.isInteger(parent) || parent <= 0 || pids.has(parent)) break;
    pids.add(parent);
    current = parent;
  }
  return pids;
}

async function taskkillPidTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

/**
 * `provider`, `report`, `preflight`, `cleanup` and the non-headed `resume`
 * harness never terminate a browser or dev server.
 */
export function commandMayStopOwnedRuntime(command: string, mode = "default"): boolean {
  return command === "manual" && HEADED_MODES.has(mode);
}

export async function planUatOwnedRuntimeStop(params: {
  repoRoot: string;
}): Promise<{
  registry: UatOwnedProcessRegistry;
  evidence: UatProcessEvidence[];
  terminablePids: number[];
  verdicts: UatOwnershipVerdict[];
}> {
  const repoRoot = params.repoRoot;
  const registry = await readUatOwnedProcessRegistry(repoRoot);
  const recordedPids = new Set<number>();
  for (const record of registry.records) {
    recordedPids.add(record.launcherPid);
    for (const listener of record.listeners ?? []) recordedPids.add(listener.pid);
  }

  const evidence: UatProcessEvidence[] = [];
  for (const pid of recordedPids) {
    evidence.push(await collectProcessEvidence(pid));
  }

  const plan = planUatRuntimeTermination({
    registry,
    currentWorktreeRoot: repoRoot,
    evidence,
    protectedPids: await collectAncestorPids(process.pid),
    distDirPresent: existsSync(path.join(repoRoot, LARGE_REALISTIC_UAT_DIST_DIR)),
  });

  return { registry, evidence, ...plan };
}

export async function stopLabOwnedRuntime(params: {
  repoRoot: string;
}): Promise<{ stoppedPids: number[]; verdicts: UatOwnershipVerdict[] }> {
  const plan = await planUatOwnedRuntimeStop({ repoRoot: params.repoRoot });
  const stoppedPids: number[] = [];
  for (const pid of plan.terminablePids) {
    const identity = recordedCreationIdentityForPid(plan.registry, pid);
    const result = await terminateOwnedPidTree(pid, identity ?? "");
    if (result === "KILLED") stoppedPids.push(pid);
  }
  await forgetOwnedRuntimePids(params.repoRoot, stoppedPids);
  return { stoppedPids, verdicts: plan.verdicts };
}

export function buildLargeRealisticUatServerEnvironment(params: {
  port: number;
  appUrl: string;
  sentinel?: string;
}): Record<string, string> {
  applyFrozenEnhancementEnv(process.env);
  return buildE2eServerEnvironment({
    APP_URL: params.appUrl,
    BASE_URL: params.appUrl,
    PLAYWRIGHT_BASE_URL: params.appUrl,
    NEXT_PUBLIC_APP_URL: params.appUrl,
    NEXT_DIST_DIR: LARGE_REALISTIC_UAT_DIST_DIR,
    PORT: String(params.port),
    VIDEO_PROVIDER: "livekit",
    EMAIL_PROVIDER: "fake",
    EMAIL_DELIVERY_ENABLED: "true",
    EMAIL_CANONICAL_BASE_URL: "https://local.negotaitions.ru",
    ADMIN_EMAILS: "admin@example.com",
    EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "false",
    TRUSTED_PROXY_ENABLED: "false",
    EXTERNAL_SERVICES_MODE: "mock",
    RECORDING_MODE: "mock",
    TRANSCRIPTION_MODE: "mock",
    POST_TRANSCRIPTION_LAB: "",
    LARGE_REALISTIC_UAT_PROVIDER_OBSERVE: "1",
    [UAT_OWNER_SENTINEL_ENV]: params.sentinel ?? "",
    TRANSCRIPT_ENHANCEMENT_AUTO_RUN: "false",
    YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED: "true",
    LIVEKIT_URL: "wss://mock-livekit.invalid",
    LIVEKIT_API_KEY: "mock-livekit-key",
    LIVEKIT_API_SECRET: "mock-livekit-secret",
    VOXIMPLANT_SERVER_STOP_MODE: "disabled",
    AUTO_TRANSCRIBE_AFTER_RECORDING: "false",
    NODE_ENV: "development",
  });
}

export async function probeJsonHealth(baseUrl: string): Promise<{
  ok: boolean;
  contentType: string;
  bodyPreview: string;
  looksLikeHtml: boolean;
}> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const looksLikeHtml = /<html|<body|<!doctype html/i.test(body) || contentType.includes("text/html");
    return {
      ok: response.ok && contentType.includes("json") && !looksLikeHtml,
      contentType,
      bodyPreview: body.slice(0, 180),
      looksLikeHtml,
    };
  } catch (error) {
    return {
      ok: false,
      contentType: "",
      bodyPreview: error instanceof Error ? error.message : String(error),
      looksLikeHtml: false,
    };
  }
}

export async function clearStaleNextE2eDist(repoRoot: string): Promise<void> {
  await rm(path.join(repoRoot, LARGE_REALISTIC_UAT_DIST_DIR), { recursive: true, force: true });
}

function waitForSpawnOutput(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const onData = () => {
      clearTimeout(timer);
      resolve();
    };
    child.stdout?.once("data", onData);
    child.stderr?.once("data", onData);
  });
}

/**
 * Stops a previously spawned Large UAT runtime, but only the pids this
 * worktree's registry proves it owns. Anything else on the port is reported and
 * left running.
 */
async function releasePortForOwnedRestart(params: {
  repoRoot: string;
  port: number;
  purpose: string;
}): Promise<void> {
  const plan = await planUatOwnedRuntimeStop({ repoRoot: params.repoRoot });
  const listeners = await listListeningPids([params.port]);
  const ownedListeners = listeners.filter((entry) => plan.terminablePids.includes(entry.pid));
  if (ownedListeners.length === 0 && listeners.length > 0) {
    throw new Error(
      `Port ${params.port} is held by a process this harness cannot prove it owns (pids ${listeners
        .map((entry) => entry.pid)
        .join(", ")}). Refusing to stop it.`,
    );
  }
  if (ownedListeners.length === 0) return;
  console.log(`${params.purpose} Stopping registry-proven Large-UAT pids: ${plan.terminablePids.join(", ")}`);
  const stoppedPids: number[] = [];
  for (const pid of plan.terminablePids) {
    const identity = recordedCreationIdentityForPid(plan.registry, pid);
    const result = await terminateOwnedPidTree(pid, identity ?? "");
    if (result === "KILLED") stoppedPids.push(pid);
  }
  await forgetOwnedRuntimePids(params.repoRoot, stoppedPids);
}

export async function startUatNextServer(params: {
  repoRoot: string;
  port: number;
  restartIfObserveEnvRequired?: boolean;
}): Promise<{
  child: ChildProcess | null;
  baseUrl: string;
  clearedStaleDist: boolean;
  reused: boolean;
}> {
  const baseUrl = `http://127.0.0.1:${params.port}`;
  const existingHealth = await probeJsonHealth(baseUrl);
  if (existingHealth.ok && params.restartIfObserveEnvRequired) {
    await releasePortForOwnedRestart({
      repoRoot: params.repoRoot,
      port: params.port,
      purpose: `Restarting Large UAT Next on ${baseUrl} so LARGE_REALISTIC_UAT_PROVIDER_OBSERVE=1 is active.`,
    });
  } else if (existingHealth.ok && !params.restartIfObserveEnvRequired) {
    const plan = await planUatOwnedRuntimeStop({ repoRoot: params.repoRoot });
    const listeners = await listListeningPids([params.port]);
    const owned = listeners.some((entry) => plan.terminablePids.includes(entry.pid));
    if (owned || listeners.length === 0) {
      console.log(`Reusing healthy Large UAT Next server on ${baseUrl}`);
      return { child: null, baseUrl, clearedStaleDist: false, reused: true };
    }
    throw new Error(
      `Port ${params.port} already has a healthy HTTP server that is not registry-proven Large-UAT-owned. Refusing to reuse or kill it.`,
    );
  }

  const remaining = await listListeningPids([params.port]);
  if (remaining.length > 0) {
    await releasePortForOwnedRestart({
      repoRoot: params.repoRoot,
      port: params.port,
      purpose: `Stale Large-UAT-owned process on ${baseUrl} is unhealthy.`,
    });
  }

  const sentinel = randomUUID();
  const env = buildLargeRealisticUatServerEnvironment({
    port: params.port,
    appUrl: baseUrl,
    sentinel,
  });
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const spawnArgs = ["next", "dev", "-H", "127.0.0.1", "-p", String(params.port)];

  const spawnServer = () =>
    spawn(npx, spawnArgs, {
      cwd: params.repoRoot,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
      shell: process.platform === "win32",
    });

  let child = spawnServer();
  await rememberSpawnedChildIdentity(child);
  const prefix = "[uat-next]";
  const attachLogging = (target: ChildProcess) => {
    if (target.stdout) {
      createInterface({ input: target.stdout }).on("line", (line) => {
        if (line.includes("Ready") || line.includes("error") || line.includes("Error")) {
          console.log(`${prefix} ${line}`);
        }
      });
    }
    if (target.stderr) {
      createInterface({ input: target.stderr }).on("line", (line) => {
        console.error(`${prefix} ${line}`);
      });
    }
  };
  attachLogging(child);
  await waitForSpawnOutput(child, 8_000);

  const deadline = Date.now() + 120_000;
  let clearedStaleDist = false;
  while (Date.now() < deadline) {
    const health = await probeJsonHealth(baseUrl);
    if (health.ok) {
      await registerSpawnedRuntime({
        repoRoot: params.repoRoot,
        port: params.port,
        sentinel,
        child,
        spawnCommand: [npx, ...spawnArgs].join(" "),
      });
      return { child, baseUrl, clearedStaleDist, reused: false };
    }
    if (health.looksLikeHtml && !clearedStaleDist) {
      console.warn(
        "Stale .next-e2e returned HTML for /api/health. Clearing gitignored .next-e2e and restarting Next.",
      );
      await stopChildTree(child);
      await clearStaleNextE2eDist(params.repoRoot);
      clearedStaleDist = true;
      child = spawnServer();
      await rememberSpawnedChildIdentity(child);
      attachLogging(child);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await stopChildTree(child);
  throw new Error(`UAT Next server on ${baseUrl} did not become healthy.`);
}

async function registerSpawnedRuntime(params: {
  repoRoot: string;
  port: number;
  sentinel: string;
  child: ChildProcess;
  spawnCommand: string;
}): Promise<void> {
  const launcherPid = params.child.pid;
  if (!launcherPid) return;
  const launcherCommandSignature =
    process.platform === "win32" ? await commandLineForPid(launcherPid) : params.spawnCommand;
  const launcherCreationIdentity =
    (await readLiveProcessCreationIdentity(launcherPid)) ?? "";
  const listeners = [];
  for (const entry of await listListeningPids([params.port])) {
    if (entry.commandLine.length === 0) continue;
    listeners.push({
      pid: entry.pid,
      commandLine: entry.commandLine,
      creationIdentity: (await readLiveProcessCreationIdentity(entry.pid)) ?? "",
    });
  }
  await recordOwnedRuntime(params.repoRoot, {
    port: params.port,
    sentinel: params.sentinel,
    worktreeRoot: params.repoRoot,
    distDir: LARGE_REALISTIC_UAT_DIST_DIR,
    launcherPid,
    launcherCreationIdentity,
    launcherCommandSignature,
    listeners,
    spawnedAt: new Date().toISOString(),
  });
}

export async function stopChildTree(
  child: ChildProcess | null | undefined,
  recordedCreationIdentity?: string,
): Promise<void> {
  if (!child) return;
  if (!child.pid) {
    child.kill("SIGTERM");
    return;
  }
  const identity = normalizeProcessCreationIdentity(
    recordedCreationIdentity ?? spawnedChildCreationIdentities.get(child),
  );
  if (!identity) return;
  await terminateOwnedPidTree(child.pid, identity);
}