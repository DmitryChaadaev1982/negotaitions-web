import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  createCanonicalSteps,
  DATABASE_TEST_GLOBS,
  getBuildStepIds,
  getDeployStepIds,
  getFastStepIds,
  isDatabaseTestPath,
  UNIT_TEST_GLOBS,
} from "../validation-runner/steps.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

function expand(globs) {
  return globs.flatMap((pattern) => globSync(pattern)).map((file) => file.replace(/\\/gu, "/"));
}

test("test:unit includes deterministic tests outside lib/**", () => {
  const command = packageJson.scripts["test:unit"];
  assert.match(command, /lib\/\*\*\/!\(\*\.pg\)\.test\.ts/);
  assert.match(command, /app\/\*\*\/!\(\*\.pg\)\.test\.ts/);
  assert.match(command, /components\/\*\*\/!\(\*\.pg\)\.test\.ts/);
  assert.match(command, /scripts\/__tests__\/\*\.test\.mjs/);
  assert.match(command, /tests\/e2e\/helpers\/large-realistic-uat-!\(\*\.pg\)\.test\.ts/);
  assert.match(command, /--test-timeout=180000/);
});

test("canonical test:unit and runner share a 180s per-test timeout", () => {
  const graph = createCanonicalSteps({ worktreeRoot: process.cwd() });
  const unit = graph.fast.find((step) => step.id === "test:unit");
  assert.equal(unit?.kind, "spawn");
  assert.ok(Array.isArray(unit?.args));
  assert.ok(unit.args.includes("--test-timeout=180000"));
  assert.ok(
    unit.args.indexOf("--test-timeout=180000") < unit.args.indexOf("--test"),
  );
  assert.ok(unit.args.includes("scripts/__tests__/*.test.mjs"));
  assert.ok(unit.args.includes("tests/e2e/helpers/large-realistic-uat-!(*.pg).test.ts"));
  assert.equal(unit.timeoutMs, 10 * 60_000);
});

test("package.json test:unit and the canonical runner select the same files", () => {
  const graph = createCanonicalSteps({ worktreeRoot: process.cwd() });
  const unit = graph.fast.find((step) => step.id === "test:unit");
  const runnerGlobs = unit.args.slice(unit.args.indexOf("--test") + 1);
  assert.deepEqual(runnerGlobs, [...UNIT_TEST_GLOBS]);
  for (const pattern of UNIT_TEST_GLOBS) {
    assert.ok(
      packageJson.scripts["test:unit"].includes(pattern),
      `test:unit is missing ${pattern}`,
    );
  }
});

test("validate:fast file selection never includes a PostgreSQL-mutating test", () => {
  const previous = process.env.E2E_DATABASE_URL;
  process.env.E2E_DATABASE_URL =
    "postgresql://negotiations:negotiations_password@127.0.0.1:5432/negotiations_e2e";
  try {
    const selected = expand(UNIT_TEST_GLOBS);
    assert.ok(selected.length > 0, "fast gate must still select deterministic tests");
    assert.deepEqual(selected.filter((file) => file.endsWith(".pg.test.ts")), []);
    assert.deepEqual(selected.filter((file) => file.startsWith("tests/pg-race/")), []);
    assert.deepEqual(selected.filter(isDatabaseTestPath), []);
    assert.deepEqual(
      selected.filter((file) => file.includes("bug02-cp-bench/d1-persistence")),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.E2E_DATABASE_URL;
    else process.env.E2E_DATABASE_URL = previous;
  }
});

test("explicit PostgreSQL commands do select the database suites", () => {
  const selected = expand(DATABASE_TEST_GLOBS);
  assert.ok(selected.includes("lib/eval/bug02-cp-bench/d1-persistence.pg.test.ts"));
  assert.ok(selected.includes("tests/pg-race/bug02-slice-a-authority.race.test.ts"));
  assert.ok(selected.includes("tests/pg-race/bug02-slice-b-provider-slots.race.test.ts"));
  assert.ok(selected.every(isDatabaseTestPath));

  assert.match(
    packageJson.scripts["test:pg:d1"],
    /lib\/eval\/bug02-cp-bench\/d1-persistence\.pg\.test\.ts/,
  );
  assert.match(packageJson.scripts["test:pg:bug02"], /tests\/pg-race\/\*\*\/\*\.test\.ts/);
  for (const script of ["test:pg", "test:pg:d1", "test:pg:bug02"]) {
    assert.match(
      packageJson.scripts[script],
      /scripts\/test-pg-env-bootstrap\.mjs/,
      `${script} must declare the database as an explicit requirement`,
    );
  }
});

test("explicit PostgreSQL commands report a missing database instead of skipping", () => {
  const bootstrap = readFileSync("scripts/test-pg-env-bootstrap.mjs", "utf8");
  assert.match(bootstrap, /process\.env\.PG_TESTS_REQUIRED = "1"/);
  const gate = readFileSync("lib/test-helpers/pg-test-gate.ts", "utf8");
  assert.match(gate, /PG_TESTS_REQUIRED_ENV = "PG_TESTS_REQUIRED"/);
  assert.match(gate, /PG_INFRASTRUCTURE_REQUIRED/);
});

test("D1 persistence stress treats D1_REJECT as a failure", () => {
  const d1 = readFileSync("lib/eval/bug02-cp-bench/d1-persistence.pg.test.ts", "utf8");
  assert.match(d1, /assert\.equal\(result\.decision, "D1_PASS"\)/);
  assert.doesNotMatch(d1, /D1_PASS"\s*\|\|/);
  assert.doesNotMatch(d1, /decision === "D1_REJECT"/);
});

test("validate:fast stays a cheap deterministic gate and includes the native-dialog guard", () => {
  const command = packageJson.scripts["validate:fast"];
  assert.match(command, /validation-runner\.mjs fast/);
  assert.doesNotMatch(command, /validate:deploy/);
  assert.doesNotMatch(command, /test:e2e:smoke/);
  assert.doesNotMatch(command, /(?:^|[\s"])build(?:$|[\s"])/);

  const fast = getFastStepIds();
  assert.deepEqual(fast, [
    "check:native-dialogs",
    "lint",
    "prisma validate",
    "prisma generate",
    "test:unit",
    "test:e2e:list",
  ]);
  assert.ok(!fast.includes("next build"));
  assert.ok(!fast.includes("eval:registry:check"));
});

test("guarded prisma generate uses installed CLI --no-hints and pins Prisma 7.10.0", () => {
  const generate = readFileSync("scripts/validation-runner/prisma-generate.mjs", "utf8");
  assert.match(generate, /"generate", "--no-hints"/);
  assert.equal(packageJson.dependencies.prisma, "7.10.0");
  assert.equal(packageJson.dependencies["@prisma/client"], "7.10.0");
  assert.equal(packageJson.dependencies["@prisma/adapter-pg"], "7.10.0");
});

test("validate:deploy remains complete standalone deploy validation", () => {
  assert.match(packageJson.scripts["validate:deploy"], /validation-runner\.mjs deploy/);
  assert.doesNotMatch(packageJson.scripts["validate:deploy"], /npm run validate:fast/);
  assert.match(packageJson.scripts["validate:build"], /validation-runner\.mjs build/);
  assert.equal(packageJson.scripts["build"], "next build");
  assert.deepEqual(getBuildStepIds(), ["next build"]);
  assert.deepEqual(getDeployStepIds(), [...getFastStepIds(), ...getBuildStepIds()]);

  const graph = createCanonicalSteps({ worktreeRoot: process.cwd() });
  assert.equal(graph.fast.find((step) => step.id === "prisma generate")?.kind, "prisma-generate");
  assert.equal(graph.build[0]?.id, "next build");
});

test("Playwright inventory listing does not start a managed webServer", () => {
  const defaultConfig = readFileSync("playwright.config.ts", "utf8");
  const localConfig = readFileSync("playwright.local.config.ts", "utf8");
  assert.match(defaultConfig, /process\.argv\.includes\("--list"\)/);
  assert.match(defaultConfig, /useExternalBaseUrl \|\| isInventoryOnly/);
  assert.match(localConfig, /process\.argv\.includes\("--list"\)/);
  assert.match(localConfig, /enableWebServer && !isInventoryOnly/);
});

test("canonical Product gates remain documented without a Product L1–L4 sequencer", () => {
  const workflow = readFileSync("docs/testing/engineering-workflow.md", "utf8");
  const checklist = readFileSync("docs/testing/validation-checklist.md", "utf8");
  assert.match(workflow, /`validate:fast`/);
  assert.match(workflow, /`validate:deploy`/);
  assert.match(workflow, /`test:e2e:smoke`/);
  assert.match(workflow, /`test:e2e:smoke:browser`/);
  assert.match(workflow, /`prisma:generate`/);
  assert.doesNotMatch(workflow, /L3_VALIDATE_FAST:/);
  assert.doesNotMatch(workflow, /L4_VALIDATE_DEPLOY:/);
  assert.match(checklist, /Canonical Product gates declared in `\.eo\/repository-profile\.json`/);
  assert.match(
    checklist,
    /`validate:deploy` is complete standalone deploy validation/,
  );
});
