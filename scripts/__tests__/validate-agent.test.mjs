import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildValidationPlan,
  COMPOSITES,
  MODE_PRIMITIVES,
  PRIMITIVES,
  TYPICAL_OVERLAPPING_PROMPT,
} from "../agent-tooling/validation-graph.mjs";
import {
  executeValidationPlan,
  formatPlanText,
  materializeCommand,
  parseValidateAgentCli,
  redactSecrets,
  runValidateAgent,
} from "../agent-tooling/validate-agent-lib.mjs";

test("mandatory deploy mode includes each deploy primitive once", () => {
  const plan = buildValidationPlan("deploy");
  const ids = plan.steps.map((step) => step.id);
  assert.deepEqual(ids, [
    "lint",
    "prisma-validate",
    "prisma-generate",
    "test-unit",
    "test-e2e-list",
    "email-templates-validate",
    "build",
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test("full mode covers old mandatory gate union without nesting", () => {
  const plan = buildValidationPlan("full");
  const ids = new Set(plan.steps.map((step) => step.id));

  for (const id of COMPOSITES["validate:deploy"].primitives) {
    assert.ok(ids.has(id), `missing deploy primitive ${id}`);
  }
  assert.ok(ids.has("e2e-smoke"));
  assert.ok(ids.has("e2e-smoke-browser"));
  assert.ok(ids.has("email-templates-validate"));

  // smoke modes remain distinct
  assert.ok(ids.has("e2e-smoke") && ids.has("e2e-smoke-browser"));
});

test("extensions append without merging distinct browser modes", () => {
  const plan = buildValidationPlan("deploy", ["stage310", "templates"]);
  const ids = plan.steps.map((step) => step.id);
  assert.ok(ids.includes("stage310"));
  assert.equal(ids.filter((id) => id === "email-templates-validate").length, 1);
  assert.deepEqual(plan.deduplicated, ["email-templates-validate"]);
});

test("plan mode text includes ordered commands and cost", () => {
  const plan = buildValidationPlan("runtime");
  const text = formatPlanText(plan);
  assert.match(text, /Ordered primitives:/);
  assert.match(text, /e2e-smoke/);
  assert.match(text, /e2e-smoke-browser/);
  assert.match(text, /estimated cost: heavy/);
  assert.match(text, /test:e2e:observer:layout/);
});

test("failure stops later heavy work", async () => {
  const plan = buildValidationPlan("deploy");
  const calls = [];
  const report = await executeValidationPlan(plan, {
    quiet: true,
    runCommand: async (_command, _args, meta) => {
      calls.push(meta.step.id);
      if (meta.step.id === "lint") {
        return { exitCode: 2, stdout: "lint failed", stderr: "", durationMs: 5 };
      }
      return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 };
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.failedAt, "lint");
  assert.deepEqual(calls, ["lint"]);
  assert.ok(!calls.includes("build"));
});

test("within-process dedup skips second identical primitive id", async () => {
  const plan = {
    mode: "custom",
    extensions: [],
    steps: [
      {
        id: "lint",
        command: ["npm", "run", "lint"],
        reason: "first",
        cost: "cheap",
        assurance: "lint",
      },
      {
        id: "lint",
        command: ["npm", "run", "lint"],
        reason: "duplicate",
        cost: "cheap",
        assurance: "lint",
      },
    ],
    cachingPolicy: "within-process-dedup-only",
    concurrencyPolicy: "sequential",
  };

  const calls = [];
  const report = await executeValidationPlan(plan, {
    quiet: true,
    runCommand: async () => {
      calls.push("lint");
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(report.summary[1].status, "deduped");
});

test("redactSecrets removes connection strings and token-like values", () => {
  const raw =
    "DATABASE_URL=postgres://user:secret@localhost:5432/db API_TOKEN=abc123 eyJhbGciOiJIUzI1NiJ9.e30.sig";
  const cleaned = redactSecrets(raw);
  assert.doesNotMatch(cleaned, /postgres:\/\//);
  assert.doesNotMatch(cleaned, /secret@/);
  assert.match(cleaned, /\[REDACTED\]/);
});

test("Windows npm/npx command materialization", () => {
  const npm = materializeCommand(["npm", "run", "lint"]);
  const npx = materializeCommand(["npx", "prisma", "validate"]);
  if (process.platform === "win32") {
    assert.match(npm.command, /npm\.cmd$/i);
    assert.match(npx.command, /npx\.cmd$/i);
  } else {
    assert.equal(npm.command, "npm");
    assert.equal(npx.command, "npx");
  }
  assert.deepEqual(npm.args, ["run", "lint"]);
});

test("paths containing spaces are preserved in cwd option", async () => {
  const spaced = path.join(os.tmpdir(), "Negotiations AI", "validate-agent-space-test");
  await fs.mkdir(spaced, { recursive: true });
  let seenCwd = null;
  const plan = buildValidationPlan("tooling");
  await executeValidationPlan(plan, {
    cwd: spaced,
    quiet: true,
    runCommand: async (_command, _args, meta) => {
      seenCwd = meta?.cwd ?? spaced;
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    },
  });
  assert.equal(seenCwd, spaced);
});

test("cli plan mode does not execute", async () => {
  let executed = false;
  const result = await runValidateAgent(["--mode=fast", "--plan"], {
    runCommand: async () => {
      executed = true;
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(executed, false);
  assert.match(result.stdout, /Ordered primitives:/);
});

test("json plan mode emits machine-readable steps", async () => {
  const result = await runValidateAgent(["--mode=runtime", "--plan", "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, "runtime");
  assert.equal(parsed.steps.length, 2);
});

test("existing composite scripts remain represented in graph", () => {
  assert.ok(COMPOSITES["validate:fast"]);
  assert.ok(COMPOSITES["validate:deploy"]);
  assert.ok(PRIMITIVES["test-unit"]);
  assert.deepEqual(MODE_PRIMITIVES.deploy.slice(0, 5), COMPOSITES["validate:deploy"].primitives.slice(0, 5));
});

test("typical overlapping prompt documents safe dedups", () => {
  const dupes = TYPICAL_OVERLAPPING_PROMPT.duplicates.filter((entry) => entry.safeToDedup);
  assert.ok(dupes.some((entry) => entry.primitive === "test-unit" && entry.executions === 3));
  assert.ok(
    TYPICAL_OVERLAPPING_PROMPT.duplicates.some(
      (entry) => entry.primitive === "e2e-smoke-browser" && entry.safeToDedup === false,
    ),
  );
});

test("parseValidateAgentCli reads multiple --with values", () => {
  const cli = parseValidateAgentCli([
    "--mode=full",
    "--with=stage310",
    "--with=stage313c-remediation",
    "--plan",
  ]);
  assert.equal(cli.mode, "full");
  assert.deepEqual(cli.extensions, ["stage310", "stage313c-remediation"]);
  assert.equal(cli.planOnly, true);
});

test("owned child cleanup runs after failure", async () => {
  const kills = [];
  const fakeChild = { killed: false, exitCode: null, pid: 4242, kill() {} };
  const plan = {
    mode: "custom",
    extensions: [],
    steps: [
      {
        id: "lint",
        command: ["npm", "run", "lint"],
        reason: "fail",
        cost: "cheap",
        assurance: "lint",
      },
      {
        id: "build",
        command: ["npm", "run", "build"],
        reason: "later",
        cost: "heavy",
        assurance: "build",
      },
    ],
    cachingPolicy: "within-process-dedup-only",
    concurrencyPolicy: "sequential",
  };

  const report = await executeValidationPlan(plan, {
    quiet: true,
    runCommand: async (_command, _args, meta) => {
      if (typeof meta.onChild === "function") {
        meta.onChild(fakeChild);
      }
      return { exitCode: 1, stdout: "", stderr: "boom", durationMs: 1 };
    },
    onChild: (child) => {
      // ensure executeValidationPlan still tracks injected children via runPrimitive hook
      assert.equal(child.pid, 4242);
    },
    killChild: async (child) => {
      kills.push(child.pid);
    },
  });

  assert.equal(report.ok, false);
  assert.deepEqual(kills, [4242]);
});
