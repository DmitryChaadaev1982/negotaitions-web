import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("test:unit includes deterministic tests outside lib/**", () => {
  const command = packageJson.scripts["test:unit"];
  assert.match(command, /lib\/\*\*\/\*\.test\.ts/);
  assert.match(command, /app\/\*\*\/\*\.test\.ts/);
  assert.match(command, /components\/\*\*\/\*\.test\.ts/);
  assert.match(command, /scripts\/__tests__\/\*\.test\.mjs/);
});

test("validate:fast stays a cheap deterministic gate and includes the native-dialog guard", () => {
  const command = packageJson.scripts["validate:fast"];
  assert.match(command, /check:native-dialogs/);
  assert.match(command, /test:unit/);
  assert.match(command, /test:e2e:list/);
  assert.doesNotMatch(command, /validate:deploy/);
  assert.doesNotMatch(command, /test:e2e:smoke/);
  assert.doesNotMatch(command, /(?:^|[\s"])build(?:$|[\s"])/);
});

test("validate:deploy remains complete standalone deploy validation", () => {
  assert.equal(
    packageJson.scripts["validate:deploy"],
    "npm run validate:fast && npm run validate:build",
  );
  assert.equal(packageJson.scripts["validate:build"], "npm run build");
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
