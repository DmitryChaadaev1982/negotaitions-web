import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const bootstrapModulePath = path.resolve(
  process.cwd(),
  "scripts/test-unit-env-bootstrap.mjs",
);
const bootstrapModuleUrl = pathToFileURL(bootstrapModulePath).href;

function createTempProject(envContents) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "unit-env-bootstrap-"));
  fs.writeFileSync(path.join(tempDir, ".env"), envContents, "utf8");
  return tempDir;
}

function runWithBootstrap({ cwd, parentDatabaseUrl, evalCode }) {
  const env = { ...process.env };
  // The parent `test:unit` process already ran `@next/env` loadEnvConfig.
  // That sets `__NEXT_PROCESSED_ENV`, which makes a child loadEnvConfig a no-op
  // if the marker is inherited. Strip it so the child bootstrap can load cwd/.env.
  delete env.__NEXT_PROCESSED_ENV;
  if (parentDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = parentDatabaseUrl;
  }

  return spawnSync(
    process.execPath,
    ["--import", bootstrapModuleUrl, "--eval", evalCode],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );
}

test("parent DATABASE_URL is preserved when already exported", () => {
  const fromFile = "postgresql://file-user:file-pass@localhost:5432/file_db";
  const fromParent = "postgresql://parent-user:parent-pass@localhost:5432/parent_db";
  const tempDir = createTempProject(`DATABASE_URL=${fromFile}\n`);

  try {
    const result = runWithBootstrap({
      cwd: tempDir,
      parentDatabaseUrl: fromParent,
      evalCode: "process.stdout.write(process.env.DATABASE_URL ?? '')",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, fromParent);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(".env DATABASE_URL is loaded when parent process does not define it", () => {
  const fromFile = "postgresql://file-only-user:file-only-pass@localhost:5432/file_only_db";
  const tempDir = createTempProject(`DATABASE_URL=${fromFile}\n`);

  try {
    const result = runWithBootstrap({
      cwd: tempDir,
      parentDatabaseUrl: undefined,
      evalCode: "process.stdout.write(process.env.DATABASE_URL ?? '')",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, fromFile);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("bootstrap does not print DATABASE_URL secret values", () => {
  const secretDatabaseUrl = "postgresql://secret-user:secret-pass@localhost:5432/secret_db";
  const tempDir = createTempProject(`DATABASE_URL=${secretDatabaseUrl}\n`);

  try {
    const result = runWithBootstrap({
      cwd: tempDir,
      parentDatabaseUrl: undefined,
      evalCode: "process.stdout.write('BOOTSTRAP_READY')",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "BOOTSTRAP_READY");

    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    assert.equal(combinedOutput.includes(secretDatabaseUrl), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
