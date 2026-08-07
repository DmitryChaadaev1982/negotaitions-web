import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyRuntimePermissionPlan,
  assertGeneratedPrismaArtifactAllowed,
  assertResolvedLocationInsideRoot,
  isRuntimePermissionExcludedPath,
  isTrackedRuntimePermissionPath,
  modeForPermissionPlanning,
  planDirectoryTraversePermission,
  planGeneratedPrismaFilePermission,
  planTrackedFilePermission,
  RuntimePermissionError,
  type GitIndexEntry,
  type RuntimePermissionAction,
  type RuntimePermissionIdentity,
} from "@/lib/runtime-permissions";

function tracked(path: string, mode: "100644" | "100755" | "120000"): GitIndexEntry {
  return { path, mode };
}

function identityFromStats(stats: Awaited<ReturnType<typeof lstat>>): RuntimePermissionIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-permissions-"));
  try {
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

async function writeMode(filePath: string, contents = "ok", mode = 0o600): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  await chmod(filePath, mode);
}

function action(
  path: string,
  overrides: Partial<RuntimePermissionAction> = {},
): RuntimePermissionAction {
  return {
    source: "tracked-file",
    path,
    currentMode: 0o600,
    desiredMode: 0o604,
    requiredBits: 0o004,
    expectedType: "file",
    ...overrides,
  };
}

async function tryCreateSymlink(
  target: string,
  linkPath: string,
  type?: "file" | "dir" | "junction",
): Promise<boolean> {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

test("tracked runtime allowlist selects only production ops surface", () => {
  assert.equal(isTrackedRuntimePermissionPath("scripts/ops/email-provider-event-consumer.ts"), true);
  assert.equal(isTrackedRuntimePermissionPath("lib/operational-env.ts"), true);
  assert.equal(isTrackedRuntimePermissionPath("lib/auth/credential-concurrency.ts"), true);
  assert.equal(isTrackedRuntimePermissionPath("package.json"), true);
  assert.equal(isTrackedRuntimePermissionPath("tsconfig.json"), true);

  assert.equal(isTrackedRuntimePermissionPath("docs/operations/deployment-runbook.md"), false);
  assert.equal(isTrackedRuntimePermissionPath("app/page.tsx"), false);
  assert.equal(isTrackedRuntimePermissionPath("lib/runtime-permissions.test.ts"), false);
});

test("100644 tracked runtime file at 0600 is selected for runtime read permission", () => {
  const candidate = tracked("scripts/ops/email-provider-event-consumer.ts", "100644");
  const planned = planTrackedFilePermission(candidate, 0o600);
  assert.deepEqual(planned, {
    source: "tracked-file",
    path: "scripts/ops/email-provider-event-consumer.ts",
    currentMode: 0o600,
    desiredMode: 0o604,
    requiredBits: 0o004,
    expectedType: "file",
  });
});

test("tracked unrelated files and secrets are not selected", () => {
  for (const candidate of [
    "docs/operations/deployment-runbook.md",
    "app/api/admin/health/route.ts",
    "lib/runtime-permissions.test.ts",
    "secrets/client-secret.json",
    "config/api-token.txt",
  ]) {
    assert.equal(
      planTrackedFilePermission(tracked(candidate, "100644"), 0o600),
      null,
      candidate,
    );
  }
});

test("reviewed source names containing credential remain selectable", () => {
  const planned = planTrackedFilePermission(
    tracked("lib/auth/credential-concurrency.ts", "100644"),
    0o600,
  );
  assert.equal(planned?.path, "lib/auth/credential-concurrency.ts");
});

test("secret and private-key path patterns are excluded from mutation", () => {
  for (const candidate of [
    ".env",
    ".env.production",
    ".git/config",
    "node_modules/pkg/index.js",
    "var/backup.dump.bak",
    "secrets/credentials.json",
    "secrets/private.pem",
    "config/api-token.txt",
    "id_rsa",
    "id_ed25519",
  ]) {
    assert.equal(isRuntimePermissionExcludedPath(candidate), true, candidate);
  }
});

test("generated Prisma expected TypeScript artifacts are eligible", () => {
  const planned = planGeneratedPrismaFilePermission("app/generated/prisma/client.ts", 0o600);
  assert.deepEqual(planned, {
    source: "generated-prisma-file",
    path: "app/generated/prisma/client.ts",
    currentMode: 0o600,
    desiredMode: 0o604,
    requiredBits: 0o004,
    expectedType: "file",
  });
  assert.doesNotThrow(() =>
    assertGeneratedPrismaArtifactAllowed("app/generated/prisma/models/User.ts", "file"),
  );
  assert.doesNotThrow(() =>
    assertGeneratedPrismaArtifactAllowed("app/generated/prisma/internal/class.ts", "file"),
  );
});

test("generated Prisma suspicious and unexpected artifacts fail closed", () => {
  for (const candidate of [
    "app/generated/prisma/.env.production",
    "app/generated/prisma/id_rsa",
    "app/generated/prisma/models/User.ts.bak",
    "app/generated/prisma/runtime.wasm",
    "app/generated/prisma/internal/unknown.ts",
  ]) {
    assert.throws(
      () => planGeneratedPrismaFilePermission(candidate, 0o600),
      (error) =>
        error instanceof RuntimePermissionError &&
        error.code === "UNSAFE_GENERATED_PRISMA_ARTIFACT",
      candidate,
    );
  }
});

test("generated Prisma directories are restricted to known output directories", () => {
  assert.throws(
    () =>
      planDirectoryTraversePermission(
        "app/generated/prisma/runtime",
        0o700,
        "generated-prisma-directory",
      ),
    (error) =>
      error instanceof RuntimePermissionError &&
      error.code === "UNSAFE_GENERATED_PRISMA_ARTIFACT",
  );
  assert.throws(
    () =>
      assertGeneratedPrismaArtifactAllowed(
        "app/generated/prisma/runtime",
        "directory",
      ),
    (error) =>
      error instanceof RuntimePermissionError &&
      error.code === "UNSAFE_GENERATED_PRISMA_ARTIFACT",
  );
  assert.equal(
    planDirectoryTraversePermission(
      "app/generated/prisma/models",
      0o700,
      "generated-prisma-directory",
    )?.desiredMode,
    0o701,
  );
});

test("Windows directory mode planning treats traverse as an emulated boundary", () => {
  assert.equal(modeForPermissionPlanning(0o600, "directory", "win32") & 0o111, 0o111);
  assert.equal(modeForPermissionPlanning(0o600, "directory", "linux"), 0o600);
});

test("realpath containment rejects resolved escapes", async () => {
  await withTempRepo(async (repoRoot) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "runtime-permissions-outside-"));
    try {
      await assert.rejects(
        async () =>
          assertResolvedLocationInsideRoot(
            await import("node:fs/promises").then((fs) => fs.realpath(repoRoot)),
            await import("node:fs/promises").then((fs) => fs.realpath(outside)),
            "scripts/ops/worker.ts",
          ),
        (error) =>
          error instanceof RuntimePermissionError &&
          error.code === "PATH_OUTSIDE_REPOSITORY",
      );
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });
});

test("check mode does not mutate filesystem permissions", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX chmod mode semantics reliably.");
    return;
  }
  await withTempRepo(async (repoRoot) => {
    const filePath = path.join(repoRoot, "scripts/ops/worker.ts");
    await writeMode(filePath, "ok", 0o600);
    const stats = await lstat(filePath);
    const changed = await applyRuntimePermissionPlan(
      repoRoot,
      [action("scripts/ops/worker.ts", { identity: identityFromStats(stats) })],
      "check",
    );
    assert.equal(changed, 0);
    assert.equal((await lstat(filePath)).mode & 0o777, 0o600);
  });
});

test("stable legitimate file succeeds in apply mode", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX chmod mode semantics reliably.");
    return;
  }
  await withTempRepo(async (repoRoot) => {
    const filePath = path.join(repoRoot, "scripts/ops/worker.ts");
    await writeMode(filePath, "ok", 0o600);
    const stats = await lstat(filePath);
    const changed = await applyRuntimePermissionPlan(
      repoRoot,
      [action("scripts/ops/worker.ts", { identity: identityFromStats(stats) })],
      "apply",
    );
    assert.equal(changed, 1);
    assert.equal((await lstat(filePath)).mode & 0o777, 0o604);
  });
});

test("apply preserves current mode augmentation instead of stale planned mode", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX chmod mode semantics reliably.");
    return;
  }
  await withTempRepo(async (repoRoot) => {
    const filePath = path.join(repoRoot, "scripts/ops/worker.ts");
    await writeMode(filePath, "ok", 0o600);
    const stats = await lstat(filePath);
    await chmod(filePath, 0o770);
    const changed = await applyRuntimePermissionPlan(
      repoRoot,
      [action("scripts/ops/worker.ts", { identity: identityFromStats(stats) })],
      "apply",
    );
    assert.equal(changed, 1);
    assert.equal((await lstat(filePath)).mode & 0o777, 0o774);
  });
});

test("path/type changes between plan and apply are rejected", async () => {
  await withTempRepo(async (repoRoot) => {
    const filePath = path.join(repoRoot, "scripts/ops/worker.ts");
    await writeMode(filePath);
    const stats = await lstat(filePath);
    await rm(filePath);
    await mkdir(filePath);

    await assert.rejects(
      () =>
        applyRuntimePermissionPlan(
          repoRoot,
          [action("scripts/ops/worker.ts", { identity: identityFromStats(stats) })],
          "apply",
        ),
      (error) =>
        error instanceof RuntimePermissionError &&
        error.code === "RUNTIME_PERMISSION_TYPE_CHANGED",
    );
  });
});

test("final symlink is rejected before mutation", async (t) => {
  await withTempRepo(async (repoRoot) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "runtime-permissions-target-"));
    try {
      const target = path.join(outside, "worker.ts");
      await writeMode(target);
      await mkdir(path.join(repoRoot, "scripts/ops"), { recursive: true });
      const linked = await tryCreateSymlink(
        target,
        path.join(repoRoot, "scripts/ops/worker.ts"),
        "file",
      );
      if (!linked) {
        t.skip("Symlink creation is unavailable in this environment.");
        return;
      }

      await assert.rejects(
        () =>
          applyRuntimePermissionPlan(
            repoRoot,
            [action("scripts/ops/worker.ts")],
            "apply",
          ),
        (error) =>
          error instanceof RuntimePermissionError &&
          error.code === "RUNTIME_PERMISSION_SYMLINK",
      );
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });
});

test("intermediate symlink in tracked path is rejected", async (t) => {
  await withTempRepo(async (repoRoot) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "runtime-permissions-target-"));
    try {
      await writeMode(path.join(outside, "ops/worker.ts"));
      const linked = await tryCreateSymlink(outside, path.join(repoRoot, "scripts"), "dir");
      if (!linked) {
        t.skip("Symlink creation is unavailable in this environment.");
        return;
      }

      await assert.rejects(
        () =>
          applyRuntimePermissionPlan(
            repoRoot,
            [action("scripts/ops/worker.ts")],
            "apply",
          ),
        (error) =>
          error instanceof RuntimePermissionError &&
          error.code === "RUNTIME_PERMISSION_SYMLINK",
      );
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });
});

test("intermediate symlink in generated Prisma path is rejected", async (t) => {
  await withTempRepo(async (repoRoot) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "runtime-permissions-target-"));
    try {
      await mkdir(path.join(repoRoot, "app"), { recursive: true });
      await writeMode(path.join(outside, "prisma/client.ts"));
      const linked = await tryCreateSymlink(
        outside,
        path.join(repoRoot, "app/generated"),
        "dir",
      );
      if (!linked) {
        t.skip("Symlink creation is unavailable in this environment.");
        return;
      }

      await assert.rejects(
        () =>
          applyRuntimePermissionPlan(
            repoRoot,
            [
              action("app/generated/prisma/client.ts", {
                source: "generated-prisma-file",
                requiredBits: 0o004,
                expectedType: "file",
              }),
            ],
            "apply",
          ),
        (error) =>
          error instanceof RuntimePermissionError &&
          error.code === "RUNTIME_PERMISSION_SYMLINK",
      );
    } finally {
      await rm(outside, { force: true, recursive: true });
    }
  });
});

test("unexpected generated Prisma secret fails closed with no mutation", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX chmod mode semantics reliably.");
    return;
  }
  await withTempRepo(async (repoRoot) => {
    const filePath = path.join(repoRoot, "app/generated/prisma/.env.production");
    await writeMode(filePath, "SECRET=redacted", 0o600);
    await assert.rejects(
      () =>
        applyRuntimePermissionPlan(
          repoRoot,
          [
            action("app/generated/prisma/.env.production", {
              source: "generated-prisma-file",
              requiredBits: 0o004,
              expectedType: "file",
            }),
          ],
          "apply",
        ),
      (error) =>
        error instanceof RuntimePermissionError &&
        error.code === "UNSAFE_GENERATED_PRISMA_ARTIFACT",
    );
    assert.equal((await lstat(filePath)).mode & 0o777, 0o600);
  });
});
