import { spawn } from "node:child_process";

import { loadEnvConfig } from "@next/env";

import {
  assertIsolatedE2eDatabase,
  getSanitizedE2eDatabaseDescriptor,
  maskCredentialsInUrl,
} from "../tests/e2e/helpers/e2e-database";

loadEnvConfig(process.cwd());

type Mode = "all" | "tests" | "verify";

function parseMode(argv: string[]): Mode {
  if (argv.length === 0) return "all";
  if (argv.length === 1 && argv[0] === "--tests-only") return "tests";
  if (argv.length === 1 && argv[0] === "--verify-only") return "verify";
  throw new Error("Usage: tsx scripts/run-stage-3-13c-provider-events.ts [--tests-only|--verify-only]");
}

function runCommand(label: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  console.log(`[stage313c-provider-events] ${label}`);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code ?? "null"}`));
    });
  });
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const e2eUrl = assertIsolatedE2eDatabase();
  const descriptor = getSanitizedE2eDatabaseDescriptor(e2eUrl);
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_DATABASE_URL: e2eUrl,
    DATABASE_URL: e2eUrl,
    STAGE313C_PROVIDER_EVENT_LOCK_TEST_REQUIRED: "true",
    EMAIL_PROVIDER: "fake",
    EMAIL_DELIVERY_ENABLED: "true",
    EMAIL_LOCAL_PREVIEW_ENABLED: "false",
    EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "false",
  };

  for (const key of [
    "YANDEX_POSTBOX_ACCESS_KEY_ID",
    "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
    "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
    "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  ]) {
    delete childEnv[key];
  }

  console.log("[stage313c-provider-events] canonical E2E database accepted");
  console.log(`[stage313c-provider-events] E2E URL: ${maskCredentialsInUrl(e2eUrl)}`);
  console.log(`[stage313c-provider-events] E2E host: ${descriptor.normalizedHost}`);
  console.log(`[stage313c-provider-events] E2E port: ${descriptor.port}`);
  console.log(`[stage313c-provider-events] E2E database: ${descriptor.database}`);

  if (mode !== "verify") {
    await runCommand(
      "unit and PostgreSQL lock tests",
      process.execPath,
      [
        "--import",
        "./scripts/test-unit-env-bootstrap.mjs",
        "--import",
        "tsx",
        "--test",
        "lib/email/yandex-postbox-provider-event-parser.test.ts",
        "lib/email/provider-event-consumer.test.ts",
        "lib/email/provider-event-consumer-shards.test.ts",
        "lib/email/provider-event-consumer-cli.test.ts",
        "lib/email/provider-event-consumer-lock.pg.test.ts",
      ],
      childEnv,
    );
  }

  if (mode !== "tests") {
    await runCommand(
      "provider-event remediation verifier",
      process.execPath,
      ["--import", "tsx", "scripts/verify-stage-3-13c-provider-event-remediation.ts"],
      childEnv,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(
    `[stage313c-provider-events-error] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
