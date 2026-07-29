import { detectPort3000Owner, git, probeHttpHealth, resolveGitCommonDir, runCommand } from "./common.mjs";
import { classifyPlaywrightMode, resolveServerOwnership } from "./agent-preflight-lib.mjs";

const LIVE_URL = "http://localhost:3000";
const LOCAL_CONFIG = "playwright.local.config.ts";

export class PlaywrightModeError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export function parsePlaywrightModeCli(argv) {
  const separatorIndex = argv.indexOf("--");
  const beforeSeparator = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const passthrough = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const modeToken = beforeSeparator.find((token) => token.startsWith("--mode="));
  const mode = modeToken ? modeToken.split("=")[1]?.trim().toLowerCase() : "";
  return { mode, passthrough };
}

function ensureValidMode(mode) {
  if (!["managed", "live"].includes(mode)) {
    throw new PlaywrightModeError(
      "INVALID_PLAYWRIGHT_SERVER_MODE",
      `Unsupported mode "${mode || "(empty)"}". Use managed or live.`,
    );
  }
}

export async function preparePlaywrightMode(mode, deps = {}) {
  ensureValidMode(mode);
  const cwd = deps.cwd ?? process.cwd();
  const detectPort = deps.detectPort3000Owner ?? detectPort3000Owner;
  const healthProbe = deps.probeHttpHealth ?? probeHttpHealth;
  const gitFn = deps.git ?? git;
  const portStatus = await detectPort({ runCommand: deps.runCommand });
  const health = await healthProbe(LIVE_URL, 2_500);
  const currentWorktree =
    deps.currentWorktree ?? (await gitFn(["rev-parse", "--show-toplevel"], { cwd }));
  const currentGitCommonDir =
    deps.currentGitCommonDir ??
    (await (deps.resolveGitCommonDir ?? resolveGitCommonDir)(currentWorktree, { git: gitFn }));
  const ownership = await resolveServerOwnership({
    portStatus,
    currentWorktree,
    currentGitCommonDir,
    resolveCommonDir: async (worktree) =>
      (deps.resolveGitCommonDir ?? resolveGitCommonDir)(worktree, { git: gitFn }),
  });
  const recommendation = classifyPlaywrightMode({
    portStatus,
    health,
    ownership,
  });

  if (mode === "managed") {
    if (portStatus.status !== "free") {
      throw new PlaywrightModeError(
        "MANAGED_SERVER_PORT_CONFLICT",
        portStatus.status === "occupied"
          ? `Port 3000 is occupied by PID ${portStatus.pid ?? "unknown"} (${portStatus.processName ?? "unknown-process"}).`
          : "Could not verify that port 3000 is free.",
      );
    }
    return {
      mode,
      environment: {
        PLAYWRIGHT_SERVER_MODE: "managed",
      },
    };
  }

  if (!health.ok) {
    throw new PlaywrightModeError(
      "LIVE_SERVER_NOT_AVAILABLE",
      `Live server check failed at ${LIVE_URL}${health.status ? ` (status ${health.status})` : ""}.`,
    );
  }
  if (recommendation.mode === "SIBLING_WORKTREE_CONFLICT") {
    throw new PlaywrightModeError(
      "LIVE_SERVER_WORKTREE_MISMATCH",
      `Current worktree: ${currentWorktree}\nDetected server worktree: ${ownership.ownerWorktree ?? "(unavailable)"}\nPID: ${portStatus.pid ?? "unknown"}\nRemediation: run this command from the matching worktree, or stop that server and use managed mode.`,
    );
  }
  if (recommendation.mode !== "LIVE") {
    throw new PlaywrightModeError(
      "LIVE_SERVER_NOT_AVAILABLE",
      `Live server is not eligible for this worktree (${recommendation.mode}). ${recommendation.reason}`,
    );
  }

  return {
    mode,
    environment: {
      PLAYWRIGHT_SERVER_MODE: "live",
      PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL?.trim() || LIVE_URL,
    },
  };
}

export async function runPlaywrightInMode(argv, deps = {}) {
  const parsed = parsePlaywrightModeCli(argv);
  const prepared = await preparePlaywrightMode(parsed.mode, deps);
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const commandArgs = ["playwright", "test", "--config", LOCAL_CONFIG, ...parsed.passthrough];
  if (deps.dryRun || process.env.PLAYWRIGHT_WRAPPER_DRY_RUN === "1") {
    return {
      command: npxCommand,
      args: commandArgs,
      environment: prepared.environment,
      skippedExecution: true,
      mode: prepared.mode,
    };
  }

  const runner = deps.runCommand ?? runCommand;
  const result = await runner(npxCommand, commandArgs, {
    cwd: deps.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...prepared.environment,
    },
    allowFailure: true,
    timeoutMs: deps.timeoutMs ?? 10 * 60_000,
  });

  return {
    command: npxCommand,
    args: commandArgs,
    environment: prepared.environment,
    skippedExecution: false,
    mode: prepared.mode,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
