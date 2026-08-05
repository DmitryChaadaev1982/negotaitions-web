import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  buildValidationPlan,
  exportGraphArtifact,
  resolvePrimitive,
} from "./validation-graph.mjs";

const SECRET_PATTERNS = [
  /\b[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY|DATABASE_URL|CONNECTION_STRING)[A-Z0-9_]*\s*=\s*[^\s]+/gi,
  /postgres(?:ql)?:\/\/[^\s]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

export function parseValidateAgentCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string", default: "deploy" },
      with: { type: "string", multiple: true, default: [] },
      plan: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "log-dir": { type: "string", default: "" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  return {
    mode: values.mode || "deploy",
    extensions: values.with || [],
    planOnly: Boolean(values.plan),
    json: Boolean(values.json),
    logDir: values["log-dir"] || "",
    help: Boolean(values.help),
    positionals,
  };
}

export function formatPlanText(plan) {
  const lines = [
    `validate:agent plan`,
    `mode: ${plan.mode}`,
    `extensions: ${plan.extensions.length ? plan.extensions.join(", ") : "(none)"}`,
    `estimated cost: ${plan.estimatedCost}`,
    `concurrency: ${plan.concurrencyPolicy}`,
    `caching: ${plan.cachingPolicy}`,
    "",
    "Ordered primitives:",
  ];

  plan.steps.forEach((step, index) => {
    lines.push(
      `${index + 1}. [${step.cost}] ${step.id}`,
      `   command: ${step.command.join(" ")}`,
      `   reason: ${step.reason}`,
      `   assurance: ${step.assurance}`,
    );
  });

  if (plan.deduplicated.length > 0) {
    lines.push("", "Deduplicated (requested more than once, kept once):");
    for (const id of plan.deduplicated) {
      lines.push(`- ${id}`);
    }
  } else {
    lines.push("", "Deduplicated: (none)");
  }

  lines.push("", "Distinct checks intentionally retained:");
  for (const item of plan.retainedDistinct) {
    lines.push(`- ${item.id}: ${item.reason}`);
  }

  lines.push("", "Excluded by default:");
  for (const item of plan.excludedByDefault) {
    lines.push(`- ${item}`);
  }

  return `${lines.join("\n")}\n`;
}

export function redactSecrets(text) {
  let output = String(text ?? "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

function resolveNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function resolveNpxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

export function materializeCommand(commandTokens) {
  if (!Array.isArray(commandTokens) || commandTokens.length === 0) {
    throw new Error("Command tokens are required");
  }
  const [head, ...rest] = commandTokens;
  if (head === "npm") {
    return { command: resolveNpmCommand(), args: rest };
  }
  if (head === "npx") {
    return { command: resolveNpxCommand(), args: rest };
  }
  return { command: head, args: rest };
}

/**
 * Run a single primitive. Injected runner supports tests.
 */
export async function runPrimitive(step, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const startedAt = Date.now();
  const materialized = materializeCommand(step.command);

  if (typeof options.runCommand === "function") {
    const result = await options.runCommand(materialized.command, materialized.args, {
      cwd,
      env,
      step,
      onChild: options.onChild,
    });
    return {
      id: step.id,
      command: step.command,
      exitCode: result.exitCode ?? 0,
      durationMs: result.durationMs ?? Date.now() - startedAt,
      stdout: redactSecrets(result.stdout ?? ""),
      stderr: redactSecrets(result.stderr ?? ""),
    };
  }

  const useWindowsCmdShell =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(materialized.command);

  const result = await new Promise((resolve, reject) => {
    const child = spawn(materialized.command, materialized.args, {
      cwd,
      env,
      shell: useWindowsCmdShell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (!options.quiet) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (!options.quiet) {
        process.stderr.write(text);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });

    if (options.onChild) {
      options.onChild(child);
    }
  });

  return {
    id: step.id,
    command: step.command,
    exitCode: result.exitCode,
    durationMs: Date.now() - startedAt,
    stdout: redactSecrets(result.stdout),
    stderr: redactSecrets(result.stderr),
  };
}

export async function executeValidationPlan(plan, options = {}) {
  /** @type {Map<string, object>} */
  const executed = new Map();
  /** @type {object[]} */
  const results = [];
  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];
  const startedAt = Date.now();
  let failedAt = null;

  try {
    for (const step of plan.steps) {
      if (executed.has(step.id)) {
        results.push({
          id: step.id,
          skipped: true,
          reason: "within-process-dedup",
          exitCode: 0,
          durationMs: 0,
        });
        continue;
      }

      const result = await runPrimitive(step, {
        ...options,
        onChild: (child) => {
          children.push(child);
          if (options.onChild) options.onChild(child);
        },
      });
      executed.set(step.id, result);
      results.push(result);

      if (result.exitCode !== 0) {
        failedAt = step.id;
        break;
      }
    }
  } finally {
    await cleanupOwnedChildren(children, options);
  }

  const report = {
    ok: failedAt === null && results.every((entry) => (entry.exitCode ?? 0) === 0),
    mode: plan.mode,
    extensions: plan.extensions,
    failedAt,
    durationMs: Date.now() - startedAt,
    steps: results.map((entry) => ({
      id: entry.id,
      exitCode: entry.exitCode ?? 0,
      durationMs: entry.durationMs ?? 0,
      skipped: Boolean(entry.skipped),
      reason: entry.reason ?? null,
      command: entry.command ?? resolvePrimitive(entry.id).command,
    })),
    summary: results.map((entry) => ({
      id: entry.id,
      status: entry.skipped ? "deduped" : entry.exitCode === 0 ? "pass" : "fail",
      durationMs: entry.durationMs ?? 0,
    })),
    cachingPolicy: plan.cachingPolicy,
    concurrencyPolicy: plan.concurrencyPolicy,
  };

  if (options.logDir) {
    await writeReportFiles(options.logDir, report, results);
  }

  return report;
}

async function cleanupOwnedChildren(children, options = {}) {
  for (const child of children) {
    if (!child || child.killed || child.exitCode !== null) {
      continue;
    }
    try {
      if (typeof options.killChild === "function") {
        await options.killChild(child);
      } else if (child.pid) {
        child.kill("SIGTERM");
      }
    } catch {
      // Best-effort cleanup of owned children only.
    }
  }
}

async function writeReportFiles(logDir, report, results) {
  await fs.mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summaryPath = path.join(logDir, `validate-agent-${stamp}.json`);
  await fs.writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const result of results) {
    if (result.skipped) continue;
    const safeId = String(result.id).replace(/[^\w.-]+/g, "_");
    const outPath = path.join(logDir, `validate-agent-${stamp}-${safeId}.log`);
    const body = [
      `id: ${result.id}`,
      `exitCode: ${result.exitCode}`,
      `durationMs: ${result.durationMs}`,
      "",
      "--- stdout ---",
      result.stdout || "",
      "",
      "--- stderr ---",
      result.stderr || "",
      "",
    ].join("\n");
    await fs.writeFile(outPath, redactSecrets(body), "utf8");
  }

  return summaryPath;
}

export function formatExecutionSummary(report) {
  const lines = [
    "validate:agent summary",
    `ok: ${report.ok}`,
    `mode: ${report.mode}`,
    `durationMs: ${report.durationMs}`,
    report.failedAt ? `failedAt: ${report.failedAt}` : "failedAt: (none)",
    "",
    "steps:",
  ];
  for (const step of report.summary) {
    lines.push(`- ${step.id}: ${step.status} (${step.durationMs}ms)`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runValidateAgent(argv, options = {}) {
  const cli = parseValidateAgentCli(argv);
  if (cli.help) {
    const help = [
      "Usage: npm run validate:agent -- [options]",
      "",
      "Options:",
      "  --mode=fast|deploy|runtime|full|tooling   Validation mode (default: deploy)",
      "  --with=<extension>                        stage310|stage313c|stage313c-remediation|templates|tooling",
      "  --plan                                    Print ordered plan without executing",
      "  --json                                    Emit JSON plan or report",
      "  --log-dir=<path>                          Write sanitized step logs",
      "  --help                                    Show help",
      "",
      "Notes:",
      "  - Executes each distinct primitive once (no nested validate:fast inside validate:deploy).",
      "  - @smoke and @browser-smoke remain separate.",
      "  - No cross-run cache; within-process dedup only.",
      "  - Fail-fast on first mandatory failure.",
    ].join("\n");
    return { exitCode: 0, stdout: `${help}\n`, report: null, plan: null };
  }

  const plan = buildValidationPlan(cli.mode, cli.extensions);

  if (cli.planOnly) {
    if (cli.json) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(plan, null, 2)}\n`,
        report: null,
        plan,
      };
    }
    return {
      exitCode: 0,
      stdout: formatPlanText(plan),
      report: null,
      plan,
    };
  }

  const report = await executeValidationPlan(plan, {
    ...options,
    logDir: cli.logDir || options.logDir || "",
  });

  if (cli.json) {
    return {
      exitCode: report.ok ? 0 : 1,
      stdout: `${JSON.stringify(report, null, 2)}\n`,
      report,
      plan,
    };
  }

  return {
    exitCode: report.ok ? 0 : 1,
    stdout: formatExecutionSummary(report),
    report,
    plan,
  };
}

export function writeGraphArtifactSync(targetPath, deps = {}) {
  const artifact = exportGraphArtifact();
  const body = `${JSON.stringify(artifact, null, 2)}\n`;
  if (deps.writeFileSync) {
    deps.writeFileSync(targetPath, body, "utf8");
  }
  return artifact;
}
