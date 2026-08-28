import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { bootstrapOperationalEnv } from "@/lib/operational-env";
import {
  createLiveOrphanCleanupLoaders,
  deleteClassifiedRemoteUser,
} from "@/lib/voximplant/orphan-user-cleanup-io";
import {
  parseOrphanCleanupCli,
  runOrphanUserCleanup,
  type ClassifiedRemoteUser,
  type DeleteCandidate,
  type OrphanCleanupResult,
} from "@/lib/voximplant/orphan-user-cleanup";

bootstrapOperationalEnv();

const DEFAULT_OUT_DIR = ".agent";

function timestampStamp(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function csvEscape(value: string | null | undefined): string {
  const text = value ?? "";
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function candidatesCsv(candidates: DeleteCandidate[]): string {
  const header = "user_id,user_name,display_name,reason,source_hint";
  const rows = candidates.map((candidate) =>
    [
      csvEscape(candidate.userId),
      csvEscape(candidate.userName),
      csvEscape(candidate.displayName),
      csvEscape(candidate.reason),
      csvEscape(candidate.sourceHint),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

function keepSample(
  classified: ClassifiedRemoteUser[],
  classification: ClassifiedRemoteUser["classification"],
  limit = 10,
) {
  return classified
    .filter((row) => row.classification === classification)
    .slice(0, limit)
    .map((row) => ({
      userId: row.userId,
      userName: row.userName,
      displayName: row.displayName,
      keepSources: row.keepSources,
    }));
}

function buildEvidence(result: OrphanCleanupResult) {
  if (!result.ok) {
    return {
      stage: "3.24A",
      checkpoint: "CP2-R2",
      mode: "refused",
      ok: false,
      code: result.code,
      message: result.message,
      delUserCalls: result.delUserCalls,
      deletedUsernames: result.deletedUsernames,
      providerMutations: result.delUserCalls === 0 ? "NONE" : "DELUSER_ATTEMPTED",
      dbMutations: "NONE",
    };
  }

  return {
    stage: "3.24A",
    checkpoint: "CP2-R2",
    mode: result.mode,
    ok: true,
    generatedAt: new Date().toISOString(),
    productionSource: result.productionSource,
    productionUserCount: result.productionUserCount,
    localManualSource: result.localManualSource,
    localManualUserCount: result.localManualUserCount,
    e2eSource: result.e2eSource,
    e2eUserCount: result.e2eUserCount,
    managedKeepIds: result.managedKeepIds,
    managedKeepUsernames: result.managedKeepUsernames,
    explicitPocUsernames: result.explicitPocUsernames,
    voxApplication: result.applicationName,
    summary: result.report.summary,
    collisions: result.report.collisions,
    candidateFingerprint: result.report.candidateFingerprint,
    candidates: result.report.candidates,
    classifiedNgU: result.report.classified.filter((row) =>
      row.userName.startsWith("ng_u_"),
    ),
    sampleDeleteCandidates: result.report.candidates.slice(0, 10),
    sampleKeepProduction: keepSample(
      result.report.classified,
      "KEEP_PRODUCTION",
    ),
    sampleKeepLocalManual: keepSample(
      result.report.classified,
      "KEEP_LOCAL_MANUAL",
    ),
    delUserCalls: result.delUserCalls,
    deletedUsernames: result.deletedUsernames,
    batchSize: result.batchSize,
    batchFailurePolicy: result.batchFailurePolicy,
    providerMutations: "NONE",
    dbMutations: "NONE",
    historicalUsersDeleted: 0,
    status: "STAGE_3_24A_CP2_R2_DRY_RUN_READY_AWAITING_OPERATOR_APPROVAL",
  };
}

async function writeEvidence(
  result: OrphanCleanupResult,
  outDir: string,
): Promise<{ reportPath: string; candidatesPath: string | null }> {
  await mkdir(outDir, { recursive: true });
  const stamp = timestampStamp();
  const reportPath = path.join(
    outDir,
    `stage-3-24a-vox-orphan-cleanup-dry-run-${stamp}.json`,
  );
  await writeFile(reportPath, `${JSON.stringify(buildEvidence(result), null, 2)}\n`);

  if (!result.ok) {
    return { reportPath, candidatesPath: null };
  }

  const candidatesPath = path.join(
    outDir,
    `stage-3-24a-vox-orphan-cleanup-dry-run-${stamp}-candidates.csv`,
  );
  await writeFile(candidatesPath, `${candidatesCsv(result.report.candidates)}\n`);
  return { reportPath, candidatesPath };
}

function printSummary(
  result: OrphanCleanupResult,
  paths: { reportPath: string; candidatesPath: string | null },
) {
  if (!result.ok) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: result.code,
          message: result.message,
          delUserCalls: result.delUserCalls,
          reportPath: paths.reportPath,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: result.mode,
        productionSource: result.productionSource,
        productionUserCount: result.productionUserCount,
        localManualSource: result.localManualSource,
        localManualUserCount: result.localManualUserCount,
        e2eSource: result.e2eSource,
        managedKeepUsernames: result.managedKeepUsernames,
        explicitPocUsernames: result.explicitPocUsernames,
        voxApplication: result.applicationName,
        summary: result.report.summary,
        collisions: result.report.collisions.length,
        candidateFingerprint: result.report.candidateFingerprint,
        sampleCandidates: result.report.candidates.slice(0, 10).map((row) => ({
          userId: row.userId,
          userName: row.userName,
          sourceHint: row.sourceHint,
        })),
        delUserCalls: result.delUserCalls,
        providerMutations: "NONE",
        dbMutations: "NONE",
        reportPath: paths.reportPath,
        candidatesPath: paths.candidatesPath,
        status: "STAGE_3_24A_CP2_R2_DRY_RUN_READY_AWAITING_OPERATOR_APPROVAL",
      },
      null,
      2,
    ),
  );
}

async function main() {
  const parsed = parseOrphanCleanupCli(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(JSON.stringify({ ok: false, code: parsed.code, message: parsed.message }, null, 2));
    process.exitCode = 1;
    return;
  }

  if (
    parsed.mode === "apply" &&
    process.env.VOX_ORPHAN_CLEANUP_ALLOW_APPLY !== "1"
  ) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: "APPLY_REQUIRES_EXPLICIT_FLAG",
          message:
            "Live DelUser apply is implemented behind fences but is not authorized in this checkpoint. Re-run without --apply.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const expectedUsernames = parsed.expectedUsernamesPath
    ? (await readFile(parsed.expectedUsernamesPath, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : undefined;

  const result = await runOrphanUserCleanup({
    mode: parsed.mode,
    expectedCount: parsed.expectedCount,
    expectedUsernames,
    expectedFingerprint: parsed.expectedFingerprint,
    loaders: createLiveOrphanCleanupLoaders(),
    deleteUser: deleteClassifiedRemoteUser,
  });

  const outDir = parsed.outDir?.trim() || DEFAULT_OUT_DIR;
  const paths = await writeEvidence(result, outDir);
  printSummary(result, paths);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: "REMOTE_INVENTORY_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
