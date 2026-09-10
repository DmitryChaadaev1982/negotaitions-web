import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const profilePath = ".eo/repository-profile.json";
const targetPath = ".eo/deployment-targets/negotaitions-production.json";
const rulePath = ".cursor/rules/engineering-orchestrator.mdc";
const stageStartPath = ".cursor/skills/stage-start/SKILL.md";
const validateWavePath = ".cursor/skills/validate-wave/SKILL.md";
const deployRulePath = ".cursor/rules/deployment-production-safety.mdc";
const agentsPath = "AGENTS.md";
const workflowPath = "docs/testing/engineering-workflow.md";
const routingPath = "docs/testing/agent-model-routing.md";
const checklistPath = "docs/testing/validation-checklist.md";
const codeMapPath = "docs/architecture/code-map.md";

function read(file) {
  return readFileSync(file, "utf8");
}

function resolveEoRoot() {
  if (process.env.EO_PACKAGE_ROOT && existsSync(process.env.EO_PACKAGE_ROOT)) {
    return process.env.EO_PACKAGE_ROOT;
  }
  const sibling = path.resolve(process.cwd(), "..", "negotiations-engineering-orchestrator-lean-remediation");
  if (existsSync(path.join(sibling, "src/cp2e/repository-profile.ts"))) {
    return sibling;
  }
  throw new Error("EO package root not found; set EO_PACKAGE_ROOT");
}

async function loadEo() {
  const eoRoot = resolveEoRoot();
  const href = (rel) => pathToFileURL(path.join(eoRoot, rel)).href;
  const [{ loadRepositoryProfile, resolveValidationRuntimeDependencies }, { importTypedEnvironment, copyEnvFileWholesale }, { parseTypedEnvSource }, { taskClassForIntent, localAppRequired }, { loadDeploymentTargetFromRepo }, { buildTypedRemoteOperation }, standing] =
    await Promise.all([
      import(href("src/cp2e/repository-profile.ts")),
      import(href("src/cp2e/typed-import.ts")),
      import(href("src/cp2e/materialize.ts")),
      import(href("src/cp2e/readiness.ts")),
      import(href("src/cp2f/target.ts")),
      import(href("src/cp2f/remote/operations.ts")),
      import(href("src/cp2d/standing-release-authority.ts")),
    ]);
  return {
    eoRoot,
    loadRepositoryProfile,
    resolveValidationRuntimeDependencies,
    importTypedEnvironment,
    copyEnvFileWholesale,
    parseTypedEnvSource,
    taskClassForIntent,
    localAppRequired,
    loadDeploymentTargetFromRepo,
    buildTypedRemoteOperation,
    STANDARD_RELEASE_PATH_NEGOTAITIONS_YANDEX_POC: standing.STANDARD_RELEASE_PATH_NEGOTAITIONS_YANDEX_POC,
    TARGET_ENVIRONMENT_NEGOTAITIONS_PRODUCTION: standing.TARGET_ENVIRONMENT_NEGOTAITIONS_PRODUCTION,
  };
}

const TRACKED_SURFACES = [".eo", ".cursor", "AGENTS.md", "docs", "package.json", ".gitignore"];

function trackedContains(needle) {
  const result = spawnSync("git", ["grep", "-F", "-n", "-e", needle, "--", ...TRACKED_SURFACES], { encoding: "utf8" });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.trim().length > 0;
}

test("tracked EO repository profile is present, parseable Product metadata", () => {
  const raw = JSON.parse(read(profilePath));
  assert.equal(raw.baseRemote, "origin");
  assert.equal(raw.baseBranch, "deploy/yandex-poc");
  assert.equal(raw.worktreeNamingPolicy, "SIBLING_SLUG");
  assert.equal(raw.deploymentProfileRef, "NEGOTAITIONS_YANDEX_POC");
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

test("local-uat reverse tunnel declares the operational keepalive command", async () => {
  const eo = await loadEo();
  const loaded = eo.loadRepositoryProfile({ repositoryPath: process.cwd() });
  assert.equal(loaded.source, "worktree");
  const selected = loaded.profile.testInstanceProfiles.find((item) => item.profileId === "local-uat") ?? loaded.profile.testInstanceProfiles[0];
  assert.ok(selected);
  assert.equal(selected.profileId, "local-uat");
  assert.deepEqual(
    selected.resources.map((item) => item.kind),
    ["APPLICATION", "TUNNEL"],
  );
  const tunnelResource = selected.resources.find((item) => item.kind === "TUNNEL");
  const tunnel = loaded.profile.ownedProcessDefinitions.find(
    (item) => item.ownedProcessId === tunnelResource.ownedProcessDefinitionId,
  );
  assert.ok(tunnel);
  assert.equal(tunnel.ownedProcessId, "negotaitions-reverse-tunnel");
  assert.equal(tunnel.executable, "ssh");
  assert.equal(tunnel.argv.includes("-N"), true);
  assert.equal(tunnel.argv.includes("ExitOnForwardFailure=yes"), true);
  assert.equal(tunnel.argv.includes("ServerAliveInterval=30"), true);
  assert.equal(tunnel.argv.includes("ServerAliveCountMax=2"), true);
  assert.equal(tunnel.argv.includes("TCPKeepAlive=yes"), true);
  assert.equal(tunnel.argv.includes("127.0.0.1:3300:127.0.0.1:3000"), true);
  assert.equal(tunnel.argv.includes("deploy@172.29.172.1"), true);
  const serialized = read(profilePath);
  assert.equal(/IdentityFile/i.test(serialized), false);
  assert.equal(/BEGIN (OPENSSH |RSA )?PRIVATE KEY/i.test(serialized), false);
  const porcelain = spawnSync("git", ["status", "--porcelain", "--", "app", "lib", "components", "prisma"], { encoding: "utf8" });
  assert.equal((porcelain.stdout ?? "").trim(), "");
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
  assert.ok(rule.split(/\n/).length < 40);
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

test("validate-wave is a thin EO formal-validation wrapper", () => {
  const skill = read(validateWavePath);
  assert.match(skill, /THIN_WRAPPER_TO_EO_FORMAL_VALIDATION/);
  assert.match(skill, /CONTINUE_CHANGE_UNIT/);
  assert.doesNotMatch(skill, /\*\*L1 Focused\*\*/);
  assert.doesNotMatch(skill, /Execute the selected ladder level/);
  assert.match(skill, /Focused local checks/);
});

test("deployment safety distinguishes standing-grant path from exceptional safety", () => {
  const rule = read(deployRulePath);
  assert.match(rule, /StandingReleaseGrant/);
  assert.match(rule, /PREPARE \/ PREFLIGHT \/ DEPLOY \/ CANARY/);
  assert.match(rule, /repeated low-level approvals/);
  assert.match(rule, /force push/);
  assert.match(rule, /arbitrary production shell/);
  assert.match(rule, /unaccepted SHA/);
  assert.doesNotMatch(rule, /every production command requires explicit approval/i);
});

test("authoritative Product surfaces do not implement a second executable lifecycle or router", () => {
  const agents = read(agentsPath);
  const workflow = read(workflowPath);
  const routing = read(routingPath);
  const checklist = read(checklistPath);
  const codeMap = read(codeMapPath);
  assert.match(agents, /Chat transcript is not lifecycle authority/);
  assert.match(agents, /Do not create sibling Product worktrees as an EO substitute/);
  assert.doesNotMatch(agents, /Select validation using the L1–L4 ladder/);
  assert.match(workflow, /not an executable second authority/);
  assert.doesNotMatch(workflow, /This is the authoritative process contract/);
  assert.match(routing, /executable model router/);
  assert.match(routing, /freshContext` is \*\*not\*\* M4/);
  assert.match(routing, /one\*\* M2→M3/);
  assert.match(checklist, /not a lifecycle sequencer/i);
  assert.doesNotMatch(checklist, /Select a level for the \*\*current checkpoint\*\*/);
  assert.match(codeMap, /tracked Product ↔ EO executable metadata/);
  assert.match(codeMap, /thin compatibility wrappers/);
});

test("tracked files do not contain machine-local env source, Playwright path, or secrets", async () => {
  const eo = await loadEo();
  const loaded = eo.loadRepositoryProfile({ repositoryPath: process.cwd() });
  const envSourcePath = loaded.overlay?.localSourcePaths?.[0]?.path ?? "";
  const playwrightPath = loaded.overlay?.runtimeDependencyValues?.playwrightBrowsersPath ?? "";
  const grep = (needle) => {
    if (!needle) {
      return false;
    }
    const result = spawnSync("git", ["grep", "-F", "-n", "-e", needle, "--", ...TRACKED_SURFACES], { encoding: "utf8" });
    return result.status === 0 && result.stdout.trim().length > 0;
  };
  assert.equal(grep(envSourcePath), false);
  assert.equal(grep(playwrightPath), false);
  assert.equal(trackedContains("PLAYWRIGHT_BROWSERS_PATH="), false);
  const profile = read(profilePath);
  const target = read(targetPath);
  assert.equal(profile.includes("password"), false);
  assert.equal(target.includes("privateKey"), false);
  assert.equal(target.includes("DATABASE_URL"), false);
});

test("current EO parser loads the real Product profile, overlay, target, and taskClassPolicy", async () => {
  const eo = await loadEo();
  const loaded = eo.loadRepositoryProfile({ repositoryPath: process.cwd() });
  assert.equal(loaded.source, "worktree");
  assert.equal(loaded.profile.repositoryIdentity.logicalId, "github:DmitryChaadaev1982/negotaitions-web");
  assert.equal(loaded.profile.baseBranch, "deploy/yandex-poc");
  assert.equal(loaded.profile.deploymentProfileRef, eo.STANDARD_RELEASE_PATH_NEGOTAITIONS_YANDEX_POC);
  assert.ok(loaded.overlay);
  assert.equal(loaded.overlay.repositoryLogicalId, loaded.profile.repositoryIdentity.logicalId);
  assert.equal(loaded.overlay.localSourcePaths?.[0]?.environmentType, "LOCAL");
  const envSourcePath = loaded.overlay.localSourcePaths[0].path;
  assert.equal(path.isAbsolute(envSourcePath), true);
  assert.equal(existsSync(envSourcePath), true);
  assert.equal(path.basename(envSourcePath), ".env");
  assert.equal(read(profilePath).includes(envSourcePath), false);
  assert.ok(loaded.overlay.runtimeDependencyValues?.playwrightBrowsersPath);
  assert.equal(path.isAbsolute(loaded.overlay.runtimeDependencyValues.playwrightBrowsersPath), true);
  assert.equal(existsSync(loaded.overlay.runtimeDependencyValues.playwrightBrowsersPath), true);

  const env = loaded.profile.environmentProfiles[0];
  const source = readFileSync(loaded.overlay.localSourcePaths[0].path, "utf8");
  const allow = new Set([...env.requiredVariables, ...env.optionalVariables].map((item) => item.name));
  const imported = eo.parseTypedEnvSource(source, allow);
  const names = Object.keys(imported).sort();
  assert.ok(names.includes("DATABASE_URL"));
  assert.ok(names.includes("APP_URL"));
  assert.equal(names.includes("PLAYWRIGHT_BROWSERS_PATH"), false);

  const classified = names.map((name) => {
    const required = env.requiredVariables.find((item) => item.name === name);
    const optional = env.optionalVariables.find((item) => item.name === name);
    return { name, classification: (required ?? optional)?.classification ?? "UNDECLARED", resolved: true };
  });
  assert.ok(classified.every((item) => item.classification === "SECRET" || item.classification === "NON_SECRET"));
  assert.equal(JSON.stringify(classified).includes(imported.DATABASE_URL ?? "___none___"), false);

  await assert.throws(
    () =>
      eo.copyEnvFileWholesale({
        profile: env,
        sourcePath: loaded.overlay.localSourcePaths[0].path,
        destinationPath: path.join(process.cwd(), ".env"),
      }),
    (error) => String(error).includes("WHOLESALE") || String(error).includes("wholesale"),
  );

  const playwright = eo.resolveValidationRuntimeDependencies({
    dependencies: loaded.profile.runtimeDependencies,
    overlay: loaded.overlay,
    gateId: "test:e2e:smoke:browser",
  });
  assert.equal(playwright.ok, true);
  assert.equal(playwright.overrides.PLAYWRIGHT_BROWSERS_PATH, loaded.overlay.runtimeDependencyValues.playwrightBrowsersPath);
  assert.equal(playwright.considered[0].source, "OVERLAY");
  const lintGate = eo.resolveValidationRuntimeDependencies({
    dependencies: loaded.profile.runtimeDependencies,
    overlay: loaded.overlay,
    gateId: "validate:fast",
  });
  assert.equal(lintGate.ok, true);

  const target = eo.loadDeploymentTargetFromRepo(process.cwd(), eo.TARGET_ENVIRONMENT_NEGOTAITIONS_PRODUCTION);
  assert.equal(target.targetId, "negotaitions-production");
  assert.equal(target.canaryHttpPath, "/api/health");
  const probe = eo.buildTypedRemoteOperation("HTTP_READINESS_PROBE", {
    applicationPath: target.applicationPath,
    gitRemoteName: target.gitRemoteName,
    systemdUnit: target.systemdUnit,
    envConsumerPath: target.envConsumerPath,
    envBackupRoot: target.envBackupRoot,
    deploymentId: "eo-r5b-canary-proof",
    sha: "0123456789abcdef0123456789abcdef01234567",
    httpPath: target.canaryHttpPath,
  });
  assert.ok(probe.argv.some((token) => String(token).includes("/api/health")));

  assert.equal(eo.taskClassForIntent(loaded.profile, "PLANNING"), "SOURCE_ONLY");
  assert.equal(eo.taskClassForIntent(loaded.profile, "IMPLEMENTATION"), "SOURCE_ONLY");
  assert.equal(eo.taskClassForIntent(loaded.profile, "VALIDATION"), "UI_ACCEPTANCE");
  assert.equal(eo.taskClassForIntent(loaded.profile, "AUDIT"), "SOURCE_ONLY");
  assert.equal(eo.localAppRequired(loaded.profile, "SOURCE_ONLY"), false);
  assert.equal(eo.localAppRequired(loaded.profile, "UI_ACCEPTANCE"), true);
});

test("typed import materializes declared keys only in a disposable worktree", async () => {
  const eo = await loadEo();
  const loaded = eo.loadRepositoryProfile({ repositoryPath: process.cwd() });
  const sourcePath = loaded.overlay.localSourcePaths[0].path;
  const dir = mkdtempSync(path.join(os.tmpdir(), "eo-r5b-typed-import-"));
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  writeFileSync(path.join(dir, ".gitignore"), ".env\n");
  const imported = await eo.importTypedEnvironment({
    profile: loaded.profile.environmentProfiles[0],
    worktree: dir,
    sourcePath,
    sourceReferenceClass: "OVERLAY_FILE",
  });
  assert.equal(imported.report.wholesaleCopyOccurred, false);
  assert.ok(imported.importedNames.includes("APP_URL"));
  assert.ok(imported.importedNames.includes("DATABASE_URL"));
  const body = readFileSync(imported.destinationPath, "utf8");
  assert.match(body, /^APP_URL=/m);
  assert.equal(body.includes("PLAYWRIGHT_BROWSERS_PATH"), false);
  const evidence = JSON.stringify(imported.report);
  assert.equal(evidence.includes("DATABASE_URL="), false);
});
