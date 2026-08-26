import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createCanonicalSteps,
  getBuildStepIds,
  getDeployStepIds,
  getFastStepIds,
} from "../validation-runner/steps.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("test:unit includes deterministic tests outside lib/**", () => {
  const command = packageJson.scripts["test:unit"];
  assert.match(command, /lib\/\*\*\/\*\.test\.ts/);
  assert.match(command, /app\/\*\*\/\*\.test\.ts/);
  assert.match(command, /components\/\*\*\/\*\.test\.ts/);
  assert.match(command, /scripts\/__tests__\/\*\.test\.mjs/);
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
  assert.match(unit.args[1], /^file:/);
  assert.equal(unit.timeoutMs, 10 * 60_000);
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

test("BROAD_VALIDATION_RUNS records the current normal command graph", () => {
  const workflow = readFileSync("docs/testing/engineering-workflow.md", "utf8");
  assert.match(workflow, /L3_VALIDATE_FAST:/);
  assert.match(workflow, /L4_VALIDATE_BUILD:/);
  assert.match(workflow, /L4_SMOKE:/);
  assert.match(workflow, /L4_BROWSER_SMOKE:/);
  assert.match(workflow, /STANDALONE_VALIDATE_DEPLOY:/);
  assert.doesNotMatch(workflow, /L4_VALIDATE_DEPLOY:/);
  assert.match(
    workflow,
    /Do not treat `validate:deploy` as the\r?\nnormal L4 build step/,
  );
});
