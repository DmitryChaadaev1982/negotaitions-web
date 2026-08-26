import { DEFAULT_HEARTBEAT_MS } from "./bounded-process.mjs";
import { resolveInstalledPrismaCli, toNodeImportSpecifier } from "./prisma-generate.mjs";
import { resolveWorktreeFile } from "./paths.mjs";

export const HEARTBEAT_MS = DEFAULT_HEARTBEAT_MS;

export const UNIT_TEST_TIMEOUT_MS = 180_000;

export const STEP_TIMEOUTS_MS = Object.freeze({
  "check:native-dialogs": 60_000,
  lint: 180_000,
  "prisma validate": 60_000,
  "prisma generate": 120_000,
  "test:unit": 10 * 60_000,
  "test:e2e:list": 180_000,
  "next build": 10 * 60_000,
});

export const RUN_BUDGETS_MS = Object.freeze({
  fast: 15 * 60_000,
  build: 10 * 60_000,
  deploy: 25 * 60_000,
});

export const FAST_STEP_IDS = Object.freeze([
  "check:native-dialogs",
  "lint",
  "prisma validate",
  "prisma generate",
  "test:unit",
  "test:e2e:list",
]);

export const BUILD_STEP_IDS = Object.freeze(["next build"]);

export const DEPLOY_STEP_IDS = Object.freeze([...FAST_STEP_IDS, ...BUILD_STEP_IDS]);

export function getFastStepIds() {
  return [...FAST_STEP_IDS];
}

export function getBuildStepIds() {
  return [...BUILD_STEP_IDS];
}

export function getDeployStepIds() {
  return [...DEPLOY_STEP_IDS];
}

function spawnStep(id, file, args) {
  return {
    id,
    kind: "spawn",
    timeoutMs: STEP_TIMEOUTS_MS[id],
    file,
    args,
  };
}

export function createCanonicalSteps(options) {
  const worktreeRoot = options.worktreeRoot;
  const toolchainRoot = options.toolchainRoot ?? worktreeRoot;
  const node = process.execPath;

  const nativeDialogs = resolveWorktreeFile(
    toolchainRoot,
    ["scripts", "check-native-dialogs.mjs"],
    "native-dialog guard",
  );
  const eslintCli = resolveWorktreeFile(
    toolchainRoot,
    ["node_modules", "eslint", "bin", "eslint.js"],
    "eslint",
  );
  const playwrightCli = resolveWorktreeFile(
    toolchainRoot,
    ["node_modules", "@playwright", "test", "cli.js"],
    "Playwright CLI",
  );
  const nextCli = resolveWorktreeFile(
    toolchainRoot,
    ["node_modules", "next", "dist", "bin", "next"],
    "next",
  );
  const prismaCli = resolveInstalledPrismaCli(toolchainRoot);
  const unitBootstrap = toNodeImportSpecifier(
    resolveWorktreeFile(
      toolchainRoot,
      ["scripts", "test-unit-env-bootstrap.mjs"],
      "unit test env bootstrap",
    ),
  );

  return {
    fast: [
      spawnStep("check:native-dialogs", node, [nativeDialogs]),
      spawnStep("lint", node, [eslintCli]),
      spawnStep("prisma validate", node, [prismaCli, "validate"]),
      {
        id: "prisma generate",
        kind: "prisma-generate",
        timeoutMs: STEP_TIMEOUTS_MS["prisma generate"],
      },
      spawnStep("test:unit", node, [
        "--import",
        unitBootstrap,
        "--import",
        "tsx",
        `--test-timeout=${UNIT_TEST_TIMEOUT_MS}`,
        "--test",
        "lib/**/*.test.ts",
        "app/**/*.test.ts",
        "components/**/*.test.ts",
        "scripts/__tests__/*.test.mjs",
      ]),
      spawnStep("test:e2e:list", node, [playwrightCli, "test", "--list"]),
    ],
    build: [
      spawnStep("next build", node, [nextCli, "build"]),
    ],
  };
}

export function stepsForCommand(command, options) {
  const graphs = createCanonicalSteps(options);
  if (command === "fast") {
    return graphs.fast;
  }
  if (command === "build") {
    return graphs.build;
  }
  if (command === "deploy") {
    return [...graphs.fast, ...graphs.build];
  }
  throw new Error(`Unsupported validation command: ${command}`);
}
