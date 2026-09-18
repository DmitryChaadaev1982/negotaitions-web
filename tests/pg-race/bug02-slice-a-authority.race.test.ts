import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  AiAnalysisStatus,
  PrismaClient,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { claimAiAnalysisRunWithTranscriptAuthority } from "@/lib/ai/analysis-transcript-admission";
import {
  getTranscriptEnhancementOutputMode,
  getYandexTranscriptEnhancementModel,
} from "@/lib/env";
import {
  buildTranscriptEnhancementInputIdentity,
  executeTranscriptEnhancement,
} from "@/lib/services/transcript-enhancement-orchestration";
import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import { runTranscriptEnhancementRecoveryTick } from "@/lib/services/transcript-enhancement-recovery";
import {
  checkpointEnhancementChunk,
  continueWithCurrentTranscript,
  publishEnhancementIfEligible,
} from "@/lib/services/transcript-enhancement-state";
import { applyOwnedTranscriptionUpdate } from "@/lib/services/transcription-generation-cas";
import { persistMappingOwnedTranscriptUpdate } from "@/lib/transcription/mapping-persistence";
import {
  clearTranscriptLockHoldForTests,
  setTranscriptLockHoldForTests,
} from "@/lib/transcription/transcript-row-lock";
import {
  createCoordinationBarrier,
  createPgTestClient,
  endPgTestResources,
} from "@/lib/test-helpers/pg-coordination";
import { requirePgDatabase } from "@/lib/test-helpers/pg-test-gate";
import {
  assertIsolatedE2eDatabase,
  isE2eDatabaseConfigured,
} from "../e2e/helpers/e2e-database";
import { createE2ePrisma } from "./e2e-prisma";

const SKIP_REASON = "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const noopEnhance = (async () => ({
  segments: [],
  globalWarnings: [],
  meta: { overallStatus: "COMPLETED" as const },
})) as never;

async function runOrderedRace<T, U>(params: {
  first: () => Promise<T>;
  second: () => Promise<U>;
}): Promise<{ first: T; second: U }> {
  const barrier = createCoordinationBarrier({
    timeoutMs: 15_000,
    label: "bug02-slice-a",
  });
  setTranscriptLockHoldForTests(() => barrier.wait());
  try {
    const firstPromise = params.first();
    await barrier.arrived;
    const secondPromise = params.second();
    await delay(80);
    barrier.release();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    return { first, second };
  } finally {
    clearTranscriptLockHoldForTests();
    barrier.release();
  }
}

type JobSeed = {
  executionStatus: string;
  publicationEligible: boolean;
  runId: string;
  leaseToken: string;
  chunks: Record<string, unknown>;
  unpublishedByOrderIndex?: Record<string, string>;
  cancelReason?: string | null;
  retranscribeCount?: number;
};

function runningChunk(index: number, status: string, text?: string) {
  return {
    chunkIndex: index,
    status,
    targetIndexes: [index],
    attemptCount: 1,
    unpublishedByOrderIndex: status === "COMPLETED" && text ? { [String(index)]: text } : {},
    lastErrorClass: status === "FAILED" ? "non_retryable" : null,
    lastHttpClass: null,
    lastSchemaResult: status === "COMPLETED" ? "valid" : null,
    providerDurationMs: null,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageTotalTokens: null,
    usageClassification: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt:
      status === "COMPLETED" || status === "FAILED" ? "2026-01-01T00:00:10.000Z" : null,
  };
}

function enhancementMetadata(job: JobSeed) {
  const chunks = job.chunks;
  const values = Object.values(chunks) as Array<{ status?: string }>;
  const progress = {
    totalChunks: values.length,
    completedChunks: values.filter((item) => item.status === "COMPLETED").length,
    runningChunks: values.filter((item) => item.status === "RUNNING").length,
    pendingChunks: values.filter((item) => item.status === "PENDING").length,
    retryableFailedChunks: values.filter((item) => item.status === "RETRYABLE_FAILED").length,
    permanentFailedChunks: values.filter((item) => item.status === "FAILED").length,
  };
  return {
    transcriptionProvider: "yandex_speechkit",
    mappingSuggestion: { reason: "seed", keep: true },
    historicalCustom: { keep: true },
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      jobId: job.runId,
      runId: job.runId,
      leaseToken: job.leaseToken,
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      executionStatus: job.executionStatus,
      publicationEligible: job.publicationEligible,
      terminalQuality: null,
      inputIdentity: "seed-identity",
      retranscribeCount: job.retranscribeCount ?? 0,
      triggerSource: "manual",
      cancelReason: job.cancelReason ?? null,
      cancelledAt: null,
      publicationOutcome: null,
      progress,
      chunks,
      unpublishedByOrderIndex: job.unpublishedByOrderIndex ?? {},
      queuedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
      safetyDeadlineAt: new Date(Date.now() + 300_000).toISOString(),
      skipReason: null,
      status: job.executionStatus === "RUNNING" ? "RUNNING" : job.executionStatus,
    },
  };
}

function expectedInputIdentity(params: { transcriptId: string; originalText: string }) {
  const rawSegmentsHash = createHash("sha256")
    .update(`0:${params.originalText.trim()}`, "utf8")
    .digest("hex");
  return buildTranscriptEnhancementInputIdentity({
    transcriptId: params.transcriptId,
    rawSegmentsHash,
    model: getYandexTranscriptEnhancementModel(),
    outputMode: getTranscriptEnhancementOutputMode(),
    schemaVersion: "v1",
    promptVersion: "stage-3.9f-auto-enhancement-v1",
  });
}

async function createFixture(
  client: ReturnType<typeof createPgTestClient>,
  options?: {
    status?: TranscriptStatus;
    text?: string;
    qualityText?: string;
    retranscribeCount?: number;
    metadata?: Record<string, unknown>;
    startedAt?: Date;
  },
) {
  const userId = randomUUID();
  const caseId = randomUUID();
  const sessionId = randomUUID();
  const transcriptId = randomUUID();
  const participantId = randomUUID();
  const segmentId = randomUUID();
  const startedAt = options?.startedAt ?? new Date("2026-01-01T00:00:00.000Z");
  const text = options?.text ?? "raw lexical";
  const qualityText = options?.qualityText ?? text;
  const metadata = options?.metadata ?? {
    transcriptionProvider: "yandex_speechkit",
    mappingSuggestion: { reason: "seed" },
    historicalCustom: { keep: true },
  };
  await client.query(
    `INSERT INTO "User"
       ("id", "email", "passwordHash", "name", "globalRole", "status", "preferredLocale", "updatedAt")
     VALUES ($1, $2, 'slice-a-hash', 'BUG02 Slice A', 'USER', 'ACTIVE', 'ru', NOW())`,
    [userId, `bug02-slice-a-${userId}@test.negotaitions.local`],
  );
  await client.query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, $2, 'slice-a', 'slice-a', 'slice-a', 'slice-a', 'EASY', 'RU',
             60, 60, $3, $3, 'PRIVATE', NOW())`,
    [caseId, `BUG02 Slice A ${sessionId.slice(0, 8)}`, userId],
  );
  await client.query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "negotiationState", "updatedAt")
     VALUES ($1, $2, $3, $4, $4, 'slice-a', 'slice-a', 'RU', 'FINISHED', NOW())`,
    [sessionId, caseId, userId, `BUG02 Slice A ${sessionId.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "type", "joinToken", "displayName", "updatedAt")
     VALUES ($1, $2, 'PARTICIPANT', $1, 'Buyer', NOW())`,
    [participantId, sessionId],
  );
  await client.query(
    `INSERT INTO "Transcript"
       ("id", "sessionId", "source", "status", "text", "diarizedText", "hasSpeakerDiarization",
        "speakerMapping", "speakerMappingStatus", "retranscribeCount", "processingMetadata",
        "startedAt", "updatedAt")
     VALUES ($1, $2, 'GENERATED', $3, $4, $5, true, $6::jsonb, 'CONFIRMED', $7, $8::jsonb, $9, NOW())`,
    [
      transcriptId,
      sessionId,
      options?.status ?? TranscriptStatus.COMPLETED,
      text,
      `speaker_1: ${text}`,
      JSON.stringify({ speaker_1: participantId }),
      options?.retranscribeCount ?? 0,
      JSON.stringify(metadata),
      startedAt,
    ],
  );
  await client.query(
    `INSERT INTO "TranscriptSegment"
       ("id", "transcriptId", "speakerLabel", "mappedParticipantId", "startSeconds", "endSeconds",
        "text", "qualityText", "orderIndex", "updatedAt")
     VALUES ($1, $2, 'speaker_1', $3, 0, 1, $4, $5, 0, NOW())`,
    [segmentId, transcriptId, participantId, text, qualityText],
  );
  const startedAtRows = await client.query<{ startedAt: Date }>(
    `SELECT "startedAt" FROM "Transcript" WHERE "id" = $1`,
    [transcriptId],
  );
  return {
    userId,
    caseId,
    sessionId,
    transcriptId,
    participantId,
    segmentId,
    startedAt: startedAtRows.rows[0]?.startedAt ?? startedAt,
  };
}

async function destroyFixture(
  client: ReturnType<typeof createPgTestClient>,
  fixture: { sessionId: string; caseId: string; userId: string },
) {
  await client.query(`DELETE FROM "Session" WHERE "id" = $1`, [fixture.sessionId]);
  await client.query(`DELETE FROM "NegotiationCase" WHERE "id" = $1`, [fixture.caseId]);
  await client.query(`DELETE FROM "User" WHERE "id" = $1`, [fixture.userId]);
}

function enableEnhancementEnv() {
  process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "true";
  process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "true";
}

async function withE2eHarness(
  t: { skip: (reason: string) => void },
  run: (params: {
    prisma: PrismaClient;
    url: string;
    setup: ReturnType<typeof createPgTestClient>;
  }) => Promise<void>,
) {
  if (!requirePgDatabase(t, {
    databaseReady: isE2eDatabaseConfigured(),
    unavailableReason: SKIP_REASON,
  })) {
    return;
  }
  enableEnhancementEnv();
  const url = assertIsolatedE2eDatabase();
  const setup = createPgTestClient(url);
  const { prisma, pool } = createE2ePrisma(url);
  await setup.connect();
  try {
    await run({ prisma, url, setup });
  } finally {
    await endPgTestResources([prisma, pool, setup]);
  }
}

test("PG-RACE-01 mapping vs chunk checkpoint both survive", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const runId = randomUUID();
    const leaseToken = randomUUID();
    const fixture = await createFixture(setup, {
      metadata: enhancementMetadata({
        executionStatus: "RUNNING",
        publicationEligible: true,
        runId,
        leaseToken,
        chunks: {
          "0": runningChunk(0, "PENDING"),
          "1": runningChunk(1, "PENDING"),
        },
      }),
    });
    try {
      const mapping = () =>
        prisma.$transaction((tx) =>
          persistMappingOwnedTranscriptUpdate({
            tx,
            transcriptId: fixture.transcriptId,
            patch: {
              speakerMapping: { speaker_1: fixture.participantId },
              mappingSuggestion: { reason: "race-mapping", keep: true },
            },
            rebuildDiarizedText: true,
            participants: [
              {
                id: fixture.participantId,
                displayName: "Buyer",
                type: "PARTICIPANT",
                roleName: "Buyer",
              },
            ],
          }),
        );
      const checkpoint = () =>
        checkpointEnhancementChunk({
          db: prisma,
          transcriptId: fixture.transcriptId,
          owner: {
            runId,
            leaseToken,
            inputIdentity: "seed-identity",
            retranscribeCount: 0,
          },
          chunk: runningChunk(0, "COMPLETED", "checkpoint-kept") as never,
        });
      await runOrderedRace({ first: mapping, second: checkpoint });
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
      });
      const job = parseTranscriptEnhancementJob(latest.processingMetadata);
      const mappingNs = (latest.processingMetadata as { mappingSuggestion?: { reason?: string } })
        .mappingSuggestion;
      assert.equal(mappingNs?.reason, "race-mapping");
      assert.equal(job.chunks["0"]?.status, "COMPLETED");
      assert.equal(job.publicationEligible, true);
      assert.equal(
        (latest.processingMetadata as { historicalCustom?: { keep?: boolean } }).historicalCustom
          ?.keep,
        true,
      );
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("PG-RACE-02 mapping vs Skip cannot revive eligibility", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const runId = randomUUID();
    const leaseToken = randomUUID();
    const fixture = await createFixture(setup, {
      metadata: enhancementMetadata({
        executionStatus: "RUNNING",
        publicationEligible: true,
        runId,
        leaseToken,
        chunks: { "0": runningChunk(0, "COMPLETED", "enhanced-0") },
        unpublishedByOrderIndex: { "0": "enhanced-0" },
      }),
    });
    try {
      await runOrderedRace({
        first: () =>
          prisma.$transaction((tx) =>
            persistMappingOwnedTranscriptUpdate({
              tx,
              transcriptId: fixture.transcriptId,
              patch: {
                speakerMapping: { speaker_1: fixture.participantId },
                mappingSuggestion: { reason: "race-skip-mapping" },
              },
              rebuildDiarizedText: true,
            }),
          ),
        second: () =>
          continueWithCurrentTranscript({
            db: prisma,
            transcriptId: fixture.transcriptId,
          }),
      });
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
      });
      const job = parseTranscriptEnhancementJob(latest.processingMetadata);
      assert.equal(job.executionStatus, "CANCELLED_FOR_PUBLICATION");
      assert.equal(job.publicationEligible, false);
      assert.equal(
        (latest.processingMetadata as { mappingSuggestion?: { reason?: string } }).mappingSuggestion
          ?.reason,
        "race-skip-mapping",
      );
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("PG-RACE-03 mapping vs publication keeps diarizedText current in both orderings", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function raceOrdering(mappingFirst: boolean) {
      const runId = randomUUID();
      const leaseToken = randomUUID();
      const fixture = await createFixture(setup, {
        text: "raw lexical",
        qualityText: "raw lexical",
        metadata: enhancementMetadata({
          executionStatus: "RUNNING",
          publicationEligible: true,
          runId,
          leaseToken,
          chunks: { "0": runningChunk(0, "COMPLETED", "published lexical") },
          unpublishedByOrderIndex: { "0": "published lexical" },
        }),
      });
      try {
        const mapping = () =>
          prisma.$transaction((tx) =>
            persistMappingOwnedTranscriptUpdate({
              tx,
              transcriptId: fixture.transcriptId,
              patch: { speakerMapping: { speaker_1: fixture.participantId } },
              rebuildDiarizedText: true,
              participants: [
                {
                  id: fixture.participantId,
                  displayName: "Buyer",
                  type: "PARTICIPANT",
                  roleName: "Buyer",
                },
              ],
            }),
          );
        const publish = () =>
          publishEnhancementIfEligible({
            db: prisma,
            transcriptId: fixture.transcriptId,
            owner: {
              runId,
              leaseToken,
              inputIdentity: "seed-identity",
              retranscribeCount: 0,
            },
          });
        if (mappingFirst) {
          await runOrderedRace({ first: mapping, second: publish });
        } else {
          await runOrderedRace({ first: publish, second: mapping });
        }
        const latest = await prisma.transcript.findUniqueOrThrow({
          where: { id: fixture.transcriptId },
          include: { segments: true },
        });
        const job = parseTranscriptEnhancementJob(latest.processingMetadata);
        assert.equal(latest.segments[0]?.text, "published lexical");
        assert.equal(latest.segments[0]?.qualityText, "raw lexical");
        assert.equal(job.executionStatus, "COMPLETED");
        assert.match(latest.diarizedText ?? "", /published lexical/);
        assert.match(latest.diarizedText ?? "", /Buyer/);
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await raceOrdering(true);
    await raceOrdering(false);
  });
});

test("PG-RACE-04 retranscription completion vs enhancement admission never binds stale input", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const fixture = await createFixture(setup, {
      status: TranscriptStatus.TRANSCRIBING,
      text: "OLD_GENERATION",
      qualityText: "OLD_GENERATION",
      retranscribeCount: 1,
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const generationRow = await prisma.transcript.findUniqueOrThrow({
      where: { id: fixture.transcriptId },
      select: { startedAt: true, retranscribeCount: true, status: true },
    });
    assert.equal(generationRow.status, TranscriptStatus.TRANSCRIBING);
    assert.ok(generationRow.startedAt);
    try {
      const complete = () =>
        prisma.$transaction(async (tx) => {
          const applied = await applyOwnedTranscriptionUpdate({
            tx,
            generation: {
              transcriptId: fixture.transcriptId,
              startedAt: generationRow.startedAt as Date,
              retranscribeCount: generationRow.retranscribeCount,
            },
            data: {
              status: TranscriptStatus.COMPLETED,
              text: "NEW_GENERATION",
            },
          });
          if (applied === "applied") {
            await tx.transcriptSegment.update({
              where: { id: fixture.segmentId },
              data: { text: "NEW_GENERATION", qualityText: "NEW_GENERATION" },
            });
          }
          return applied;
        });
      const admit = () =>
        executeTranscriptEnhancement({
          transcriptId: fixture.transcriptId,
          triggerSource: "manual",
          runInBackground: true,
          dependencies: {
            db: prisma,
            schedule: () => {},
            enhance: noopEnhance,
          },
        });
      const { first: applied } = await runOrderedRace({ first: complete, second: admit });
      assert.equal(applied, "applied");
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      const job = parseTranscriptEnhancementJob(latest.processingMetadata);
      assert.equal(latest.status, TranscriptStatus.COMPLETED);
      assert.equal(latest.segments[0]?.text, "NEW_GENERATION");
      const oldIdentity = expectedInputIdentity({
        transcriptId: fixture.transcriptId,
        originalText: "OLD_GENERATION",
      });
      const newIdentity = expectedInputIdentity({
        transcriptId: fixture.transcriptId,
        originalText: "NEW_GENERATION",
      });
      if (job.runId) {
        assert.equal(job.retranscribeCount, 1);
        assert.notEqual(job.inputIdentity, oldIdentity);
        assert.equal(job.inputIdentity, newIdentity);
      } else {
        assert.notEqual(job.executionStatus, "QUEUED");
        assert.notEqual(job.executionStatus, "RUNNING");
      }
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("PG-RACE-05 Start AI vs Start Improve admits exactly one provider claim", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function race(aiFirst: boolean) {
      const fixture = await createFixture(setup);
      try {
        let enhancementScheduled = 0;
        const improve = () =>
          executeTranscriptEnhancement({
            transcriptId: fixture.transcriptId,
            triggerSource: "manual",
            runInBackground: true,
            dependencies: {
              db: prisma,
              schedule: () => {
                enhancementScheduled += 1;
              },
              enhance: noopEnhance,
            },
          });
        const startAi = () =>
          claimAiAnalysisRunWithTranscriptAuthority({
            sessionId: fixture.sessionId,
            transcriptId: fixture.transcriptId,
            transcriptRetranscribeCount: 0,
            language: "ru",
            client: prisma,
          });
        if (aiFirst) {
          const { first, second } = await runOrderedRace({ first: startAi, second: improve });
          assert.equal(first.state, "claimed");
          assert.equal(second.outcome, "conflict");
          if (second.outcome === "conflict") {
            assert.equal(second.reason, "skipped_ai_in_progress");
          }
          assert.equal(enhancementScheduled, 0);
        } else {
          const { first, second } = await runOrderedRace({ first: improve, second: startAi });
          assert.equal(first.outcome, "started");
          assert.equal(second.state, "enhancement_in_flight");
          assert.equal(enhancementScheduled, 1);
        }
        const analysis = await prisma.aiAnalysis.findUnique({
          where: { sessionId: fixture.sessionId },
        });
        const job = parseTranscriptEnhancementJob(
          (
            await prisma.transcript.findUniqueOrThrow({
              where: { id: fixture.transcriptId },
            })
          ).processingMetadata,
        );
        const aiLive = analysis?.status === AiAnalysisStatus.QUEUED;
        const enhancementLive = job.publicationEligible === true;
        assert.equal(aiLive && enhancementLive, false);
        assert.equal(aiLive || enhancementLive, true);
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(false);
    await race(true);
  });
});

test("PG-RACE-06 Skip vs final publication has exactly two valid outcomes", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function race(skipFirst: boolean) {
      const runId = randomUUID();
      const leaseToken = randomUUID();
      const fixture = await createFixture(setup, {
        metadata: enhancementMetadata({
          executionStatus: "RUNNING",
          publicationEligible: true,
          runId,
          leaseToken,
          chunks: { "0": runningChunk(0, "COMPLETED", "published lexical") },
          unpublishedByOrderIndex: { "0": "published lexical" },
        }),
      });
      try {
        const skip = () =>
          continueWithCurrentTranscript({
            db: prisma,
            transcriptId: fixture.transcriptId,
          });
        const publish = () =>
          publishEnhancementIfEligible({
            db: prisma,
            transcriptId: fixture.transcriptId,
            owner: {
              runId,
              leaseToken,
              inputIdentity: "seed-identity",
              retranscribeCount: 0,
            },
          });
        if (skipFirst) {
          await runOrderedRace({ first: skip, second: publish });
        } else {
          await runOrderedRace({ first: publish, second: skip });
        }
        const latest = await prisma.transcript.findUniqueOrThrow({
          where: { id: fixture.transcriptId },
          include: { segments: true },
        });
        const job = parseTranscriptEnhancementJob(latest.processingMetadata);
        const cancelled =
          job.executionStatus === "CANCELLED_FOR_PUBLICATION" &&
          latest.text === "raw lexical" &&
          latest.segments[0]?.text === "raw lexical";
        const published =
          job.executionStatus === "COMPLETED" &&
          job.terminalQuality === "COMPLETED" &&
          latest.text === "published lexical";
        assert.equal(cancelled || published, true);
        assert.equal(cancelled && published, false);
        if (skipFirst) {
          assert.equal(cancelled, true);
        } else {
          assert.equal(published, true);
        }
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(true);
    await race(false);
  });
});

test("PG-RACE-07 abandoned RUNNING+ineligible reconciles so Repeat Improve can admit", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const runId = randomUUID();
    const leaseToken = randomUUID();
    const fixture = await createFixture(setup, {
      metadata: enhancementMetadata({
        executionStatus: "RUNNING",
        publicationEligible: false,
        runId,
        leaseToken,
        cancelReason: "permanent_chunk_failure",
        chunks: {
          "0": runningChunk(0, "COMPLETED", "enhanced-0"),
          "1": runningChunk(1, "FAILED"),
          "2": runningChunk(2, "PENDING"),
        },
      }),
    });
    try {
      const recovered = await runTranscriptEnhancementRecoveryTick({
        db: prisma,
        transcriptIds: [fixture.transcriptId],
        resume: false,
      });
      assert.equal(recovered.reconciledIllegal, 1);
      const after = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
      });
      const job = parseTranscriptEnhancementJob(after.processingMetadata);
      assert.notEqual(job.executionStatus, "RUNNING");
      assert.notEqual(job.executionStatus, "QUEUED");
      assert.equal(job.publicationEligible, false);
      assert.equal(job.terminalQuality === "PARTIAL" || job.terminalQuality === "FAILED", true);
      const admitted = await executeTranscriptEnhancement({
        transcriptId: fixture.transcriptId,
        triggerSource: "manual_reenhancement",
        forceReenhancement: true,
        runInBackground: true,
        dependencies: {
          db: prisma,
          schedule: () => {},
          enhance: noopEnhance,
        },
      });
      assert.equal(admitted.outcome, "started");
      const next = parseTranscriptEnhancementJob(
        (
          await prisma.transcript.findUniqueOrThrow({
            where: { id: fixture.transcriptId },
          })
        ).processingMetadata,
      );
      assert.notEqual(next.runId, runId);
      assert.equal(next.publicationEligible, true);
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});
