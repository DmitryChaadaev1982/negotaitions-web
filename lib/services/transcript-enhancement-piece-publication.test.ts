import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  computeEnhancementProgress,
  unpublishedCoversOwnedSourceIndexes,
  type TranscriptEnhancementDurableChunk,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import { publishEnhancementIfEligible } from "@/lib/services/transcript-enhancement-state";
import {
  buildTranscriptEnhancementTargetPieces,
  resolveEnhancementPublicationTexts,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";

function makeSegment(
  index: number,
  originalText: string,
): TranscriptEnhancementInputSegment {
  return {
    index,
    speakerLabel: "speaker_1",
    startMs: index * 1000,
    endMs: index * 1000 + 800,
    originalText,
    segmentId: `seg-${index}`,
  };
}

function productionShapedFixture() {
  const shortA = "Короткий сегмент до oversized.";
  const oversized = `${"Это предложение повторяется для превышения лимита куска. ".repeat(14)}Конец.`;
  const shortB = "Короткий сегмент после oversized.";
  assert.equal(oversized.length > 700, true);
  const sourceSegments = [
    makeSegment(0, shortA),
    makeSegment(1, oversized),
    makeSegment(2, shortB),
  ];
  const pieces = buildTranscriptEnhancementTargetPieces(sourceSegments, 700);
  const split = pieces.filter((piece) => piece.sourceIndex === 1);
  assert.equal(split.length >= 2, true);
  assert.equal(
    split.every((piece) => piece.index !== 1),
    true,
    "oversized source must use synthetic piece indexes",
  );
  const unpublishedByOrderIndex: Record<string, string> = {
    "0": "Enhanced before.",
    "2": "Enhanced after.",
  };
  for (const piece of split) {
    unpublishedByOrderIndex[String(piece.index)] = `Enhanced piece ${piece.pieceIndex}.`;
  }
  return {
    sourceSegments,
    pieces,
    unpublishedByOrderIndex,
    ownedSourceIndexes: sourceSegments.map((segment) => segment.index),
  };
}

test("sanitized exact-case: OLD source-key check fails, NEW reconstruct publishes", () => {
  const fixture = productionShapedFixture();
  assert.equal(
    unpublishedCoversOwnedSourceIndexes(
      fixture.unpublishedByOrderIndex,
      fixture.ownedSourceIndexes,
    ),
    false,
    "OLD behavior must fail when the oversized source key is absent",
  );
  assert.equal(fixture.unpublishedByOrderIndex["1"], undefined);

  const resolved = resolveEnhancementPublicationTexts({
    sourceSegments: fixture.sourceSegments,
    unpublishedByOrderIndex: fixture.unpublishedByOrderIndex,
    persistedPieces: fixture.pieces,
    maxCharsPerPiece: 700,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    throw new Error("expected reconstruct success");
  }
  assert.equal(resolved.textBySourceIndex.get(0), "Enhanced before.");
  assert.equal(resolved.textBySourceIndex.get(2), "Enhanced after.");
  assert.match(resolved.textBySourceIndex.get(1) ?? "", /Enhanced piece 0/);
  assert.match(resolved.textBySourceIndex.get(1) ?? "", /Enhanced piece 1/);
});

test("sanitized exact-case: incomplete piece coverage stays rejected", () => {
  const fixture = productionShapedFixture();
  const splitIndexes = fixture.pieces
    .filter((piece) => piece.sourceIndex === 1)
    .map((piece) => piece.index);
  const missingOnePiece = { ...fixture.unpublishedByOrderIndex };
  delete missingOnePiece[String(splitIndexes[0])];

  const resolved = resolveEnhancementPublicationTexts({
    sourceSegments: fixture.sourceSegments,
    unpublishedByOrderIndex: missingOnePiece,
    persistedPieces: fixture.pieces,
    maxCharsPerPiece: 700,
  });
  assert.equal(resolved.ok, false);
  if (resolved.ok) {
    throw new Error("expected reconstruct rejection");
  }
  assert.equal(resolved.reason, "incomplete_piece_coverage");
  assert.deepEqual(resolved.fallbackSourceIndexes, [1]);
});

test("sanitized exact-case: D1 publication reconstructs split source and stays atomic", async () => {
  const fixture = productionShapedFixture();
  const reconstructed = resolveEnhancementPublicationTexts({
    sourceSegments: fixture.sourceSegments,
    unpublishedByOrderIndex: fixture.unpublishedByOrderIndex,
    persistedPieces: fixture.pieces,
    maxCharsPerPiece: 700,
  });
  assert.equal(reconstructed.ok, true);
  if (!reconstructed.ok) {
    throw new Error("expected reconstruct success");
  }

  const state = {
    id: "tr-piece-pub",
    sessionId: "session-piece-pub",
    status: TranscriptStatus.COMPLETED,
    text: fixture.sourceSegments.map((segment) => segment.originalText).join(" "),
    diarizedText: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    retranscribeCount: 0,
    processingMetadata: {} as Record<string, unknown>,
    speakerMapping: null,
    session: { participants: [] },
    segments: fixture.sourceSegments.map((segment) => ({
      id: `seg-${segment.index}`,
      orderIndex: segment.index,
      speakerLabel: segment.speakerLabel,
      startSeconds: 0,
      endSeconds: 1,
      mappedParticipantId: null,
      text: segment.originalText,
      qualityText: segment.originalText,
    })),
  };

  const chunk: TranscriptEnhancementDurableChunk = {
    chunkIndex: 0,
    status: "COMPLETED",
    targetIndexes: fixture.ownedSourceIndexes,
    targetPieces: fixture.pieces.map((piece) => ({
      index: piece.index,
      sourceIndex: piece.sourceIndex,
      pieceIndex: piece.pieceIndex,
      pieceCount: piece.pieceCount,
      prefixText: piece.prefixText,
      separatorAfter: piece.separatorAfter,
    })),
    attemptCount: 1,
    unpublishedByOrderIndex: fixture.unpublishedByOrderIndex,
    lastErrorClass: null,
    lastHttpClass: null,
    lastSchemaResult: "valid",
    providerDurationMs: 10,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageTotalTokens: null,
    usageClassification: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
  };
  const job: TranscriptEnhancementJob = {
    schemaVersion: "d1-v1",
    jobId: "job-piece",
    runId: "job-piece",
    leaseToken: "lease-piece",
    leaseExpiresAt: "2026-01-01T01:00:00.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "identity-piece",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({ "0": chunk }),
    chunks: { "0": chunk },
    unpublishedByOrderIndex: fixture.unpublishedByOrderIndex,
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  };
  state.processingMetadata = {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: job,
  };

  type InMemoryDb = {
    transcript: {
      findUnique: () => Promise<typeof state>;
      update: (args: { data: Record<string, unknown> }) => Promise<typeof state>;
    };
    transcriptSegment: {
      update: (args: {
        where: { id: string };
        data: { text?: string };
      }) => Promise<void>;
    };
    $transaction: (callback: (tx: InMemoryDb) => Promise<unknown>) => Promise<unknown>;
  };
  const db: InMemoryDb = {
    transcript: {
      findUnique: async () => ({
        ...state,
        processingMetadata: state.processingMetadata,
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        if (typeof args.data.text === "string") state.text = args.data.text;
        if ("processingMetadata" in args.data) {
          state.processingMetadata = args.data.processingMetadata as Record<string, unknown>;
        }
        return state;
      },
    },
    transcriptSegment: {
      update: async (args: {
        where: { id: string };
        data: { text?: string };
      }) => {
        const segment = state.segments.find((item) => item.id === args.where.id);
        if (segment && typeof args.data.text === "string") {
          segment.text = args.data.text;
        }
      },
    },
    $transaction: async (callback) => callback(db),
  };

  const published = await publishEnhancementIfEligible({
    db: db as never,
    transcriptId: state.id,
    owner: {
      runId: "job-piece",
      leaseToken: "lease-piece",
      inputIdentity: "identity-piece",
      retranscribeCount: 0,
    },
    nowMs: Date.parse("2026-01-01T00:00:02.000Z"),
  });

  assert.equal(published.published, true);
  assert.equal(published.outcome, "published");
  assert.equal(state.segments[0]?.text, "Enhanced before.");
  assert.equal(state.segments[2]?.text, "Enhanced after.");
  assert.match(state.segments[1]?.text ?? "", /Enhanced piece 0/);
  assert.match(state.segments[1]?.text ?? "", /Enhanced piece 1/);
  assert.equal(state.segments[1]?.text.includes(fixture.sourceSegments[1]!.originalText), false);
});
