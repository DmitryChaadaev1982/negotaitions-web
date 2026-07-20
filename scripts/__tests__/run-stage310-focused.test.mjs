import assert from "node:assert/strict";
import test from "node:test";

import {
  Stage310FocusedError,
  resolveFocusedMode,
  runStage310Focused,
  selectFocusedTests,
} from "../agent-tooling/run-stage310-focused-lib.mjs";

test("selects existing candidate files", async () => {
  const existing = new Set([
    "C:/repo/lib/session-room-access.test.ts",
    "C:/repo/lib/session-room-lifecycle.test.ts",
    "C:/repo/tests/e2e/event-completion.spec.ts",
  ]);
  const selected = await selectFocusedTests("C:/repo", {
    fileExists: async (filePath) => existing.has(filePath.replace(/\\/g, "/")),
  });
  assert.ok(selected.selectedUnitTests.length >= 2);
  assert.deepEqual(selected.selectedE2eTests, ["tests/e2e/event-completion.spec.ts"]);
});

test("skips absent optional candidates with visible lists", async () => {
  const selected = await selectFocusedTests("C:/repo", {
    fileExists: async () => false,
  });
  assert.ok(selected.missingUnitCandidates.length > 0);
  assert.ok(selected.missingE2eCandidates.length > 0);
});

test("fails when no unit or no e2e candidates exist", async () => {
  await assert.rejects(
    () =>
      runStage310Focused(["--mode=managed", "--dry-run"], {
        repositoryRoot: "C:/repo",
        branch: "chore/tooling",
        fileExists: async () => false,
      }),
    (error) =>
      error instanceof Stage310FocusedError && error.code === "NO_UNIT_TESTS_SELECTED",
  );
});

test("fails when e2e candidates are missing", async () => {
  const existing = new Set(["C:/repo/lib/session-room-access.test.ts"]);
  await assert.rejects(
    () =>
      runStage310Focused(["--mode=managed", "--dry-run"], {
        repositoryRoot: "C:/repo",
        branch: "chore/tooling",
        fileExists: async (filePath) => existing.has(filePath.replace(/\\/g, "/")),
      }),
    (error) =>
      error instanceof Stage310FocusedError && error.code === "NO_E2E_TESTS_SELECTED",
  );
});

test("reuses one selected playwright mode", async () => {
  const existing = new Set([
    "C:/repo/lib/session-room-access.test.ts",
    "C:/repo/tests/e2e/session-finish-canonical.spec.ts",
  ]);
  const result = await runStage310Focused(["--mode=live", "--dry-run"], {
    repositoryRoot: "C:/repo",
    branch: "chore/tooling",
    fileExists: async (filePath) => existing.has(filePath.replace(/\\/g, "/")),
  });
  assert.equal(result.mode, "live");
  const e2eCommand = result.commands[1];
  assert.ok(e2eCommand[1].includes("--mode=live"));
});

test("stops after failed unit phase", async () => {
  const existing = new Set([
    "C:/repo/lib/session-room-access.test.ts",
    "C:/repo/tests/e2e/session-finish-canonical.spec.ts",
  ]);
  const calls = [];
  const result = await runStage310Focused(["--mode=managed"], {
    repositoryRoot: "C:/repo",
    branch: "chore/tooling",
    fileExists: async (filePath) => existing.has(filePath.replace(/\\/g, "/")),
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { code: 1, stdout: "", stderr: "unit failed" };
    },
  });
  assert.equal(result.phase, "unit");
  assert.equal(calls.length, 1);
});

test("default mode rejects sibling-worktree preflight recommendation", async () => {
  const now = new Date().toISOString();
  await assert.rejects(
    () =>
      resolveFocusedMode({
        repositoryRoot: "C:/repo",
        branch: "chore/tooling",
        readFile: async () =>
          JSON.stringify({
            generatedAt: now,
            repositoryRoot: "C:/repo",
            branch: "chore/tooling",
            recommendedPlaywrightMode: "SIBLING_WORKTREE_CONFLICT",
          }),
      }),
    (error) =>
      error instanceof Stage310FocusedError && error.code === "PREFLIGHT_REQUIRED",
  );
});
