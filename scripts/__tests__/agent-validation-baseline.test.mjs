import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  checkBaseline,
  classifyChangedFiles,
  buildRecommendation,
  computeValidationFingerprint,
  recordBaseline,
  showBaseline,
} from "../agent-tooling/agent-validation-baseline-lib.mjs";

async function createTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-baseline-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
  await fs.writeFile(path.join(dir, "README.md"), "hello\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

test("exact fingerprint matches", async () => {
  const repo = await createTempRepo();
  const first = await computeValidationFingerprint(repo);
  const second = await computeValidationFingerprint(repo);
  assert.equal(first.dirtyTreeFingerprint, second.dirtyTreeFingerprint);
});

test("tracked diff changes fingerprint", async () => {
  const repo = await createTempRepo();
  const before = await computeValidationFingerprint(repo);
  await fs.appendFile(path.join(repo, "README.md"), "changed\n", "utf8");
  const after = await computeValidationFingerprint(repo);
  assert.notEqual(before.trackedDiffFingerprint, after.trackedDiffFingerprint);
});

test("staged diff changes fingerprint", async () => {
  const repo = await createTempRepo();
  const before = await computeValidationFingerprint(repo);
  await fs.writeFile(path.join(repo, "file.txt"), "v1\n", "utf8");
  execFileSync("git", ["add", "file.txt"], { cwd: repo });
  const after = await computeValidationFingerprint(repo);
  assert.notEqual(before.stagedDiffFingerprint, after.stagedDiffFingerprint);
});

test("untracked file content changes fingerprint", async () => {
  const repo = await createTempRepo();
  await fs.writeFile(path.join(repo, "scratch.txt"), "first\n", "utf8");
  const first = await computeValidationFingerprint(repo);
  await fs.writeFile(path.join(repo, "scratch.txt"), "second\n", "utf8");
  const second = await computeValidationFingerprint(repo);
  assert.notEqual(first.untrackedFilesFingerprint, second.untrackedFilesFingerprint);
});

test("ignored generated files do not change fingerprint", async () => {
  const repo = await createTempRepo();
  const before = await computeValidationFingerprint(repo);
  await fs.mkdir(path.join(repo, ".agent"), { recursive: true });
  await fs.writeFile(path.join(repo, ".agent", "preflight.json"), "{}\n", "utf8");
  const after = await computeValidationFingerprint(repo);
  assert.equal(before.untrackedFilesFingerprint, after.untrackedFilesFingerprint);
});

test("missing baseline returns exit code 3", async () => {
  const repo = await createTempRepo();
  const result = await checkBaseline(repo);
  assert.equal(result.exitCode, 3);
});

test("record refuses without --confirm-green", async () => {
  const repo = await createTempRepo();
  await assert.rejects(
    () => recordBaseline(repo, ["--note", "missing confirm"]),
    /--confirm-green/,
  );
});

test("markdown-only changes are focused-validation sufficient", () => {
  const analysis = classifyChangedFiles(["docs/notes.md", "README.md"]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FOCUSED_VALIDATION_SUFFICIENT");
});

test("translation dictionary and tests are focused-validation sufficient", () => {
  const analysis = classifyChangedFiles([
    "lib/i18n/dictionaries/ru.ts",
    "tests/e2e/helper.spec.ts",
  ]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FOCUSED_VALIDATION_SUFFICIENT");
});

test("css-only changes are focused-validation sufficient", () => {
  const analysis = classifyChangedFiles(["app/styles.css", "components/theme.css"]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FOCUSED_VALIDATION_SUFFICIENT");
});

test("generic component tsx escalates to full gate", () => {
  const analysis = classifyChangedFiles(["components/event-lobby-view.tsx"]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FULL_GATE_RECOMMENDED");
});

test("polling helper escalates to full gate", () => {
  const analysis = classifyChangedFiles(["lib/event-state-polling.ts"]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FULL_GATE_RECOMMENDED");
});

test("api route escalates to full gate", () => {
  const analysis = classifyChangedFiles(["app/api/events/[id]/state/route.ts"]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FULL_GATE_RECOMMENDED");
});

test("package/playwright/tooling config escalates to full gate", () => {
  const analysis = classifyChangedFiles([
    "package.json",
    "playwright.local.config.ts",
    "scripts/run-playwright-mode.mjs",
  ]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FULL_GATE_RECOMMENDED");
});

test("mixed docs and app logic escalates to full gate", () => {
  const analysis = classifyChangedFiles(["docs/notes.md", "lib/domain-lifecycle.ts"]);
  const recommendation = buildRecommendation({ fingerprintMatch: false, analysis });
  assert.equal(recommendation.recommendation, "FULL_GATE_RECOMMENDED");
});

test("output identifies escalation files", async () => {
  const repo = await createTempRepo();
  await fs.mkdir(path.join(repo, "components"), { recursive: true });
  await fs.writeFile(path.join(repo, "components/panel.tsx"), "export const A = 1;\n", "utf8");
  const shown = await showBaseline(repo);
  assert.ok(shown.escalationFiles.some((item) => item.file === "components/panel.tsx"));
});

test("show reports baseline current after record", async () => {
  const repo = await createTempRepo();
  await recordBaseline(repo, ["--confirm-green", "--command", "npm run validate:fast"]);
  const shown = await showBaseline(repo);
  assert.equal(shown.fingerprintMatch, true);
  assert.equal(shown.recommendation, "BASELINE_CURRENT");
});
