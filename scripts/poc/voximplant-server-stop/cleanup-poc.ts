/**
 * Cleanup temporary local POC entities from a run cleanup manifest.
 *
 * Usage:
 *   npm run poc:vox:cleanup -- --dry-run
 *   npm run poc:vox:cleanup -- --run-id <runId> --confirm-cleanup --confirm-local-db-write
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  cleanupPocSessionEntities,
  type PocCleanupManifest,
} from "@/lib/voximplant/poc/create-poc-session";
import {
  clearCurrentPointer,
  getPocRunsDir,
  getPocRunPaths,
  readCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import { loadPocEnvFiles } from "./load-env";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

function resolveTargetRunId(): string | null {
  const fromArg = readArg("--run-id");
  if (fromArg) return fromArg;
  const pointer = readCurrentPointer();
  if (pointer) return pointer.runId;

  const dir = getPocRunsDir();
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const manifestPath = join(dir, e.name, "cleanup-manifest.json");
      if (!existsSync(manifestPath)) return null;
      const mtime = statSync(manifestPath).mtimeMs;
      return { runId: e.name, mtime };
    })
    .filter((entry): entry is { runId: string; mtime: number } => entry != null)
    .sort((a, b) => b.mtime - a.mtime);
  return runs[0]?.runId ?? null;
}

async function main(): Promise<void> {
  loadPocEnvFiles();
  const dryRun = hasFlag("--dry-run") || !hasFlag("--confirm-cleanup");
  const confirmLocalDbWrite = hasFlag("--confirm-local-db-write");
  const runId = resolveTargetRunId();

  if (!runId) {
    console.log("[poc:vox:cleanup] no run found");
    process.exitCode = 1;
    return;
  }

  const paths = getPocRunPaths(runId);
  if (!existsSync(paths.cleanupManifestPath)) {
    console.log("[poc:vox:cleanup] cleanup manifest missing", {
      runId,
      path: paths.cleanupManifestPath,
    });
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(
    readFileSync(paths.cleanupManifestPath, "utf8"),
  ) as PocCleanupManifest;

  console.log("[poc:vox:cleanup] intended deletions", {
    runId,
    namespace: manifest.namespace,
    databaseTargetSanitized: manifest.databaseTargetSanitized,
    entityCount: manifest.entities.length,
    entities: manifest.entities,
    providerArtifacts: "never deleted automatically",
    dryRun,
    confirmCleanup: hasFlag("--confirm-cleanup"),
    confirmLocalDbWrite,
  });

  // Preview-only: --dry-run without --confirm-cleanup shows intent and stops.
  if (hasFlag("--dry-run") && !hasFlag("--confirm-cleanup")) {
    console.log(
      "[poc:vox:cleanup] dry-run preview only — pass --confirm-cleanup --confirm-local-db-write to delete",
    );
    return;
  }

  if (!hasFlag("--confirm-cleanup")) {
    console.log(
      "[poc:vox:cleanup] refused — pass --confirm-cleanup (and --confirm-local-db-write) to delete",
    );
    process.exitCode = 1;
    return;
  }

  const result = await cleanupPocSessionEntities({
    manifest,
    confirmLocalDbWrite,
    dryRun,
  });

  if (!dryRun) {
    const pointer = readCurrentPointer();
    if (pointer?.runId === runId) {
      clearCurrentPointer();
    }
  }

  console.log("[poc:vox:cleanup] result", {
    dryRun: result.dryRun,
    deletedCount: result.deleted.length,
    retainedReport: paths.reportPath,
    retainedLogs: paths.logPath,
  });
}

main().catch((error) => {
  console.error("[poc:vox:cleanup] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
