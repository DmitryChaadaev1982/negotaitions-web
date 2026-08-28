import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();
const CLI_SCRIPT = path.join(
  REPO_ROOT,
  "scripts/ops/voximplant-orphan-user-cleanup.ts",
);

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        VOX_ORPHAN_CLEANUP_ALLOW_APPLY: "",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test("CLI script defaults to dry-run and never mentions user_id=all", () => {
  const source = readFileSync(CLI_SCRIPT, "utf8");
  assert.match(source, /bootstrapOperationalEnv\(\)/);
  assert.match(source, /mode: parsed.mode/);
  assert.match(source, /VOX_ORPHAN_CLEANUP_ALLOW_APPLY/);
  assert.doesNotMatch(source, /user_id=all/);
  assert.doesNotMatch(source, /DelUser.*all/);
});

test("CLI --apply without expected-count refuses before loaders", async () => {
  const result = await runCli(["--apply"]);
  assert.equal(result.code, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /APPLY_REQUIRED_EXPECTED_COUNT/);
});

test("CLI wildcard user_id=all is refused", async () => {
  const result = await runCli(["user_id=all"]);
  assert.equal(result.code, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /WILDCARD_MODE_FORBIDDEN/);
});

test("CLI --apply is blocked without the extra allow env in this checkpoint", async () => {
  const result = await runCli(["--apply", "--expected-count", "1"]);
  assert.equal(result.code, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /APPLY_REQUIRES_EXPLICIT_FLAG/);
});
