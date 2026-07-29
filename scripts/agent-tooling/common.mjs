import nextEnv from "@next/env";
import { Client } from "pg";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

export function loadRepositoryEnv(cwd = process.cwd()) {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(cwd);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizePath(value) {
  return value.replace(/\\/g, "/").toLowerCase();
}

export function normalizeFsPath(value) {
  if (!value) {
    return "";
  }
  const slashNormalized = value.replace(/\\/g, "/");
  const resolved = path.resolve(slashNormalized).replace(/\\/g, "/");
  const trimmed = resolved.replace(/\/+$/, "");
  return trimmed.toLowerCase();
}

export function sameFsPath(left, right) {
  if (!left || !right) {
    return false;
  }
  return normalizeFsPath(left) === normalizeFsPath(right);
}

export function parseCommandLineArgs(commandLine) {
  if (!commandLine) {
    return [];
  }
  const matches = commandLine.match(/"([^"]*)"|[^\s]+/g) ?? [];
  return matches.map((entry) => {
    if (entry.startsWith("\"") && entry.endsWith("\"")) {
      return entry.slice(1, -1);
    }
    return entry;
  });
}

export function extractWorktreeFromCommandLine(commandLine) {
  const args = parseCommandLineArgs(commandLine);
  for (const arg of args) {
    const normalized = arg.replace(/\\/g, "/");
    const marker = normalized.toLowerCase().indexOf("/node_modules/next/");
    if (marker > 0) {
      return normalized.slice(0, marker);
    }
  }
  return null;
}

export function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const useWindowsCmdShell =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(command);

  return withTimeout(
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env,
        shell: useWindowsCmdShell,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0 && !options.allowFailure) {
          reject(
            new Error(
              `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}: ${stderr.trim()}`,
            ),
          );
          return;
        }
        resolve({ code: code ?? 0, stdout, stderr });
      });
    }),
    timeoutMs,
    `${command} ${args.join(" ")}`,
  );
}

export async function git(args, options = {}) {
  const result = await runCommand("git", args, options);
  return result.stdout.trim();
}

export async function resolveGitCommonDir(worktree, deps = {}) {
  if (!worktree) {
    return null;
  }
  const gitFn = deps.git ?? git;
  try {
    const raw = await gitFn(["-C", worktree, "rev-parse", "--git-common-dir"], {
      cwd: deps.cwd ?? process.cwd(),
    });
    const target = raw.trim();
    if (!target) {
      return null;
    }
    return path.resolve(worktree, target);
  } catch {
    return null;
  }
}

export function parseDatabaseUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return null;
  }

  const database = parsed.pathname.replace(/^\//, "").split("?")[0]?.trim() || "";
  if (!database) {
    return null;
  }

  const host = (parsed.hostname || "").trim().toLowerCase();
  const normalizedHost =
    host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" ? "localhost" : host;
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isFinite(port)) {
    return null;
  }

  return {
    host,
    normalizedHost,
    port,
    database: database.toLowerCase(),
  };
}

export function databaseDescriptor(parsed) {
  if (!parsed) {
    return null;
  }
  return {
    host: parsed.normalizedHost || "(unknown)",
    port: parsed.port,
    database: parsed.database || "(unknown)",
  };
}

export function areConnectionTargetsEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    left.normalizedHost === right.normalizedHost &&
    left.port === right.port &&
    left.database === right.database
  );
}

export async function checkPostgresConnectivity(connectionString, timeoutMs = 2_500) {
  if (!connectionString) {
    return { connected: false, reason: "not-configured" };
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  });

  try {
    await withTimeout(client.connect(), timeoutMs + 500, "postgres connect");
    await withTimeout(client.query("SELECT 1"), timeoutMs + 500, "postgres select");
    return { connected: true, reason: "ok" };
  } catch (error) {
    return { connected: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore close errors in reporting paths.
    }
  }
}

export async function probeHttpHealth(url, timeoutMs = 2_500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "negotiations-agent-tooling/1.0",
      },
    });
    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function detectPort3000Owner(deps = {}) {
  const platform = deps.platform ?? process.platform;
  const runner = deps.runCommand ?? runCommand;

  if (platform === "win32") {
    const owner = await runner(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 OwningProcess | ConvertTo-Json -Compress",
      ],
      { allowFailure: true },
    );

    const rawOwner = owner.stdout.trim();
    if (owner.code !== 0 && !rawOwner) {
      const fallback = await runner(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "netstat -ano -p tcp | Select-String ':3000' | Select-Object -First 1 | ForEach-Object { $_.Line }",
        ],
        { allowFailure: true },
      );
      const line = fallback.stdout.trim();
      if (!line) {
        return { status: "free", pid: null, processName: null, commandLine: null };
      }
      const pidMatch = line.match(/(\d+)\s*$/);
      const fallbackPid = pidMatch ? Number(pidMatch[1]) : null;
      if (!fallbackPid || !Number.isFinite(fallbackPid)) {
        return { status: "occupied", pid: null, processName: null, commandLine: null };
      }
      const processInfoFallback = await runner(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "ProcessId = ${fallbackPid}" | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress`,
        ],
        { allowFailure: true },
      );
      let processNameFallback = null;
      let commandLineFallback = null;
      let executablePathFallback = null;
      try {
        const parsedProcess = JSON.parse(processInfoFallback.stdout.trim() || "{}");
        processNameFallback = parsedProcess?.Name ?? null;
        commandLineFallback = parsedProcess?.CommandLine ?? null;
        executablePathFallback = parsedProcess?.ExecutablePath ?? null;
      } catch {
        processNameFallback = null;
        commandLineFallback = null;
        executablePathFallback = null;
      }
      return {
        status: "occupied",
        pid: fallbackPid,
        processName: processNameFallback,
        commandLine: commandLineFallback,
        executablePath: executablePathFallback,
      };
    }
    if (!rawOwner) {
      return { status: "free", pid: null, processName: null, commandLine: null };
    }

    let pid = null;
    try {
      const parsed = JSON.parse(rawOwner);
      pid = Number(parsed?.OwningProcess ?? parsed);
    } catch {
      pid = null;
    }
    if (!pid || !Number.isFinite(pid)) {
      return { status: "occupied", pid: null, processName: null, commandLine: null };
    }

    const processInfo = await runner(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,Name,CommandLine,ExecutablePath | ConvertTo-Json -Compress`,
      ],
      { allowFailure: true },
    );

    let processName = null;
    let commandLine = null;
    let executablePath = null;
    try {
      const parsedProcess = JSON.parse(processInfo.stdout.trim() || "{}");
      processName = parsedProcess?.Name ?? null;
      commandLine = parsedProcess?.CommandLine ?? null;
      executablePath = parsedProcess?.ExecutablePath ?? null;
    } catch {
      processName = null;
      commandLine = null;
      executablePath = null;
    }

    return { status: "occupied", pid, processName, commandLine, executablePath };
  }

  const lsof = await runner("lsof", ["-nP", "-iTCP:3000", "-sTCP:LISTEN"], {
    allowFailure: true,
  });
  const lines = lsof.stdout.split(/\r?\n/).map((line) => line.trim());
  if (lines.length > 1) {
    const parts = lines[1].split(/\s+/);
    const processName = parts[0] || null;
    const pid = parts[1] ? Number(parts[1]) : null;
    const commandLine = await readUnixCommandLine(pid, runner);
    return {
      status: "occupied",
      pid: Number.isFinite(pid) ? pid : null,
      processName,
      commandLine,
      executablePath: null,
    };
  }

  const ss = await runner("ss", ["-lptn", "sport = :3000"], { allowFailure: true });
  if (lsof.code !== 0 && ss.code !== 0) {
    return { status: "unknown", pid: null, processName: null, commandLine: null };
  }
  const ssLine = ss.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /users:\(\(/.test(line));
  if (!ssLine) {
    return { status: "free", pid: null, processName: null, commandLine: null };
  }
  const pidMatch = ssLine.match(/pid=(\d+)/);
  const pid = pidMatch ? Number(pidMatch[1]) : null;
  const processNameMatch = ssLine.match(/users:\(\("([^"]+)"/);
  const processName = processNameMatch?.[1] ?? null;
  const commandLine = await readUnixCommandLine(pid, runner);
  return {
    status: "occupied",
    pid: Number.isFinite(pid) ? pid : null,
    processName,
    commandLine,
    executablePath: null,
  };
}

async function readUnixCommandLine(pid, runner) {
  if (!pid || !Number.isFinite(pid)) {
    return null;
  }
  const ps = await runner("ps", ["-p", String(pid), "-o", "command="], {
    allowFailure: true,
  });
  const output = ps.stdout.trim();
  return output || null;
}

export function processBelongsToRepository(portOwner, repositoryRoot) {
  const root = normalizePath(repositoryRoot);
  const commandLine = portOwner?.commandLine ? normalizePath(portOwner.commandLine) : "";
  return commandLine.includes(root);
}

export function classifyChromiumAvailability(data) {
  const packageAvailable = Boolean(data?.packageAvailable);
  const runtimeAvailable = Boolean(data?.runtimeAvailable);
  if (!packageAvailable) {
    return "missing-package";
  }
  if (!runtimeAvailable) {
    return "missing-runtime";
  }
  return "ready";
}

export async function detectChromiumAvailability(deps = {}) {
  const fileExists = deps.fileExists
    ? async (targetPath) => deps.fileExists(targetPath)
    : async (targetPath) => {
        try {
          await fs.access(targetPath);
          return true;
        } catch {
          return false;
        }
      };
  const cwd = deps.cwd ?? process.cwd();
  const packagePath = path.join(cwd, "node_modules", "@playwright", "test", "package.json");
  const packageAvailable = await fileExists(packagePath);

  let runtimeAvailable = false;
  let runtimePath = null;
  try {
    const playwright = await import("@playwright/test");
    runtimePath = playwright.chromium.executablePath();
    runtimeAvailable = Boolean(runtimePath) && (await fileExists(runtimePath));
  } catch {
    runtimeAvailable = false;
  }

  return {
    packageAvailable,
    runtimeAvailable,
    runtimePath,
    classification: classifyChromiumAvailability({ packageAvailable, runtimeAvailable }),
  };
}
