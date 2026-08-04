import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  CONFIRM_LEGACY_PRODUCTION_HISTORY_FLAG,
  executeProductionOverlay,
  PrismaProductionOverlayError,
  redactSensitiveOutput,
  type OverlayMode,
} from "@/lib/prisma-production-migration-overlay";

function loadEnvWithoutPrinting(repoRoot: string): void {
  const candidates = [
    process.env.PRISMA_PRODUCTION_OVERLAY_ENV_FILE,
    path.join(repoRoot, ".env.production"),
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
  ].filter((value): value is string => Boolean(value));

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const values = parse(readFileSync(envPath));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function parseMode(value: string | undefined): OverlayMode {
  if (value === "status" || value === "deploy" || value === "verify") {
    return value;
  }
  throw new Error("Usage: prisma-production-migration-overlay.ts <status|deploy|verify> [--confirm-legacy-production-history]");
}

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    "confirm-legacy-production-history": {
      type: "boolean",
      default: false,
    },
  },
});

const mode = parseMode(parsed.positionals[0]);
const repoRoot = process.cwd();
loadEnvWithoutPrinting(repoRoot);

void executeProductionOverlay({
  repoRoot,
  mode,
  confirmed: Boolean(parsed.values["confirm-legacy-production-history"]),
  databaseUrl: process.env.DATABASE_URL,
  stdout: process.stdout,
  stderr: process.stderr,
})
  .then(() => {
    if (mode === "deploy") {
      console.log("Production legacy migration overlay deploy completed.");
    } else if (mode === "status") {
      console.log("Production legacy migration overlay status completed.");
    }
  })
  .catch((error) => {
    const message =
      error instanceof Error ? error.message : String(error);
    const databaseUrl = process.env.DATABASE_URL;
    console.error(redactSensitiveOutput(message, databaseUrl));
    if (error instanceof PrismaProductionOverlayError) {
      process.exit(1);
    }
    if (message.includes(CONFIRM_LEGACY_PRODUCTION_HISTORY_FLAG)) {
      process.exit(1);
    }
    process.exit(1);
  });
