import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  isOwnedTranscriptionGeneration,
  isSameTranscriptionGeneration,
  shouldBindDownstreamToGeneration,
  type TranscriptionGenerationRef,
} from "@/lib/services/transcription-ownership";
import {
  resolveSharedTranscriptionAdmission,
} from "@/lib/services/transcription-run-claim";
import {
  nextTranscriptionActionAfterCanonicalFailure,
  silentLegacyTranscribeFallbackEnabled,
} from "@/lib/transcription/transcription-routes";

type StoreRow = {
  id: string;
  startedAt: Date;
  retranscribeCount: number;
  status: TranscriptStatus;
  text: string;
  diarizedText: string;
  processingMetadata: Record<string, unknown>;
  segments: Array<{ text: string }>;
};

function createLatch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function persistOwned(
  row: StoreRow,
  generation: TranscriptionGenerationRef,
  data: Partial<StoreRow>,
): "applied" | "stale" {
  if (!isOwnedTranscriptionGeneration(row, generation)) {
    return "stale";
  }
  Object.assign(row, data);
  return "applied";
}

test("F01 canonical claim then old route is rejected without a provider call", async () => {
  const afterClaim = createLatch();
  const row: StoreRow = {
    id: "tr-1",
    startedAt: new Date("2026-08-19T10:00:00.000Z"),
    retranscribeCount: 0,
    status: TranscriptStatus.QUEUED,
    text: "",
    diarizedText: "",
    processingMetadata: { transcriptionClaim: { source: "initial" } },
    segments: [],
  };
  let providerCalls = 0;

  const canonical = (async () => {
    await afterClaim.promise;
    providerCalls += 1;
    assert.equal(
      persistOwned(row, {
        transcriptId: row.id,
        startedAt: row.startedAt,
        retranscribeCount: row.retranscribeCount,
      }, {
        status: TranscriptStatus.COMPLETED,
        text: "canonical generation",
        diarizedText: "[Speaker 1] canonical generation",
        segments: [{ text: "canonical generation" }],
      }),
      "applied",
    );
  })();

  const oldRouteDecision = resolveSharedTranscriptionAdmission({
    mode: "compatibility",
    existing: { id: row.id, status: row.status, text: row.text },
  });
  assert.equal(oldRouteDecision.kind, "already_active");
  assert.equal(providerCalls, 0);

  afterClaim.release();
  await canonical;
  assert.equal(providerCalls, 1);
  assert.equal(row.text, "canonical generation");
});

test("F02 old-route and canonical claims share one ownership primitive", () => {
  const queued = {
    id: "tr-1",
    status: TranscriptStatus.TRANSCRIBING,
    text: "",
  };
  const fromOld = resolveSharedTranscriptionAdmission({
    mode: "compatibility",
    existing: queued,
  });
  const fromCanonical = resolveSharedTranscriptionAdmission({
    mode: "initial",
    existing: queued,
  });
  assert.deepEqual(fromOld, fromCanonical);
  assert.equal(fromOld.kind, "already_active");
});

test("F02 idle completed transcript converges compatibility onto retranscribe, not a second writer", () => {
  const completed = {
    id: "tr-1",
    status: TranscriptStatus.COMPLETED,
    text: "done",
  };
  assert.equal(
    resolveSharedTranscriptionAdmission({
      mode: "compatibility",
      existing: completed,
    }).kind,
    "retranscribe",
  );
  assert.equal(
    resolveSharedTranscriptionAdmission({
      mode: "initial",
      existing: completed,
    }).kind,
    "already_completed",
  );
  assert.equal(
    resolveSharedTranscriptionAdmission({
      mode: "retranscribe",
      existing: completed,
    }).kind,
    "retranscribe",
  );
});

test("F03 late generation N persist cannot overwrite completed N+1", async () => {
  const beforePersist = createLatch();
  const startedAtN = new Date("2026-08-19T10:00:00.000Z");
  const generationN: TranscriptionGenerationRef = {
    transcriptId: "tr-1",
    startedAt: startedAtN,
    retranscribeCount: 0,
  };
  const row: StoreRow = {
    id: "tr-1",
    startedAt: startedAtN,
    retranscribeCount: 0,
    status: TranscriptStatus.TRANSCRIBING,
    text: "old draft",
    diarizedText: "[Speaker 1] old draft",
    processingMetadata: { transcriptionClaim: { source: "compatibility" } },
    segments: [{ text: "old draft" }],
  };

  const delayedN = (async () => {
    await beforePersist.promise;
    return persistOwned(row, generationN, {
      status: TranscriptStatus.COMPLETED,
      text: "stale N overwrite",
      diarizedText: "[Speaker 1] stale N overwrite",
      processingMetadata: { stale: true },
      segments: [{ text: "stale N overwrite" }],
    });
  })();

  row.startedAt = new Date("2026-08-19T10:05:00.000Z");
  row.retranscribeCount = 1;
  row.status = TranscriptStatus.COMPLETED;
  row.text = "generation N+1";
  row.diarizedText = "[Buyer] generation N+1";
  row.processingMetadata = { transcriptionClaim: { source: "initial" } };
  row.segments = [{ text: "generation N+1" }];

  beforePersist.release();
  assert.equal(await delayedN, "stale");
  assert.equal(row.text, "generation N+1");
  assert.equal(row.diarizedText, "[Buyer] generation N+1");
  assert.equal(row.retranscribeCount, 1);
  assert.deepEqual(row.processingMetadata, {
    transcriptionClaim: { source: "initial" },
  });
  assert.deepEqual(row.segments, [{ text: "generation N+1" }]);
});

test("F04 stale run cannot bind enhancement or mapping to another generation", () => {
  const generationN: TranscriptionGenerationRef = {
    transcriptId: "tr-1",
    startedAt: new Date("2026-08-19T10:00:00.000Z"),
    retranscribeCount: 0,
  };
  const current = {
    id: "tr-1",
    startedAt: new Date("2026-08-19T10:05:00.000Z"),
    retranscribeCount: 1,
    status: TranscriptStatus.COMPLETED,
  };
  assert.equal(isSameTranscriptionGeneration(current, generationN), false);
  assert.equal(
    shouldBindDownstreamToGeneration({
      applied: true,
      generationMatches: isSameTranscriptionGeneration(current, generationN),
    }),
    false,
  );
});

test("F05 canonical failure does not fall back to the old route", () => {
  assert.equal(silentLegacyTranscribeFallbackEnabled(), false);
  assert.equal(nextTranscriptionActionAfterCanonicalFailure(), "retry_canonical");
});

test("F08 one accepted owner means at most one provider call", async () => {
  const afterFirstClaim = createLatch();
  let providerCalls = 0;
  const row = {
    id: "tr-1",
    status: TranscriptStatus.QUEUED,
    text: "",
  };

  const first = (async () => {
    await afterFirstClaim.promise;
    providerCalls += 1;
  })();

  const secondDecision = resolveSharedTranscriptionAdmission({
    mode: "compatibility",
    existing: row,
  });
  assert.equal(secondDecision.kind, "already_active");
  assert.equal(providerCalls, 0);
  afterFirstClaim.release();
  await first;
  assert.equal(providerCalls, 1);
});
