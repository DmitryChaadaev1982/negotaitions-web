import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  assertIsolatedE2eDatabase,
  buildE2eServerEnvironment,
  isE2eDatabaseConfigured,
} from "../tests/e2e/helpers/e2e-database";

const REPO_ROOT = process.cwd();
const CLI_SCRIPT = path.join(REPO_ROOT, "scripts/ops/stage-3-10-maintenance.ts");
const SERVER_ONLY_WRAPPERS = [
  "lib/voximplant/server-stop-config.ts",
  "lib/voximplant/server-stop-replay.ts",
  "lib/voximplant/config.ts",
  "lib/voximplant/recording-webhook-url.ts",
  "lib/session-completion.ts",
] as const;
const PURE_CLI_MODULES = [
  "lib/voximplant/server-stop-settings.ts",
  "lib/voximplant/server-stop-replay-store.ts",
  "lib/voximplant/config-settings.ts",
  "lib/voximplant/recording-webhook-url-store.ts",
  "lib/session-completion-core.ts",
  "lib/stage-3-10-maintenance.ts",
  "scripts/ops/stage-3-10-maintenance.ts",
] as const;
const CLIENT_FORBIDDEN_SPECIFIERS = [
  "@/lib/voximplant/server-stop-settings",
  "@/lib/voximplant/server-stop-replay-store",
  "@/lib/voximplant/config-settings",
  "@/lib/voximplant/recording-webhook-url-store",
  "@/lib/session-completion-core",
];

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function cliEnv(
  overrides: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  delete env.DATABASE_URL;
  delete env.E2E_DATABASE_URL;
  delete env.TEST_DATABASE_URL;
  delete env.__NEXT_PROCESSED_ENV;
  Object.assign(env, overrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  return env;
}

async function runMaintenanceCli(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
  } = {},
): Promise<CliResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", CLI_SCRIPT, ...args],
      {
        cwd: options.cwd ?? REPO_ROOT,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`maintenance CLI timed out after ${options.timeoutMs ?? 30_000}ms`));
    }, options.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function collectCliSourceDependencies(entryFile: string): string[] {
  const config = ts.readConfigFile(path.join(REPO_ROOT, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined, "tsconfig.json must be readable");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT);
  const queue = [path.resolve(entryFile)];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const absolutePath = path.resolve(queue.shift() as string);
    if (seen.has(absolutePath)) continue;
    seen.add(absolutePath);

    const source = ts.sys.readFile(absolutePath);
    assert.ok(source, `missing source for ${absolutePath}`);
    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
      const specifier = imported.fileName;
      if (
        specifier === "server-only" ||
        specifier.startsWith("node:") ||
        (!specifier.startsWith(".") && !specifier.startsWith("@/"))
      ) {
        continue;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        absolutePath,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      assert.ok(
        resolved,
        `Could not resolve ${specifier} imported by ${absolutePath}`,
      );
      const dependency = path.resolve(resolved.resolvedFileName);
      const relative = path.relative(REPO_ROOT, dependency);
      if (
        !relative.startsWith("..") &&
        !path.isAbsolute(relative) &&
        !relative.includes(`${path.sep}node_modules${path.sep}`) &&
        !dependency.endsWith(".d.ts")
      ) {
        queue.push(dependency);
      }
    }
  }

  return [...seen]
    .map((absolutePath) =>
      path.relative(REPO_ROOT, absolutePath).replaceAll("\\", "/"),
    )
    .sort();
}

async function collectClientSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".next-e2e") {
        continue;
      }
      files.push(...(await collectClientSourceFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    const source = await readFile(fullPath, "utf8");
    const relative = path.relative(REPO_ROOT, fullPath).replaceAll("\\", "/");
    if (relative.startsWith("components/") || /^["']use client["']/.test(source)) {
      files.push(relative);
    }
  }
  return files;
}

test("CLI entrypoint bootstraps operational env before loading maintenance", async () => {
  const source = await readFile(CLI_SCRIPT, "utf8");
  const bootstrapAt = source.indexOf("bootstrapOperationalEnv();");
  const dynamicImportAt = source.indexOf('await import("@/lib/stage-3-10-maintenance")');
  assert.ok(bootstrapAt >= 0, "CLI must call bootstrapOperationalEnv()");
  assert.ok(dynamicImportAt > bootstrapAt, "maintenance import must follow bootstrap");
  assert.equal(
    /^\s*import[\s\S]*from\s+["']@\/lib\/stage-3-10-maintenance["']/m.test(source),
    false,
    "CLI must not statically import the maintenance module",
  );
});

test("CLI-01 raw maintenance graph has no Next-only server-only imports", async () => {
  const dependencies = collectCliSourceDependencies(CLI_SCRIPT);
  assert.ok(dependencies.includes("scripts/ops/stage-3-10-maintenance.ts"));
  assert.ok(dependencies.includes("lib/stage-3-10-maintenance.ts"));
  assert.ok(dependencies.includes("lib/voximplant/server-stop-settings.ts"));
  assert.ok(dependencies.includes("lib/voximplant/server-stop-replay-store.ts"));
  assert.ok(dependencies.includes("lib/voximplant/config-settings.ts"));
  assert.ok(dependencies.includes("lib/voximplant/recording-webhook-url-store.ts"));
  assert.ok(dependencies.includes("lib/session-completion-core.ts"));

  for (const dependency of dependencies) {
    if (dependency.startsWith("app/generated/prisma/")) continue;
    const source = await readFile(path.join(REPO_ROOT, dependency), "utf8");
    assert.equal(
      /^\s*import\s+["']server-only["']/m.test(source),
      false,
      `${dependency} is on the raw CLI graph and must not import server-only`,
    );
  }

  const productionEnv = cliEnv({
    NODE_ENV: "production",
    DATABASE_URL: undefined,
  });
  const result = await runMaintenanceCli(["--task", "all", "--dry-run"], {
    env: productionEnv,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /DATABASE_URL is not set/);
  assert.doesNotMatch(result.stderr, /Cannot find module ['"]server-only['"]/);
  assert.doesNotMatch(result.stdout, /Cannot find module ['"]server-only['"]/);
});

test("CLI-02 local env bootstrap happens before Prisma requires DATABASE_URL", async () => {
  const result = await runMaintenanceCli(["--task", "all", "--dry-run"], {
    env: cliEnv({
      NODE_ENV: "development",
      DATABASE_URL: undefined,
    }),
    timeoutMs: 60_000,
  });

  assert.doesNotMatch(result.stderr, /DATABASE_URL is not set/);
  assert.doesNotMatch(result.stderr, /Cannot find module ['"]server-only['"]/);
  assert.doesNotMatch(result.stdout, /Cannot find module ['"]server-only['"]/);
  if (result.code === 0) {
    const parsed = JSON.parse(result.stdout) as { dryRun?: boolean };
    assert.equal(parsed.dryRun, true);
  }
});

test("CLI-03 --task all --dry-run reaches every task against the isolated E2E DB", async (t) => {
  if (!isE2eDatabaseConfigured()) {
    t.skip("canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)");
    return;
  }

  const e2eUrl = assertIsolatedE2eDatabase();
  const result = await runMaintenanceCli(["--task", "all", "--dry-run"], {
    env: buildE2eServerEnvironment({ NODE_ENV: "test" }),
    timeoutMs: 60_000,
  });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout, /Cannot find module ['"]server-only['"]/);
  assert.doesNotMatch(result.stderr, /Cannot find module ['"]server-only['"]/);
  assert.equal(result.stdout.includes(e2eUrl), false, "CLI must not print the database URL");

  const parsed = JSON.parse(result.stdout) as {
    task: string;
    dryRun: boolean;
    expiry?: { expired: number; roomsClosed: number };
    recordingStop?: { claimed: number; delivered: number };
    nonceCleanup?: { deleted: number };
    backfill?: { updated: number };
    backfillVerification?: { remainingNull: number };
  };
  assert.equal(parsed.task, "all");
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.expiry?.expired, 0);
  assert.equal(parsed.expiry?.roomsClosed, 0);
  assert.equal(parsed.recordingStop?.claimed, 0);
  assert.equal(parsed.recordingStop?.delivered, 0);
  assert.equal(parsed.nonceCleanup?.deleted, 0);
  assert.equal(parsed.backfill?.updated, 0);
  assert.equal(typeof parsed.backfillVerification?.remainingNull, "number");
});

test("CLI-04 non-dry lifecycle apply is operator-authorized only", async (t) => {
  t.skip(
    "Do not execute the real non-dry Stage 3.10 lifecycle task against development or E2E data from automated unit tests. Operator-authorized recovery uses npm run maintenance:stage310 -- --task all.",
  );
});

test("CLI-05 production refuses local env loading", async () => {
  const result = await runMaintenanceCli(["--task", "all", "--dry-run"], {
    env: cliEnv({
      NODE_ENV: "production",
      DATABASE_URL: undefined,
    }),
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /DATABASE_URL is not set/);
  assert.doesNotMatch(result.stderr, /Cannot find module ['"]server-only['"]/);
});

test("application server-only wrappers still protect sensitive config", async () => {
  for (const wrapper of SERVER_ONLY_WRAPPERS) {
    const source = await readFile(path.join(REPO_ROOT, wrapper), "utf8");
    assert.match(
      source,
      /^\s*import\s+["']server-only["']/m,
      `${wrapper} must retain import "server-only"`,
    );
  }
  for (const modulePath of PURE_CLI_MODULES) {
    const source = await readFile(path.join(REPO_ROOT, modulePath), "utf8");
    assert.equal(
      /^\s*import\s+["']server-only["']/m.test(source),
      false,
      `${modulePath} must stay runtime-neutral for raw tsx`,
    );
  }

  const clientFiles = [
    ...(await collectClientSourceFiles(path.join(REPO_ROOT, "components"))),
    ...(await collectClientSourceFiles(path.join(REPO_ROOT, "app"))),
    ...(await collectClientSourceFiles(path.join(REPO_ROOT, "lib"))),
  ];
  for (const file of clientFiles) {
    const source = await readFile(path.join(REPO_ROOT, file), "utf8");
    if (!/^["']use client["']/.test(source) && !file.startsWith("components/")) {
      continue;
    }
    for (const specifier of CLIENT_FORBIDDEN_SPECIFIERS) {
      assert.equal(
        source.includes(specifier),
        false,
        `${file} must not import ${specifier}`,
      );
    }
  }
});
