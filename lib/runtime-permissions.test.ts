import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRuntimePermissionPlan,
  assertGeneratedPrismaPathType,
  isRuntimePermissionExcludedPath,
  modeForPermissionPlanning,
  planDirectoryTraversePermission,
  planGeneratedPrismaFilePermission,
  planTrackedFilePermission,
  RuntimePermissionError,
  type GitIndexEntry,
} from "@/lib/runtime-permissions";

function tracked(path: string, mode: "100644" | "100755" | "120000"): GitIndexEntry {
  return { path, mode };
}

test("100644 tracked file at 0600 is selected for runtime read permission", () => {
  const action = planTrackedFilePermission(tracked("scripts/ops/worker.ts", "100644"), 0o600);
  assert.deepEqual(action, {
    source: "tracked-file",
    path: "scripts/ops/worker.ts",
    currentMode: 0o600,
    desiredMode: 0o604,
  });
});

test("already-readable tracked file is not degraded or selected", () => {
  assert.equal(
    planTrackedFilePermission(tracked("scripts/ops/worker.ts", "100644"), 0o664),
    null,
  );
});

test("100755 executable tracked file preserves executable semantics", () => {
  const action = planTrackedFilePermission(tracked("scripts/ops/run.sh", "100755"), 0o700);
  assert.equal(action?.desiredMode, 0o705);
});

test("tracked symlink is not treated as a normal file", () => {
  assert.equal(
    planTrackedFilePermission(tracked("scripts/current", "120000"), 0o777),
    null,
  );
});

test("secret and broad repository paths are excluded from mutation", () => {
  for (const candidate of [
    ".env",
    ".env.production",
    ".git/config",
    "node_modules/pkg/index.js",
    "var/backup.dump.bak",
    "secrets/credentials.json",
    "secrets/private.pem",
  ]) {
    assert.equal(isRuntimePermissionExcludedPath(candidate), true, candidate);
    assert.equal(
      planTrackedFilePermission(tracked(candidate, "100644"), 0o600),
      null,
      candidate,
    );
  }
});

test("generated Prisma regular files are eligible for runtime read permission", () => {
  const action = planGeneratedPrismaFilePermission("app/generated/prisma/client.ts", 0o600);
  assert.deepEqual(action, {
    source: "generated-prisma-file",
    path: "app/generated/prisma/client.ts",
    currentMode: 0o600,
    desiredMode: 0o604,
  });
});

test("generated Prisma directories are eligible for traverse normalization", () => {
  const action = planDirectoryTraversePermission(
    "app/generated/prisma/runtime",
    0o700,
    "generated-prisma-directory",
  );
  assert.equal(action?.desiredMode, 0o701);
});

test("generated Prisma parent directory can be normalized for traversal", () => {
  const action = planDirectoryTraversePermission(
    "app/generated",
    0o700,
    "generated-prisma-directory",
  );
  assert.equal(action?.desiredMode, 0o701);
});

test("Windows directory mode planning treats traverse as an emulated boundary", () => {
  assert.equal(modeForPermissionPlanning(0o600, "directory", "win32") & 0o111, 0o111);
  assert.equal(modeForPermissionPlanning(0o600, "directory", "linux"), 0o600);
});

test("symlink inside generated Prisma causes fail-closed behavior", () => {
  assert.throws(
    () => assertGeneratedPrismaPathType("app/generated/prisma/client.ts", "symlink"),
    (error) =>
      error instanceof RuntimePermissionError &&
      error.code === "GENERATED_PRISMA_SYMLINK",
  );
  assert.throws(
    () => assertGeneratedPrismaPathType("app/generated", "symlink"),
    (error) =>
      error instanceof RuntimePermissionError &&
      error.code === "GENERATED_PRISMA_SYMLINK",
  );
});

test("check mode does not mutate filesystem permissions", async () => {
  const changed = await applyRuntimePermissionPlan(
    process.cwd(),
    [
      {
        source: "tracked-file",
        path: "package.json",
        currentMode: 0o600,
        desiredMode: 0o604,
      },
    ],
    "check",
  );
  assert.equal(changed, 0);
});

test("apply is idempotent at the planning-logic level", () => {
  const first = planTrackedFilePermission(tracked("scripts/ops/worker.ts", "100644"), 0o600);
  assert.equal(first?.desiredMode, 0o604);
  const second = planTrackedFilePermission(
    tracked("scripts/ops/worker.ts", "100644"),
    first?.desiredMode ?? 0,
  );
  assert.equal(second, null);
});
