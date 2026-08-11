import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";

const NEW_MIGRATION = "20260811112000_stage_3_13e_session_sound_preference";

async function runPrismaMigrateDeploy(params: {
  repoRoot: string;
  databaseUrl: string;
  configPath: string;
}) {
  const prismaCli = path.join(
    params.repoRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "deploy",
        "--schema",
        path.join(params.repoRoot, "prisma", "schema.prisma"),
        "--config",
        params.configPath,
      ],
      {
        cwd: params.repoRoot,
        env: { ...process.env, DATABASE_URL: params.databaseUrl },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stderr: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.join("").trim() || `prisma exited with ${code}`));
    });
  });
}

test("Stage 3.13E migration backfills existing users and defaults new users to ON", async (t) => {
  const baseUrl = process.env.E2E_DATABASE_URL;
  if (!baseUrl) {
    t.skip("E2E_DATABASE_URL is not configured.");
    return;
  }

  const repoRoot = process.cwd();
  const parsed = new URL(baseUrl);
  const databaseName = `stage313e_pref_${Date.now()}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "stage313e-mig-"));

  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";

  const targetUrl = new URL(baseUrl);
  targetUrl.pathname = `/${databaseName}`;

  const adminClient = new pg.Client({ connectionString: adminUrl.toString() });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await adminClient.end();
  }

  const oldMigrationsDir = path.join(tempDir, "migrations");
  await mkdir(oldMigrationsDir, { recursive: true });
  const sourceMigrationsDir = path.join(repoRoot, "prisma", "migrations");
  const migrationEntries = await readdir(sourceMigrationsDir, { withFileTypes: true });
  for (const entry of migrationEntries) {
    if (entry.name === "migration_lock.toml") {
      await cp(
        path.join(sourceMigrationsDir, entry.name),
        path.join(oldMigrationsDir, entry.name),
      );
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === NEW_MIGRATION) {
      continue;
    }
    await cp(
      path.join(sourceMigrationsDir, entry.name),
      path.join(oldMigrationsDir, entry.name),
      { recursive: true },
    );
  }

  const oldConfigPath = path.join(tempDir, "prisma.old.config.ts");
  await writeFile(
    oldConfigPath,
    [
      "export default {",
      `  schema: ${JSON.stringify(path.join(repoRoot, "prisma", "schema.prisma").replace(/\\/g, "/"))},`,
      "  migrations: {",
      `    path: ${JSON.stringify(oldMigrationsDir.replace(/\\/g, "/"))},`,
      "  },",
      "  datasource: {",
      '    url: process.env["DATABASE_URL"],',
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    await runPrismaMigrateDeploy({
      repoRoot,
      databaseUrl: targetUrl.toString(),
      configPath: oldConfigPath,
    });

    const preClient = new pg.Client({ connectionString: targetUrl.toString() });
    await preClient.connect();
    try {
      await preClient.query(
        `INSERT INTO "User"
           ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
         VALUES
           ('u_existing','existing@test.invalid','hash','Existing','PARTICIPANT','USER','ACTIVE','en',NOW())`,
      );
    } finally {
      await preClient.end();
    }

    await runPrismaMigrateDeploy({
      repoRoot,
      databaseUrl: targetUrl.toString(),
      configPath: path.join(repoRoot, "prisma.config.ts"),
    });

    const postClient = new pg.Client({ connectionString: targetUrl.toString() });
    await postClient.connect();
    try {
      const existing = await postClient.query<{
        sessionSoundEnabled: boolean | null;
      }>(
        `SELECT "sessionSoundEnabled"
         FROM "User"
         WHERE "id"='u_existing'`,
      );
      assert.equal(existing.rows[0]?.sessionSoundEnabled, true);

      await postClient.query(
        `INSERT INTO "User"
           ("id","email","passwordHash","name","role","globalRole","status","preferredLocale","updatedAt")
         VALUES
           ('u_new','new@test.invalid','hash','New','PARTICIPANT','USER','ACTIVE','en',NOW())`,
      );
      const created = await postClient.query<{
        sessionSoundEnabled: boolean | null;
      }>(
        `SELECT "sessionSoundEnabled"
         FROM "User"
         WHERE "id"='u_new'`,
      );
      assert.equal(created.rows[0]?.sessionSoundEnabled, true);

      const nullCount = await postClient.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c
         FROM "User"
         WHERE "sessionSoundEnabled" IS NULL`,
      );
      assert.equal(Number(nullCount.rows[0]?.c ?? "0"), 0);
    } finally {
      await postClient.end();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    const cleanupClient = new pg.Client({ connectionString: adminUrl.toString() });
    await cleanupClient.connect();
    try {
      await cleanupClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally {
      await cleanupClient.end();
    }
  }
});
