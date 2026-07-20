import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDatabaseUrl,
  sameFsPath,
} from "../agent-tooling/common.mjs";
import {
  classifyPlaywrightMode,
  collectPreflightSnapshot,
  formatPreflightReport,
  resolveServerOwnership,
} from "../agent-tooling/agent-preflight-lib.mjs";

async function makeSnapshot(overrides = {}) {
  return collectPreflightSnapshot({
    repositoryRoot: "C:/repo",
    branch: "chore/tooling",
    head: "abc123",
    statusOutput: " M package.json\n?? scripts/new-file.mjs\n",
    databaseUrl:
      "postgresql://user:secret@localhost:5432/negotiations?schema=public",
    e2eDatabaseUrl:
      "postgresql://user:secret@localhost:5433/negotiations_e2e?schema=public",
    parseDatabaseUrl,
    checkPostgresConnectivity: async () => ({ connected: true, reason: "ok" }),
    detectChromiumAvailability: async () => ({
      packageAvailable: true,
      runtimeAvailable: true,
      runtimePath: "/tmp/chromium",
      classification: "ready",
    }),
    detectPort3000Owner: async () => ({
      status: "free",
      pid: null,
      processName: null,
      commandLine: null,
    }),
    currentGitCommonDir: "C:/repo/.git",
    resolveGitCommonDir: async () => "C:/repo/.git",
    probeHttpHealth: async () => ({ ok: false, status: null, error: "down" }),
    ...overrides,
  });
}

test("free port recommends MANAGED", async () => {
  const snapshot = await makeSnapshot();
  assert.equal(snapshot.recommendedPlaywrightMode, "MANAGED");
});

test("exact current-worktree server recommends LIVE", async () => {
  const snapshot = await makeSnapshot({
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 777,
      processName: "node.exe",
      commandLine: "node C:/repo/node_modules/next/dist/bin/next dev -p 3000",
    }),
    probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
  });
  assert.equal(snapshot.recommendedPlaywrightMode, "LIVE");
});

test("sibling worktree recommends SIBLING_WORKTREE_CONFLICT", async () => {
  const snapshot = await makeSnapshot({
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 200,
      processName: "node.exe",
      commandLine: "node C:/repo-sibling/node_modules/next/dist/bin/next dev -p 3000",
    }),
    probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
    resolveGitCommonDir: async (worktree) =>
      worktree.replace(/\\/g, "/").includes("repo-sibling")
        ? "C:/shared/common.git"
        : "C:/shared/common.git",
    currentGitCommonDir: "C:/shared/common.git",
  });
  assert.equal(snapshot.recommendedPlaywrightMode, "SIBLING_WORKTREE_CONFLICT");
});

test("unrelated healthy owner recommends PROCESS_CONFLICT", async () => {
  const snapshot = await makeSnapshot({
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 100,
      processName: "node.exe",
      commandLine: "node C:/other/project/node_modules/next/dist/bin/next dev -p 3000",
    }),
    probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
    resolveGitCommonDir: async (worktree) =>
      worktree.replace(/\\/g, "/").includes("other") ? "C:/other/.git" : "C:/repo/.git",
    currentGitCommonDir: "C:/repo/.git",
  });
  assert.equal(snapshot.recommendedPlaywrightMode, "PROCESS_CONFLICT");
});

test("unknown ownership recommends UNAVAILABLE", async () => {
  const snapshot = await makeSnapshot({
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 101,
      processName: "node.exe",
      commandLine: "node custom-server.js",
    }),
    probeHttpHealth: async () => ({ ok: true, status: 200, error: null }),
  });
  assert.equal(snapshot.recommendedPlaywrightMode, "UNAVAILABLE");
});

test("db output is sanitized", async () => {
  const snapshot = await makeSnapshot();
  const report = formatPreflightReport(snapshot);
  assert.match(report, /localhost:5432\/negotiations/);
  assert.match(report, /localhost:5433\/negotiations_e2e/);
  assert.doesNotMatch(report, /postgresql:\/\/user:secret@/);
});

test("secrets never appear in output", async () => {
  const snapshot = await makeSnapshot({
    detectPort3000Owner: async () => ({
      status: "occupied",
      pid: 3,
      processName: "node.exe",
      commandLine: "node app.js --token=my-secret-token",
    }),
  });
  const report = formatPreflightReport(snapshot);
  assert.doesNotMatch(report, /secret@/);
  assert.doesNotMatch(report, /API_KEY/i);
});

test("same main and e2e database is flagged unsafe", async () => {
  const snapshot = await makeSnapshot({
    e2eDatabaseUrl:
      "postgresql://user:secret@localhost:5432/negotiations?schema=public",
  });
  assert.equal(snapshot.database.distinctTargets, false);
  assert.match(formatPreflightReport(snapshot), /no \(unsafe\)/);
});

test("chromium classification reports missing and present states", async () => {
  const missing = await makeSnapshot({
    detectChromiumAvailability: async () => ({
      packageAvailable: false,
      runtimeAvailable: false,
      runtimePath: null,
      classification: "missing-package",
    }),
  });
  assert.equal(missing.chromium.classification, "missing-package");

  const present = await makeSnapshot();
  assert.equal(present.chromium.classification, "ready");
});

test("windows path case differences still match", () => {
  assert.equal(
    sameFsPath("C:\\Projects\\Negotiations AI\\Repo", "c:/projects/negotiations ai/repo"),
    true,
  );
});

test("slash differences still match", () => {
  assert.equal(
    sameFsPath("C:\\Projects\\Negotiations AI\\Repo", "C:/Projects/Negotiations AI/Repo"),
    true,
  );
});

test("prefix-like paths do not falsely match", () => {
  assert.equal(
    sameFsPath("C:/Projects/negotiations-web", "C:/Projects/negotiations-web-old"),
    false,
  );
});

test("classifier behavior for free and unknown states", () => {
  const managed = classifyPlaywrightMode({
    portStatus: { status: "free" },
    health: { ok: false },
    ownership: { ownershipDeterminable: false, sameWorktree: null, sameGitRepository: null },
  });
  assert.equal(managed.mode, "MANAGED");

  const unavailable = classifyPlaywrightMode({
    portStatus: { status: "unknown" },
    health: { ok: false },
    ownership: { ownershipDeterminable: false, sameWorktree: null, sameGitRepository: null },
  });
  assert.equal(unavailable.mode, "UNAVAILABLE");
});

test("ownership resolver returns exact worktree match", async () => {
  const ownership = await resolveServerOwnership({
    portStatus: {
      status: "occupied",
      commandLine: "node C:/repo/node_modules/next/dist/bin/next dev -p 3000",
    },
    currentWorktree: "C:/repo",
    currentGitCommonDir: "C:/repo/.git",
    resolveCommonDir: async () => "C:/repo/.git",
  });
  assert.equal(ownership.sameWorktree, true);
});
