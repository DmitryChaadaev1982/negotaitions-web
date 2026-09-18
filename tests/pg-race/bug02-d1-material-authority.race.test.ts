import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  PrismaClient,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import {
  admitAiAnalysisMaterial,
  type AdmitAiAnalysisMaterialResult,
} from "@/lib/ai/analysis-transcript-admission";
import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import {
  computeCurrentMaterialInputFingerprint,
  fingerprintSessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import {
  executeTranscriptEnhancement,
} from "@/lib/services/transcript-enhancement-orchestration";
import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import {
  continueWithCurrentTranscript,
  markEnhancementExecutionFailed,
  publishEnhancementIfEligible,
  checkpointEnhancementChunk,
} from "@/lib/services/transcript-enhancement-state";
import {
  digestPublishedSegmentText,
  parseTranscriptEnhancementPublication,
} from "@/lib/services/transcript-enhancement-publication";
import { resolveSegmentEnhancementProvenance } from "@/lib/post-processing/enhancement-ux-presentation";
import { applyOwnedTranscriptionUpdate } from "@/lib/services/transcription-generation-cas";
import {
  persistMappingOwnedTranscriptUpdate,
  type MappingPersistResult,
} from "@/lib/transcription/mapping-persistence";
import {
  clearTranscriptLockHoldForTests,
  lockTranscriptRowForUpdate,
  setTranscriptLockHoldForTests,
} from "@/lib/transcription/transcript-row-lock";
import {
  createCoordinationBarrier,
  createPgTestClient,
  endPgTestResources,
} from "@/lib/test-helpers/pg-coordination";
import {
  requirePgDatabase,
  type PgGateTestContext,
} from "@/lib/test-helpers/pg-test-gate";
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

function isClaimedAdmission(
  value: unknown,
): value is Extract<AdmitAiAnalysisMaterialResult, { state: "claimed" }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    (value as { state: string }).state === "claimed"
  );
}

function isMappingPersistResult(value: unknown): value is MappingPersistResult {
  return typeof value === "object" && value !== null && "ok" in value;
}

async function runOrderedRace<T, U>(params: {
  first: () => Promise<T>;
  second: () => Promise<U>;
}): Promise<{ first: T; second: U }> {
  const barrier = createCoordinationBarrier({
    timeoutMs: 15_000,
    label: "bug02-d1",
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

function completedPublicationMetadata(params: {
  runId: string;
  leaseToken: string;
  text: string;
  originalText: string;
}) {
  return {
    transcriptionProvider: "yandex_speechkit",
    mappingSuggestion: { reason: "seed", keep: true },
    historicalCustom: { keep: true },
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      jobId: params.runId,
      runId: params.runId,
      leaseToken: params.leaseToken,
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      inputIdentity: "seed-identity",
      retranscribeCount: 0,
      triggerSource: "manual",
      cancelReason: null,
      cancelledAt: null,
      publicationOutcome: "published",
      progress: {
        totalChunks: 1,
        completedChunks: 1,
        runningChunks: 0,
        pendingChunks: 0,
        retryableFailedChunks: 0,
        permanentFailedChunks: 0,
      },
      chunks: {
        "0": {
          chunkIndex: 0,
          status: "COMPLETED",
          targetIndexes: [0],
          attemptCount: 1,
          unpublishedByOrderIndex: {},
        },
      },
      unpublishedByOrderIndex: {},
      queuedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:10.000Z",
      safetyDeadlineAt: null,
      skipReason: null,
      status: "COMPLETED",
    },
    transcriptEnhancementPublication: {
      runId: params.runId,
      retranscribeCount: 0,
      inputIdentity: "seed-identity",
      publishedAt: "2026-01-01T00:00:10.000Z",
      segmentDigestByOrderIndex: {
        "0": digestPublishedSegmentText(params.text),
      },
    },
  };
}

async function createFixture(
  client: ReturnType<typeof createPgTestClient>,
  options?: {
    status?: TranscriptStatus;
    text?: string;
    qualityText?: string;
    retranscribeCount?: number;
    speakerMappingStatus?: string;
    metadata?: Record<string, unknown>;
    startedAt?: Date;
    extraParticipant?: boolean;
  },
) {
  const userId = randomUUID();
  const caseId = randomUUID();
  const sessionId = randomUUID();
  const transcriptId = randomUUID();
  const participantId = randomUUID();
  const sellerId = randomUUID();
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
     VALUES ($1, $2, 'd1-hash', 'BUG02 D1', 'USER', 'ACTIVE', 'ru', NOW())`,
    [userId, `bug02-d1-${userId}@test.negotaitions.local`],
  );
  await client.query(
    `INSERT INTO "NegotiationCase"
       ("id", "title", "description", "businessContext", "publicInstructions",
        "targetSkills", "difficulty", "caseLanguage",
        "defaultPreparationDurationSeconds", "defaultDurationSeconds",
        "facilitatorId", "createdByUserId", "visibility", "updatedAt")
     VALUES ($1, $2, 'd1', 'd1', 'd1', 'd1', 'EASY', 'RU',
             60, 60, $3, $3, 'PRIVATE', NOW())`,
    [caseId, `BUG02 D1 ${sessionId.slice(0, 8)}`, userId],
  );
  await client.query(
    `INSERT INTO "Session"
       ("id", "negotiationCaseId", "facilitatorId", "title", "snapshotCaseTitle",
        "snapshotBusinessContext", "snapshotPublicInstructions", "snapshotCaseLanguage",
        "negotiationState", "updatedAt")
     VALUES ($1, $2, $3, $4, $4, 'd1', 'd1', 'RU', 'FINISHED', NOW())`,
    [sessionId, caseId, userId, `BUG02 D1 ${sessionId.slice(0, 8)}`],
  );
  await client.query(
    `INSERT INTO "SessionParticipant"
       ("id", "sessionId", "type", "joinToken", "displayName", "updatedAt")
     VALUES ($1, $2, 'PARTICIPANT', $1, 'Buyer', NOW())`,
    [participantId, sessionId],
  );
  if (options?.extraParticipant) {
    await client.query(
      `INSERT INTO "SessionParticipant"
         ("id", "sessionId", "type", "joinToken", "displayName", "updatedAt")
       VALUES ($1, $2, 'PARTICIPANT', $1, 'Seller', NOW())`,
      [sellerId, sessionId],
    );
  }
  await client.query(
    `INSERT INTO "Transcript"
       ("id", "sessionId", "source", "status", "text", "diarizedText", "hasSpeakerDiarization",
        "speakerMapping", "speakerMappingStatus", "retranscribeCount", "processingMetadata",
        "startedAt", "updatedAt")
     VALUES ($1, $2, 'GENERATED', $3, $4, $5, true, $6::jsonb, $7, $8, $9::jsonb, $10, NOW())`,
    [
      transcriptId,
      sessionId,
      options?.status ?? TranscriptStatus.COMPLETED,
      text,
      `speaker_1: ${text}`,
      JSON.stringify({ speaker_1: participantId }),
      options?.speakerMappingStatus ?? "CONFIRMED",
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
  return {
    userId,
    caseId,
    sessionId,
    transcriptId,
    participantId,
    sellerId,
    segmentId,
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
  t: PgGateTestContext,
  run: (params: {
    prisma: PrismaClient;
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
    await run({ prisma, setup });
  } finally {
    await endPgTestResources([prisma, pool, setup]);
  }
}

test("AI-AUTH-01 AI admission vs lexical save binds admitted material", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function race(aiFirst: boolean) {
      const fixture = await createFixture(setup);
      try {
        const startAi = () =>
          admitAiAnalysisMaterial({
            sessionId: fixture.sessionId,
            transcriptId: fixture.transcriptId,
            language: "ru",
            client: prisma,
          });
        const lexical = () =>
          prisma.$transaction(async (tx) => {
            await lockTranscriptRowForUpdate(tx, fixture.transcriptId);
            await tx.transcript.update({
              where: { id: fixture.transcriptId },
              data: { text: "NEW_LEXICAL" },
            });
            await tx.transcriptSegment.update({
              where: { id: fixture.segmentId },
              data: { text: "NEW_LEXICAL" },
            });
            return "updated" as const;
          });
        const ordered = aiFirst
          ? await runOrderedRace({ first: startAi, second: lexical })
          : await runOrderedRace({ first: lexical, second: startAi });
        const claimed = aiFirst ? ordered.first : ordered.second;
        const lexicalResult = aiFirst ? ordered.second : ordered.first;
        assert.equal(lexicalResult, "updated");
        if (typeof claimed === "object" && claimed.state === "claimed") {
          assert.equal(claimed.inputFingerprint, fingerprintSessionAnalysisContext(claimed.analysisContext));
          const stored = await prisma.aiAnalysis.findUniqueOrThrow({
            where: { sessionId: fixture.sessionId },
          });
          assert.equal(stored.inputFingerprint, claimed.inputFingerprint);
          assert.equal(stored.transcriptId, fixture.transcriptId);
          assert.equal(
            claimed.analysisContext.transcript?.text,
            aiFirst ? "raw lexical" : "NEW_LEXICAL",
          );
          const current = await prisma.transcript.findUniqueOrThrow({
            where: { id: fixture.transcriptId },
            include: { segments: true },
          });
          const currentFingerprint = await computeCurrentMaterialInputFingerprint(
            fixture.sessionId,
            prisma,
          );
          const currentness = evaluateAiAnalysisCurrentness({
            analysis: stored,
            currentFingerprint,
            transcriptId: current.id,
            transcriptRetranscribeCount: current.retranscribeCount,
          });
          if (aiFirst) {
            assert.equal(current.text, "NEW_LEXICAL");
            assert.equal(currentness.current, false);
          } else {
            assert.equal(claimed.analysisContext.transcript?.text, "NEW_LEXICAL");
            assert.equal(currentness.current, true);
          }
        } else {
          assert.fail(`expected claimed AI run, got ${JSON.stringify(claimed)}`);
        }
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(true);
    await race(false);
  });
});

test("AI-AUTH-02 AI admission vs mapping save binds admitted mapping", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function race(aiFirst: boolean) {
      const fixture = await createFixture(setup, { extraParticipant: true });
      try {
        const startAi = () =>
          admitAiAnalysisMaterial({
            sessionId: fixture.sessionId,
            transcriptId: fixture.transcriptId,
            language: "ru",
            client: prisma,
          });
        const mapping = () =>
          prisma.$transaction((tx) =>
            persistMappingOwnedTranscriptUpdate({
              tx,
              transcriptId: fixture.transcriptId,
              expectedTranscriptId: fixture.transcriptId,
              expectedRetranscribeCount: 0,
              requestedMapping: { speaker_1: fixture.sellerId },
              rebuildDiarizedText: true,
              participants: [
                {
                  id: fixture.participantId,
                  displayName: "Buyer",
                  type: "PARTICIPANT",
                  roleName: "Buyer",
                },
                {
                  id: fixture.sellerId,
                  displayName: "Seller",
                  type: "PARTICIPANT",
                  roleName: "Seller",
                },
              ],
            }),
          );
        const ordered = aiFirst
          ? await runOrderedRace({ first: startAi, second: mapping })
          : await runOrderedRace({ first: mapping, second: startAi });
        const claimed = aiFirst ? ordered.first : ordered.second;
        const mapped = aiFirst ? ordered.second : ordered.first;
        assert.equal(isMappingPersistResult(mapped) && mapped.ok, true);
        if (isClaimedAdmission(claimed)) {
          const admittedMapped =
            claimed.analysisContext.transcript?.segments[0]?.mappedParticipantId;
          assert.equal(
            admittedMapped,
            aiFirst ? fixture.participantId : fixture.sellerId,
          );
          assert.equal(claimed.inputFingerprint, fingerprintSessionAnalysisContext(claimed.analysisContext));
          const stored = await prisma.aiAnalysis.findUniqueOrThrow({
            where: { sessionId: fixture.sessionId },
          });
          assert.equal(stored.inputFingerprint, claimed.inputFingerprint);
        } else {
          assert.fail(`expected claimed AI run, got ${JSON.stringify(claimed)}`);
        }
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(true);
    await race(false);
  });
});

test("AI-AUTH-03 AI admission vs retranscription completion binds new generation or stales old claim", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function race(aiFirst: boolean) {
      const fixture = await createFixture(setup, {
        status: aiFirst ? TranscriptStatus.COMPLETED : TranscriptStatus.TRANSCRIBING,
        text: "OLD_GENERATION",
        qualityText: "OLD_GENERATION",
        retranscribeCount: 0,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      const generationRow = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        select: { startedAt: true, retranscribeCount: true, status: true },
      });
      try {
        const startAi = () =>
          admitAiAnalysisMaterial({
            sessionId: fixture.sessionId,
            transcriptId: fixture.transcriptId,
            language: "ru",
            client: prisma,
          });
        const complete = aiFirst
          ? () =>
              prisma.$transaction(async (tx) => {
                await lockTranscriptRowForUpdate(tx, fixture.transcriptId);
                await tx.transcript.update({
                  where: { id: fixture.transcriptId },
                  data: { retranscribeCount: 1, text: "NEW_GENERATION" },
                });
                await tx.transcriptSegment.update({
                  where: { id: fixture.segmentId },
                  data: { text: "NEW_GENERATION", qualityText: "NEW_GENERATION" },
                });
                return "applied" as const;
              })
          : () =>
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
                    retranscribeCount: 1,
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
        if (aiFirst) {
          const { first, second } = await runOrderedRace({ first: startAi, second: complete });
          assert.equal(first.state, "claimed");
          if (first.state !== "claimed") return;
          assert.equal(first.transcriptRetranscribeCount, 0);
          assert.equal(first.analysisContext.transcript?.text, "OLD_GENERATION");
          assert.equal(second, "applied");
          const stored = await prisma.aiAnalysis.findUniqueOrThrow({
            where: { sessionId: fixture.sessionId },
          });
          const latest = await prisma.transcript.findUniqueOrThrow({
            where: { id: fixture.transcriptId },
          });
          assert.equal(stored.inputFingerprint, first.inputFingerprint);
          const currentFingerprint = await computeCurrentMaterialInputFingerprint(
            fixture.sessionId,
            prisma,
          );
          assert.equal(
            evaluateAiAnalysisCurrentness({
              analysis: stored,
              currentFingerprint,
              transcriptId: latest.id,
              transcriptRetranscribeCount: latest.retranscribeCount,
            }).current,
            false,
          );
        } else {
          const { first, second } = await runOrderedRace({ first: complete, second: startAi });
          assert.equal(first, "applied");
          assert.equal(second.state, "claimed");
          if (second.state !== "claimed") return;
          assert.equal(second.transcriptRetranscribeCount, 1);
          assert.equal(second.analysisContext.transcript?.text, "NEW_GENERATION");
          const stored = await prisma.aiAnalysis.findUniqueOrThrow({
            where: { sessionId: fixture.sessionId },
          });
          assert.equal(stored.transcriptRetranscribeCount, 1);
          assert.equal(stored.inputFingerprint, second.inputFingerprint);
        }
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(true);
    await race(false);
  });
});

test("AI-AUTH-04 AI admission vs enhancement becoming publication-eligible", async (t) => {
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
          admitAiAnalysisMaterial({
            sessionId: fixture.sessionId,
            transcriptId: fixture.transcriptId,
            language: "ru",
            client: prisma,
          });
        if (aiFirst) {
          const { first, second } = await runOrderedRace({ first: startAi, second: improve });
          assert.equal(first.state, "claimed");
          if (first.state === "claimed") {
            assert.equal(first.analysisContext.transcript?.text, "raw lexical");
            assert.equal(
              first.inputFingerprint,
              fingerprintSessionAnalysisContext(first.analysisContext),
            );
          }
          assert.equal(second.outcome, "conflict");
          assert.equal(enhancementScheduled, 0);
        } else {
          const { first, second } = await runOrderedRace({ first: improve, second: startAi });
          assert.equal(first.outcome, "started");
          assert.equal(second.state, "enhancement_in_flight");
          assert.equal(enhancementScheduled, 1);
          const analysis = await prisma.aiAnalysis.findUnique({
            where: { sessionId: fixture.sessionId },
          });
          assert.equal(analysis, null);
        }
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(false);
    await race(true);
  });
});

test("MAP-GEN-01 stale generation N mapping is rejected after N+1", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const fixture = await createFixture(setup, {
      status: TranscriptStatus.TRANSCRIBING,
      extraParticipant: true,
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const generationRow = await prisma.transcript.findUniqueOrThrow({
      where: { id: fixture.transcriptId },
      select: { startedAt: true, retranscribeCount: true },
    });
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
              retranscribeCount: 1,
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
      const staleMapping = () =>
        prisma.$transaction((tx) =>
          persistMappingOwnedTranscriptUpdate({
            tx,
            transcriptId: fixture.transcriptId,
            expectedTranscriptId: fixture.transcriptId,
            expectedRetranscribeCount: 0,
            requestedMapping: { speaker_1: fixture.sellerId },
            rebuildDiarizedText: true,
            participants: [
              {
                id: fixture.sellerId,
                displayName: "Seller",
                type: "PARTICIPANT",
                roleName: "Seller",
              },
            ],
          }),
        );
      const { first, second } = await runOrderedRace({
        first: complete,
        second: staleMapping,
      });
      assert.equal(first, "applied");
      assert.equal(second.ok, false);
      if (!second.ok) {
        assert.equal(second.reason, "generation_mismatch");
      }
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      assert.equal(latest.retranscribeCount, 1);
      assert.equal(latest.text, "NEW_GENERATION");
      assert.equal(latest.segments[0]?.mappedParticipantId, fixture.participantId);
      assert.equal(
        (latest.speakerMapping as { speaker_1?: string } | null)?.speaker_1,
        fixture.participantId,
      );
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("MAP-GEN-02 wrong transcriptId is rejected", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const fixture = await createFixture(setup, { extraParticipant: true });
    try {
      const persisted = await prisma.$transaction((tx) =>
        persistMappingOwnedTranscriptUpdate({
          tx,
          transcriptId: fixture.transcriptId,
          expectedTranscriptId: randomUUID(),
          expectedRetranscribeCount: 0,
          requestedMapping: { speaker_1: fixture.sellerId },
          rebuildDiarizedText: true,
          participants: [
            {
              id: fixture.sellerId,
              displayName: "Seller",
              type: "PARTICIPANT",
              roleName: "Seller",
            },
          ],
        }),
      );
      assert.equal(persisted.ok, false);
      if (!persisted.ok) {
        assert.equal(persisted.reason, "generation_mismatch");
      }
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      assert.equal(latest.segments[0]?.mappedParticipantId, fixture.participantId);
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("MAP-GEN-03 wrong retranscribeCount is rejected", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const fixture = await createFixture(setup, { extraParticipant: true });
    try {
      const persisted = await prisma.$transaction((tx) =>
        persistMappingOwnedTranscriptUpdate({
          tx,
          transcriptId: fixture.transcriptId,
          expectedTranscriptId: fixture.transcriptId,
          expectedRetranscribeCount: 9,
          requestedMapping: { speaker_1: fixture.sellerId },
          rebuildDiarizedText: true,
          participants: [
            {
              id: fixture.sellerId,
              displayName: "Seller",
              type: "PARTICIPANT",
              roleName: "Seller",
            },
          ],
        }),
      );
      assert.equal(persisted.ok, false);
      if (!persisted.ok) {
        assert.equal(persisted.reason, "generation_mismatch");
      }
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("MAP-GEN-04 Analyze auto-confirmation does not overwrite newer facilitator mapping", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    async function race(mappingFirst: boolean) {
      const fixture = await createFixture(setup, {
        extraParticipant: true,
        speakerMappingStatus: "AUTO_SUGGESTED",
      });
      try {
        const confirmAi = () =>
          admitAiAnalysisMaterial({
            sessionId: fixture.sessionId,
            transcriptId: fixture.transcriptId,
            language: "ru",
            client: prisma,
            confirmAutoSuggestedMapping: { confirmedBy: "ai-admission" },
          });
        const facilitatorMapping = () =>
          prisma.$transaction((tx) =>
            persistMappingOwnedTranscriptUpdate({
              tx,
              transcriptId: fixture.transcriptId,
              expectedTranscriptId: fixture.transcriptId,
              expectedRetranscribeCount: 0,
              patch: {
                speakerMappingStatus: "CONFIRMED",
                speakerMappingConfirmedBy: "facilitator",
              },
              requestedMapping: { speaker_1: fixture.sellerId },
              rebuildDiarizedText: true,
              participants: [
                {
                  id: fixture.participantId,
                  displayName: "Buyer",
                  type: "PARTICIPANT",
                  roleName: "Buyer",
                },
                {
                  id: fixture.sellerId,
                  displayName: "Seller",
                  type: "PARTICIPANT",
                  roleName: "Seller",
                },
              ],
            }),
          );
        const ordered = mappingFirst
          ? await runOrderedRace({ first: facilitatorMapping, second: confirmAi })
          : await runOrderedRace({ first: confirmAi, second: facilitatorMapping });
        const mappingResult = mappingFirst ? ordered.first : ordered.second;
        const aiResult = mappingFirst ? ordered.second : ordered.first;
        assert.equal(isMappingPersistResult(mappingResult) && mappingResult.ok, true);
        assert.equal(isClaimedAdmission(aiResult), true);
        const latest = await prisma.transcript.findUniqueOrThrow({
          where: { id: fixture.transcriptId },
          include: { segments: true },
        });
        assert.equal(latest.speakerMappingStatus, "CONFIRMED");
        assert.equal(
          (latest.speakerMapping as { speaker_1?: string } | null)?.speaker_1,
          fixture.sellerId,
        );
        assert.equal(latest.segments[0]?.mappedParticipantId, fixture.sellerId);
        assert.notEqual(latest.speakerMappingConfirmedBy, "ai-admission");
      } finally {
        await destroyFixture(setup, fixture);
      }
    }
    await race(true);
    await race(false);
  });
});

test("PROV-RPT Repeat Improve preserves published provenance until B publishes", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const runA = randomUUID();
    const fixture = await createFixture(setup, {
      text: "published lexical",
      qualityText: "raw lexical",
      metadata: completedPublicationMetadata({
        runId: runA,
        leaseToken: randomUUID(),
        text: "published lexical",
        originalText: "raw lexical",
      }),
    });
    try {
      const started = await executeTranscriptEnhancement({
        transcriptId: fixture.transcriptId,
        triggerSource: "manual",
        forceReenhancement: true,
        runInBackground: true,
        dependencies: {
          db: prisma,
          schedule: () => {},
          enhance: noopEnhance,
        },
      });
      assert.equal(started.outcome, "started");
      const afterStart = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      const publicationAfterStart = parseTranscriptEnhancementPublication(
        afterStart.processingMetadata,
      );
      assert.equal(publicationAfterStart?.runId, runA);
      assert.equal(
        resolveSegmentEnhancementProvenance({
          publication: publicationAfterStart,
          currentRetranscribeCount: afterStart.retranscribeCount,
          orderIndex: 0,
          publishedText: afterStart.segments[0]?.text ?? "",
        }),
        "applied",
      );
      const latestJob = parseTranscriptEnhancementJob(afterStart.processingMetadata);
      assert.equal(latestJob.publicationEligible, true);
      assert.notEqual(latestJob.runId, runA);

      const skipped = await continueWithCurrentTranscript({
        db: prisma,
        transcriptId: fixture.transcriptId,
      });
      assert.equal(skipped.outcome, "cancelled");
      const afterSkip = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      assert.equal(
        parseTranscriptEnhancementPublication(afterSkip.processingMetadata)?.runId,
        runA,
      );
      assert.equal(
        resolveSegmentEnhancementProvenance({
          publication: parseTranscriptEnhancementPublication(afterSkip.processingMetadata),
          currentRetranscribeCount: afterSkip.retranscribeCount,
          orderIndex: 0,
          publishedText: afterSkip.segments[0]?.text ?? "",
        }),
        "applied",
      );

      const startedAgain = await executeTranscriptEnhancement({
        transcriptId: fixture.transcriptId,
        triggerSource: "manual",
        forceReenhancement: true,
        runInBackground: true,
        dependencies: {
          db: prisma,
          schedule: () => {},
          enhance: noopEnhance,
        },
      });
      assert.equal(startedAgain.outcome, "started");
      const runningB = parseTranscriptEnhancementJob(
        (
          await prisma.transcript.findUniqueOrThrow({
            where: { id: fixture.transcriptId },
          })
        ).processingMetadata,
      );
      await markEnhancementExecutionFailed({
        db: prisma,
        transcriptId: fixture.transcriptId,
        owner: {
          runId: runningB.runId ?? "",
          leaseToken: runningB.leaseToken ?? "",
          inputIdentity: runningB.inputIdentity ?? "",
          retranscribeCount: runningB.retranscribeCount,
        },
      });
      const afterFail = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      assert.equal(
        parseTranscriptEnhancementPublication(afterFail.processingMetadata)?.runId,
        runA,
      );
      const failedJob = parseTranscriptEnhancementJob(afterFail.processingMetadata);
      assert.notEqual(failedJob.executionStatus, "COMPLETED");

      const startedC = await executeTranscriptEnhancement({
        transcriptId: fixture.transcriptId,
        triggerSource: "manual",
        forceReenhancement: true,
        runInBackground: true,
        dependencies: {
          db: prisma,
          schedule: () => {},
          enhance: noopEnhance,
        },
      });
      assert.equal(startedC.outcome, "started");
      const jobC = parseTranscriptEnhancementJob(
        (
          await prisma.transcript.findUniqueOrThrow({
            where: { id: fixture.transcriptId },
          })
        ).processingMetadata,
      );
      await checkpointEnhancementChunk({
        db: prisma,
        transcriptId: fixture.transcriptId,
        owner: {
          runId: jobC.runId ?? "",
          leaseToken: jobC.leaseToken ?? "",
          inputIdentity: jobC.inputIdentity ?? "",
          retranscribeCount: jobC.retranscribeCount,
        },
        chunk: {
          chunkIndex: 0,
          status: "COMPLETED",
          targetIndexes: [0],
          attemptCount: 1,
          unpublishedByOrderIndex: { "0": "second enhance" },
          lastErrorClass: null,
          lastHttpClass: null,
          lastSchemaResult: "valid",
          providerDurationMs: null,
          usageInputTokens: null,
          usageOutputTokens: null,
          usageTotalTokens: null,
          usageClassification: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:10.000Z",
        },
      });
      const published = await publishEnhancementIfEligible({
        db: prisma,
        transcriptId: fixture.transcriptId,
        owner: {
          runId: jobC.runId ?? "",
          leaseToken: jobC.leaseToken ?? "",
          inputIdentity: jobC.inputIdentity ?? "",
          retranscribeCount: jobC.retranscribeCount,
        },
      });
      assert.equal(published.published, true);
      const afterPublish = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      const publicationB = parseTranscriptEnhancementPublication(
        afterPublish.processingMetadata,
      );
      assert.equal(publicationB?.runId, jobC.runId);
      assert.notEqual(publicationB?.runId, runA);
      assert.equal(
        resolveSegmentEnhancementProvenance({
          publication: publicationB,
          currentRetranscribeCount: afterPublish.retranscribeCount,
          orderIndex: 0,
          publishedText: afterPublish.segments[0]?.text ?? "",
        }),
        "applied",
      );
      assert.equal(afterPublish.segments[0]?.text, "second enhance");
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("PROV-RPT-05 first Improve Skip does not mint publication provenance", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const fixture = await createFixture(setup);
    try {
      const started = await executeTranscriptEnhancement({
        transcriptId: fixture.transcriptId,
        triggerSource: "manual",
        runInBackground: true,
        dependencies: {
          db: prisma,
          schedule: () => {},
          enhance: noopEnhance,
        },
      });
      assert.equal(started.outcome, "started");
      const skipped = await continueWithCurrentTranscript({
        db: prisma,
        transcriptId: fixture.transcriptId,
      });
      assert.equal(skipped.outcome, "cancelled");
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      assert.equal(parseTranscriptEnhancementPublication(latest.processingMetadata), null);
      assert.equal(
        resolveSegmentEnhancementProvenance({
          publication: null,
          currentRetranscribeCount: latest.retranscribeCount,
          orderIndex: 0,
          publishedText: latest.segments[0]?.text ?? "",
          rawText: latest.segments[0]?.qualityText,
        }),
        "raw",
      );
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});

test("PROV-RPT-06 human lexical edit of a published segment is not green", async (t) => {
  await withE2eHarness(t, async ({ prisma, setup }) => {
    const runA = randomUUID();
    const fixture = await createFixture(setup, {
      text: "published lexical",
      qualityText: "raw lexical",
      metadata: completedPublicationMetadata({
        runId: runA,
        leaseToken: randomUUID(),
        text: "published lexical",
        originalText: "raw lexical",
      }),
    });
    try {
      await prisma.transcriptSegment.update({
        where: { id: fixture.segmentId },
        data: { text: "human edited" },
      });
      const latest = await prisma.transcript.findUniqueOrThrow({
        where: { id: fixture.transcriptId },
        include: { segments: true },
      });
      assert.equal(
        resolveSegmentEnhancementProvenance({
          publication: parseTranscriptEnhancementPublication(latest.processingMetadata),
          currentRetranscribeCount: latest.retranscribeCount,
          orderIndex: 0,
          publishedText: latest.segments[0]?.text ?? "",
          rawText: latest.segments[0]?.qualityText,
        }),
        "edited",
      );
      assert.equal(
        parseTranscriptEnhancementPublication(latest.processingMetadata)?.runId,
        runA,
      );
    } finally {
      await destroyFixture(setup, fixture);
    }
  });
});
