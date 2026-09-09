import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profilePath = ".eo/repository-profile.json";
const rulePath = ".cursor/rules/engineering-orchestrator.mdc";
const stageStartPath = ".cursor/skills/stage-start/SKILL.md";

function read(path) {
  return readFileSync(path, "utf8");
}

test("tracked EO repository profile is present, parseable Product metadata", () => {
  const raw = JSON.parse(read(profilePath));
  assert.equal(raw.baseRemote, "origin");
  assert.equal(raw.baseBranch, "deploy/yandex-poc");
  assert.equal(raw.worktreeNamingPolicy, "SIBLING_SLUG");
  assert.equal(raw.deploymentProfileRef, "NEGOTAITIONS_YANDEX_POC");
  assert.ok(raw.invariants.includes("CANARY_HTTP_PATH=/api/health"));
  assert.equal(raw.taskClassPolicy.planning, "SOURCE_ONLY");
  assert.equal(raw.taskClassPolicy.implementation, "SOURCE_ONLY");
  assert.equal(raw.taskClassPolicy.validation, "UI_ACCEPTANCE");
  assert.equal(raw.taskClassPolicy.audit, "SOURCE_ONLY");
  assert.equal(raw.taskClassPolicy.implementationRequiresLocalApp, false);
});

test("profile declares TYPED_IMPORT, Playwright, UAT graph, and no machine env path", () => {
  const serialized = read(profilePath);
  const raw = JSON.parse(serialized);
  assert.equal(serialized.includes("negotiations-web-server-stop-main"), false);
  assert.equal(serialized.includes(".env source"), false);
  assert.match(serialized, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.equal(serialized.includes("PLAYWRIGHT_BROWSERS_PATH="), false);
  const playwright = raw.runtimeDependencies.find((item) => item.envKey === "PLAYWRIGHT_BROWSERS_PATH");
  assert.ok(playwright);
  assert.equal(playwright.classification, "NON_SECRET_LOCAL_PATH");
  assert.equal("value" in playwright, false);
  assert.equal("path" in playwright, false);
  const env = raw.environmentProfiles[0];
  assert.equal(env.sourcePolicy.kind, "TYPED_IMPORT");
  assert.equal(env.sourcePolicy.wholesaleCopyForbidden, true);
  const uat = raw.testInstanceProfiles[0];
  assert.equal(uat.uatUrl, "https://local.negotaitions.ru");
  assert.deepEqual(
    uat.resources.map((item) => item.kind),
    ["APPLICATION", "TUNNEL"],
  );
  for (const descriptor of raw.secretDescriptors) {
    assert.equal("value" in descriptor, false);
    assert.equal(descriptor.classification, "SECRET");
  }
});

test("alwaysApply EO rule is short and does not implement a second lifecycle", () => {
  const rule = read(rulePath).replaceAll("\r\n", "\n");
  assert.match(rule, /alwaysApply:\s*true/);
  assert.doesNotMatch(rule, /INTAKE→PLAN→IMPLEMENT→UAT→VALIDATE→RELEASE→DEPLOY→CLOSED/);
  assert.doesNotMatch(rule, /git worktree add/);
  assert.match(rule, /CONTINUE_CHANGE_UNIT/);
  assert.match(rule, /Chat transcript is not lifecycle authority/);
  assert.match(rule, /chat continuity is not promised/);
  assert.match(rule, /durable CU/);
});

test("stage-start is a thin EO wrapper without native bootstrap", () => {
  const skill = read(stageStartPath);
  assert.match(skill, /thin convenience wrapper/i);
  assert.doesNotMatch(skill, /git worktree add/);
  assert.doesNotMatch(skill, /Copy-Item/);
  assert.doesNotMatch(skill, /wholesale/i);
  assert.doesNotMatch(skill, /negotiations-web-server-stop-main/);
  assert.match(skill, /TYPED_IMPORT/);
  assert.match(skill, /Do not copy env files/i);
});
