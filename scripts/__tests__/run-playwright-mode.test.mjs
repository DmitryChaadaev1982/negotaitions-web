import assert from "node:assert/strict";
import test from "node:test";

import {
  PlaywrightModeError,
  preparePlaywrightMode,
  runPlaywrightInMode,
} from "../agent-tooling/run-playwright-mode-lib.mjs";

test("managed mode rejects occupied E2E port", async () => {
  await assert.rejects(
    () =>
      preparePlaywrightMode("managed", {
        detectManagedPortOwner: async () => ({
          status: "occupied",
          pid: 42,
          processName: "node.exe",
          commandLine: "next dev -p 3100",
        }),
      }),
    (error) =>
      error instanceof PlaywrightModeError &&
      error.code === "MANAGED_SERVER_PORT_CONFLICT" &&
      String(error.message).includes("Port 3100"),
  );
});

test("managed mode ignores occupied normal dev port", async () => {
  const result = await preparePlaywrightMode("managed", {
    detectManagedPortOwner: async () => ({ status: "free" }),
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 99,
      processName: "node.exe",
      commandLine: "next dev",
    }),
  });

  assert.equal(result.environment.PLAYWRIGHT_SERVER_MODE, "managed");
});

test("live mode rejects unavailable server", async () => {
  await assert.rejects(
    () =>
      preparePlaywrightMode("live", {
        detectPort3000Owner: async () => ({ status: "occupied" }),
        probeHttpHealth: async () => ({ ok: false, status: null, error: "connection refused" }),
      }),
    (error) =>
      error instanceof PlaywrightModeError &&
      error.code === "LIVE_SERVER_NOT_AVAILABLE",
  );
});

test("live mode accepts exact current worktree", async () => {
  const result = await runPlaywrightInMode(["--mode=live", "--", "--list"], {
    dryRun: true,
    currentWorktree: "C:/repo",
    currentGitCommonDir: "C:/shared/common.git",
    resolveGitCommonDir: async () => "C:/shared/common.git",
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 42,
      processName: "node.exe",
      commandLine: "node C:/repo/node_modules/next/dist/bin/next dev -p 3000",
    }),
    probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
    git: async () => "C:/repo",
  });
  assert.equal(result.environment.PLAYWRIGHT_SERVER_MODE, "live");
});

test("live mode rejects sibling worktree with typed mismatch", async () => {
  await assert.rejects(
    () =>
      runPlaywrightInMode(["--mode=live", "--", "--list"], {
        dryRun: true,
        currentWorktree: "C:/repo",
        currentGitCommonDir: "C:/shared/common.git",
        resolveGitCommonDir: async () => "C:/shared/common.git",
        detectPort3000Owner: async () => ({
          status: "occupied",
          pid: 400,
          processName: "node.exe",
          commandLine: "node C:/repo-sibling/node_modules/next/dist/bin/next dev -p 3000",
        }),
        probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
        git: async () => "C:/repo",
      }),
    (error) =>
      error instanceof PlaywrightModeError &&
      error.code === "LIVE_SERVER_WORKTREE_MISMATCH" &&
      String(error.message).includes("Detected server worktree"),
  );
});

test("playwright arguments are forwarded unchanged", async () => {
  const result = await runPlaywrightInMode(
    ["--mode=managed", "--", "tests/e2e/event-completion.spec.ts", "--project=chromium", "--grep", "@smoke"],
    {
      dryRun: true,
      detectManagedPortOwner: async () => ({ status: "free" }),
    },
  );
  assert.deepEqual(result.args, [
    "playwright",
    "test",
    "--config",
    "playwright.local.config.ts",
    "tests/e2e/event-completion.spec.ts",
    "--project=chromium",
    "--grep",
    "@smoke",
  ]);
});

test("live mode disables playwright webServer via env contract", async () => {
  const result = await runPlaywrightInMode(["--mode=live", "--", "--list"], {
    dryRun: true,
    currentWorktree: "C:/repo",
    currentGitCommonDir: "C:/shared/common.git",
    resolveGitCommonDir: async () => "C:/shared/common.git",
    detectPort3000Owner: async () => ({
      status: "occupied",
      processName: "node.exe",
      commandLine: "node C:/repo/node_modules/next/dist/bin/next dev -p 3000",
    }),
    probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
    git: async () => "C:/repo",
  });
  assert.equal(result.environment.PLAYWRIGHT_SERVER_MODE, "live");
  assert.equal(result.environment.PLAYWRIGHT_BASE_URL, "http://localhost:3000");
});

test("managed mode enables playwright webServer via env contract", async () => {
  const result = await runPlaywrightInMode(["--mode=managed", "--", "--list"], {
    dryRun: true,
    detectManagedPortOwner: async () => ({ status: "free" }),
  });
  assert.equal(result.environment.PLAYWRIGHT_SERVER_MODE, "managed");
});

test("invalid mode returns typed failure", async () => {
  await assert.rejects(
    () => runPlaywrightInMode(["--mode=bad-mode", "--", "--list"], { dryRun: true }),
    (error) =>
      error instanceof PlaywrightModeError && error.code === "INVALID_PLAYWRIGHT_SERVER_MODE",
  );
});
