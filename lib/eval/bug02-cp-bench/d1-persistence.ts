import { randomUUID } from "node:crypto";

import type pg from "pg";

import {
  asProcessingMetadata,
  mergeProcessingMetadata,
} from "@/lib/transcription/processing-metadata";
import {
  applyPgSetupSessionGuards,
  createPgTestClient,
  createPgTestPool,
  endPgTestResources,
  PG_TEST_LOCK_TIMEOUT_SAFETY_SQL,
} from "@/lib/test-helpers/pg-coordination";
import {
  assertIsolatedE2eDatabase,
  getSanitizedE2eDatabaseDescriptor,
} from "../../../tests/e2e/helpers/e2e-database";

import { summarizePercentiles } from "./planner";
import type { D1StressResult } from "./types";

type D1Chunk = {
  chunkId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "RETRYABLE_FAILED" | "FAILED";
  targetIndexes: number[];
  unpublishedTexts?: Record<string, string>;
  attempt: number;
  completedAt?: string;
};

type D1Job = {
  executionStatus: "QUEUED" | "RUNNING" | "COMPLETED";
  publicationEligible: boolean;
  terminalQuality: "COMPLETED" | "PARTIAL" | "FAILED" | null;
  runId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  inputIdentity: string;
  progress: {
    totalChunks: number;
    completedChunks: number;
    runningChunks: number;
    pendingChunks: number;
    retryableFailedChunks: number;
    permanentFailedChunks: number;
  };
  chunks: Record<string, D1Chunk>;
};

function asJob(value: unknown): D1Job {
  return asProcessingMetadata(asProcessingMetadata(value).transcriptEnhancement) as unknown as D1Job;
}

function buildInitialMetadata(totalChunks: number, includeUnpublished: boolean): Record<string, unknown> {
  const chunks: Record<string, D1Chunk> = {};
  for (let i = 0; i < totalChunks; i += 1) {
    chunks[`c${i}`] = {
      chunkId: `c${i}`,
      status: "PENDING",
      targetIndexes: [i],
      attempt: 0,
      ...(includeUnpublished ? { unpublishedTexts: {} } : {}),
    };
  }
  const job: D1Job = {
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    runId: `bench-${randomUUID()}`,
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    inputIdentity: "bug02-cp-bench",
    progress: {
      totalChunks,
      completedChunks: 0,
      runningChunks: 0,
      pendingChunks: totalChunks,
      retryableFailedChunks: 0,
      permanentFailedChunks: 0,
    },
    chunks,
  };
  return {
    pauseProcessing: { mode: "source_audio_cut", keep: true },
    mappingSuggestion: { reason: "bench", isApplied: false, version: 0 },
    transcriptEnhancement: job,
  };
}

async function createFixture(client: pg.Client, label: string) {
  const userId = randomUUID();
  const caseId = randomUUID();
  const sessionId = randomUUID();
  const transcriptId = randomUUID();
  await client.query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "preferredLocale", "updatedAt")
     VALUES ($1, $2, 'bench-hash', 'BUG02 CP-BENCH', 'USER', 'ACTIVE', 'ru', NOW())`,
    [userId, `bug02-cp-bench-${userId}@test.negotaitions.local`],
  );
  await client.query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, $2, 'bench', 'bench', 'bench', 'bench', 'EASY', 'RU',
             60, 60, $3, $3, 'PRIVATE', NOW())`,
    [caseId, label, userId],
  );
  await client.query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "negotiationState", "updatedAt")
     VALUES ($1, $2, $3, $4, $4, 'bench', 'bench', 'RU', 'FINISHED', NOW())`,
    [sessionId, caseId, userId, label],
  );
  await client.query(
    `INSERT INTO "Transcript"
       ("id", "sessionId", "source", "status", "text", "processingMetadata", "updatedAt")
     VALUES ($1, $2, 'GENERATED', 'COMPLETED', 'bench raw transcript', $3::jsonb, NOW())`,
    [transcriptId, sessionId, JSON.stringify(buildInitialMetadata(4, false))],
  );
  return { userId, caseId, sessionId, transcriptId };
}

async function destroyFixture(
  client: pg.Client,
  fixture: { userId: string; caseId: string; sessionId: string },
) {
  await client.query(`DELETE FROM "Session" WHERE "id" = $1`, [fixture.sessionId]);
  await client.query(`DELETE FROM "NegotiationCase" WHERE "id" = $1`, [fixture.caseId]);
  await client.query(`DELETE FROM "User" WHERE "id" = $1`, [fixture.userId]);
}

async function lockedMergeWrite(params: {
  pool: pg.Pool;
  transcriptId: string;
  patchBuilder: (latest: Record<string, unknown>) => Record<string, unknown>;
}): Promise<{ elapsedMs: number; lockWaitMs: number }> {
  const client = await params.pool.connect();
  const started = Date.now();
  let lockWaitMs = 0;
  try {
    await client.query(PG_TEST_LOCK_TIMEOUT_SAFETY_SQL);
    await client.query("BEGIN");
    const lockStarted = Date.now();
    await client.query(`SELECT "id" FROM "Transcript" WHERE "id" = $1 FOR UPDATE`, [
      params.transcriptId,
    ]);
    lockWaitMs = Date.now() - lockStarted;
    const latestRow = await client.query(
      `SELECT "processingMetadata" FROM "Transcript" WHERE "id" = $1`,
      [params.transcriptId],
    );
    const latest = asProcessingMetadata(latestRow.rows[0]?.processingMetadata);
    const next = mergeProcessingMetadata(latest, params.patchBuilder(latest));
    await client.query(
      `UPDATE "Transcript"
          SET "processingMetadata" = $2::jsonb, "updatedAt" = NOW()
        WHERE "id" = $1`,
      [params.transcriptId, JSON.stringify(next)],
    );
    await client.query("COMMIT");
    return { elapsedMs: Date.now() - started, lockWaitMs };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
}

function completeChunkPatch(latest: Record<string, unknown>, chunkId: string, text: string) {
  const job = asJob(latest);
  const chunk = job.chunks[chunkId];
  if (!chunk) {
    throw new Error(`missing chunk ${chunkId}`);
  }
  const nextChunk: D1Chunk = {
    ...chunk,
    status: "COMPLETED",
    attempt: chunk.attempt + 1,
    completedAt: new Date().toISOString(),
    unpublishedTexts: { ...(chunk.unpublishedTexts ?? {}), [String(chunk.targetIndexes[0])]: text },
  };
  const chunks = { ...job.chunks, [chunkId]: nextChunk };
  const completedChunks = Object.values(chunks).filter((item) => item.status === "COMPLETED").length;
  return {
    transcriptEnhancement: {
      ...job,
      progress: {
        ...job.progress,
        completedChunks,
        pendingChunks: job.progress.totalChunks - completedChunks,
        runningChunks: 0,
      },
      chunks,
    },
  };
}

function classifyDbError(error: unknown): "deadlock" | "serialization" | "other" {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "40P01") return "deadlock";
  if (code === "40001") return "serialization";
  return "other";
}

export async function runD1PersistenceStress(params?: {
  burstWriters?: number;
  xlChunkCount?: number;
}): Promise<D1StressResult> {
  const connectionString = assertIsolatedE2eDatabase();
  const descriptor = getSanitizedE2eDatabaseDescriptor(connectionString);
  if (descriptor.hostClass !== "local") {
    throw new Error("BUG02_CP_BENCH_BLOCKED: D1 requires local isolated E2E database");
  }

  const burstWriters = params?.burstWriters ?? 8;
  const xlChunkCount = params?.xlChunkCount ?? 48;
  const pool = createPgTestPool(connectionString);
  const setup = createPgTestClient(connectionString);
  const checkpointMs: number[] = [];
  const lockWaitMs: number[] = [];
  let serializationFailures = 0;
  let deadlocks = 0;
  let lostMapping = false;
  let lostSibling = false;
  let staleSnapshotLostChunk = false;
  let interruptedReadable = false;
  const lostChunks: string[] = [];

  await setup.connect();
  await applyPgSetupSessionGuards(setup);
  const fixture = await createFixture(setup, "BUG02 D1 persistence stress");

  try {
    await setup.query(
      `UPDATE "Transcript" SET "processingMetadata" = $2::jsonb WHERE "id" = $1`,
      [fixture.transcriptId, JSON.stringify(buildInitialMetadata(burstWriters, true))],
    );

    const burstStarted = Date.now();
    await Promise.all(
      Array.from({ length: burstWriters }, async (_item, index) => {
        const chunkId = `c${index}`;
        try {
          const timing = await lockedMergeWrite({
            pool,
            transcriptId: fixture.transcriptId,
            patchBuilder: (latest) =>
              completeChunkPatch(latest, chunkId, `enhanced-${chunkId}`),
          });
          checkpointMs.push(timing.elapsedMs);
          lockWaitMs.push(timing.lockWaitMs);
        } catch (error) {
          const kind = classifyDbError(error);
          if (kind === "deadlock") deadlocks += 1;
          else if (kind === "serialization") serializationFailures += 1;
          else throw error;
        }
      }),
    );
    const wallClockOverheadMs = Date.now() - burstStarted;

    const mappingTiming = await lockedMergeWrite({
      pool,
      transcriptId: fixture.transcriptId,
      patchBuilder: (latest) =>
        mergeProcessingMetadata(latest, {
          mappingSuggestion: { reason: "mapping-during-enhancement", isApplied: true, version: 1 },
        }),
    });
    checkpointMs.push(mappingTiming.elapsedMs);
    lockWaitMs.push(mappingTiming.lockWaitMs);

    await Promise.all([
      lockedMergeWrite({
        pool,
        transcriptId: fixture.transcriptId,
        patchBuilder: (latest) =>
          mergeProcessingMetadata(latest, {
            mappingSuggestion: { reason: "concurrent-mapping", isApplied: true, version: 2 },
          }),
      }),
      lockedMergeWrite({
        pool,
        transcriptId: fixture.transcriptId,
        patchBuilder: (latest) => {
          const job = asJob(latest);
          const firstPending =
            Object.values(job.chunks).find((chunk) => chunk.status !== "COMPLETED") ??
            Object.values(job.chunks)[0];
          return completeChunkPatch(latest, firstPending.chunkId, "two-writer-chunk");
        },
      }),
    ]);

    const afterBurst = await setup.query(
      `SELECT "processingMetadata" FROM "Transcript" WHERE "id" = $1`,
      [fixture.transcriptId],
    );
    const afterBurstMeta = asProcessingMetadata(afterBurst.rows[0]?.processingMetadata);
    const afterJob = asJob(afterBurstMeta);
    for (let i = 0; i < burstWriters; i += 1) {
      if (afterJob.chunks[`c${i}`]?.status !== "COMPLETED") {
        lostChunks.push(`c${i}`);
      }
    }
    lostMapping = asProcessingMetadata(afterBurstMeta.mappingSuggestion).reason == null;
    lostSibling = asProcessingMetadata(afterBurstMeta.pauseProcessing).mode !== "source_audio_cut";

    const staleId = `stale-${randomUUID()}`;
    const staleFixture = await createFixture(setup, "BUG02 D1 stale snapshot");
    await setup.query(
      `UPDATE "Transcript" SET "processingMetadata" = $2::jsonb WHERE "id" = $1`,
      [staleFixture.transcriptId, JSON.stringify(buildInitialMetadata(2, false))],
    );
    const staleRead = await setup.query(
      `SELECT "processingMetadata" FROM "Transcript" WHERE "id" = $1`,
      [staleFixture.transcriptId],
    );
    const staleSnapshot = asProcessingMetadata(staleRead.rows[0]?.processingMetadata);
    await lockedMergeWrite({
      pool,
      transcriptId: staleFixture.transcriptId,
      patchBuilder: (latest) => completeChunkPatch(latest, "c0", "first"),
    });
    const staleOverwrite = {
      ...staleSnapshot,
      transcriptEnhancement: completeChunkPatch(staleSnapshot, "c1", "second").transcriptEnhancement,
    };
    await setup.query(
      `UPDATE "Transcript" SET "processingMetadata" = $2::jsonb WHERE "id" = $1`,
      [staleFixture.transcriptId, JSON.stringify(staleOverwrite)],
    );
    const staleAfter = await setup.query(
      `SELECT "processingMetadata" FROM "Transcript" WHERE "id" = $1`,
      [staleFixture.transcriptId],
    );
    const staleJob = asJob(staleAfter.rows[0]?.processingMetadata);
    staleSnapshotLostChunk = staleJob.chunks.c0?.status !== "COMPLETED";
    await destroyFixture(setup, staleFixture);
    void staleId;

    const interruptFixture = await createFixture(setup, "BUG02 D1 interrupted write");
    const interruptClient = await pool.connect();
    try {
      await interruptClient.query("BEGIN");
      await interruptClient.query(`SELECT "id" FROM "Transcript" WHERE "id" = $1 FOR UPDATE`, [
        interruptFixture.transcriptId,
      ]);
      await interruptClient.query(
        `UPDATE "Transcript" SET "processingMetadata" = $2::jsonb WHERE "id" = $1`,
        [
          interruptFixture.transcriptId,
          JSON.stringify({ broken: true, transcriptEnhancement: { not: "json-job" } }),
        ],
      );
      await interruptClient.query("ROLLBACK");
    } finally {
      interruptClient.release();
    }
    const interruptRead = await setup.query(
      `SELECT "processingMetadata" FROM "Transcript" WHERE "id" = $1`,
      [interruptFixture.transcriptId],
    );
    try {
      const interruptMeta = asProcessingMetadata(interruptRead.rows[0]?.processingMetadata);
      const interruptJob = asJob(interruptMeta);
      interruptedReadable =
        interruptJob.executionStatus === "RUNNING" &&
        typeof interruptJob.runId === "string" &&
        interruptMeta.broken !== true;
    } catch {
      interruptedReadable = false;
    }
    await destroyFixture(setup, interruptFixture);

    const xlJob = buildInitialMetadata(xlChunkCount, true);
    const xlEnhancement = asJob(xlJob);
    for (const chunk of Object.values(xlEnhancement.chunks)) {
      chunk.status = "COMPLETED";
      chunk.unpublishedTexts = {
        [String(chunk.targetIndexes[0])]: `xl-enhanced-text-${chunk.chunkId}-${"x".repeat(80)}`,
      };
    }
    xlEnhancement.progress.completedChunks = xlChunkCount;
    xlEnhancement.progress.pendingChunks = 0;
    const xlJsonBytes = Buffer.byteLength(JSON.stringify(xlJob), "utf8");
    const xlUnpublishedMapBytes = Buffer.byteLength(
      JSON.stringify(
        Object.fromEntries(
          Object.values(xlEnhancement.chunks).map((chunk) => [
            chunk.targetIndexes[0],
            chunk.unpublishedTexts?.[String(chunk.targetIndexes[0])] ?? "",
          ]),
        ),
      ),
      "utf8",
    );

    const checkpoint = summarizePercentiles(checkpointMs);
    const lockWait = summarizePercentiles(lockWaitMs);
    const rejectReasons: string[] = [];
    if (lostChunks.length > 0) rejectReasons.push("lost_enhancement_chunk");
    if (lostMapping) rejectReasons.push("lost_mapping_namespace");
    if (lostSibling) rejectReasons.push("lost_sibling_namespace");
    if (!interruptedReadable) rejectReasons.push("interrupted_unreadable");
    if (deadlocks > 0) rejectReasons.push("deadlock");
    if (serializationFailures > 2) rejectReasons.push("serialization_retry_loop");
    if ((checkpoint.p95 ?? 0) > 1500) rejectReasons.push("checkpoint_p95_dominates");
    if (xlJsonBytes > 1_500_000) rejectReasons.push("xl_json_too_large");

    return {
      checkpointWrites: checkpointMs.length,
      checkpointMs,
      checkpoint,
      lockWaitMs,
      lockWait,
      serializationFailures,
      deadlocks,
      lostChunks,
      lostMapping,
      lostSibling,
      staleSnapshotLostChunk,
      interruptedReadable,
      xlJsonBytes,
      xlUnpublishedMapBytes,
      concurrentWriters: burstWriters,
      wallClockOverheadMs,
      persistenceDominatesProvider: (checkpoint.p95 ?? 0) > 1500,
      decision: rejectReasons.length === 0 ? "D1_PASS" : "D1_REJECT",
      rejectReasons,
    };
  } finally {
    await destroyFixture(setup, fixture);
    await endPgTestResources([setup, pool]);
  }
}
