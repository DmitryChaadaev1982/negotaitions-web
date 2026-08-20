import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";

import {
  applyOwnedTranscriptionUpdate,
  clearTranscriptionPersistHoldForTests,
  setTranscriptionPersistHoldForTests,
} from "@/lib/services/transcription-generation-cas";
import {
  clearTranscriptionAdmitHoldForTests,
  setTranscriptionAdmitHoldForTests,
} from "@/lib/services/transcription-run-claim";

const mutableEnv = process.env as Record<string, string | undefined>;

async function withProductionNodeEnv(operation: () => Promise<void> | void) {
  const original = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    await operation();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(mutableEnv, "NODE_ENV");
    } else {
      mutableEnv.NODE_ENV = original;
    }
  }
}

test("transcription admit/persist test hooks refuse installation in production", async () => {
  await withProductionNodeEnv(() => {
    assert.throws(
      () => setTranscriptionAdmitHoldForTests(async () => undefined),
      /unavailable in production/,
    );
    assert.throws(
      () => setTranscriptionPersistHoldForTests(async () => undefined),
      /unavailable in production/,
    );
  });
});

test("transcription test hooks install and clear outside production", async () => {
  let admit = 0;
  let persist = 0;
  setTranscriptionAdmitHoldForTests(() => {
    admit += 1;
  });
  setTranscriptionPersistHoldForTests(() => {
    persist += 1;
  });
  clearTranscriptionAdmitHoldForTests();
  clearTranscriptionPersistHoldForTests();
  assert.equal(admit, 0);
  assert.equal(persist, 0);
});

test("F03 latch: delayed generation N persist cannot overwrite N+1", async () => {
  const current = {
    id: "tx-1",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    retranscribeCount: 0,
    status: TranscriptStatus.TRANSCRIBING,
    text: "generation N in flight",
    diarizedText: "[Speaker 1] generation N in flight",
    processingMetadata: { mappingSuggestion: { source: "old" } },
  };
  let updated = false;
  let releaseHold!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  setTranscriptionPersistHoldForTests(() => hold);
  try {
    const tx = {
      transcript: {
        findUnique: async () => current,
        updateMany: async () => {
          updated = true;
          return { count: 1 };
        },
      },
    };
    const delayed = applyOwnedTranscriptionUpdate({
      tx: tx as never,
      generation: {
        transcriptId: "tx-1",
        startedAt: current.startedAt,
        retranscribeCount: 0,
      },
      data: {
        text: "stale generation N",
        diarizedText: "[Speaker 1] stale generation N",
        processingMetadata: { mappingSuggestion: { source: "stale" } },
      },
    });
    current.startedAt = new Date("2026-01-01T00:05:00.000Z");
    current.retranscribeCount = 1;
    current.status = TranscriptStatus.COMPLETED;
    current.text = "generation N+1";
    current.diarizedText = "[Speaker 1] generation N+1";
    current.processingMetadata = { mappingSuggestion: { source: "canonical" } };
    releaseHold();
    assert.equal(await delayed, "stale");
    assert.equal(updated, false);
    assert.equal(current.text, "generation N+1");
    assert.equal(current.diarizedText, "[Speaker 1] generation N+1");
    assert.equal(
      (current.processingMetadata.mappingSuggestion as { source: string }).source,
      "canonical",
    );
  } finally {
    clearTranscriptionPersistHoldForTests();
  }
});

test("failed retranscription restore cannot overwrite a newer generation", async () => {
  let restored = false;
  const tx = {
    transcript: {
      updateMany: async (args: { where: { retranscribeCount?: number } }) => {
        if (args.where.retranscribeCount === 0) {
          restored = true;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  const { applyOwnedFailedRetranscriptionRestore } = await import(
    "@/lib/services/transcription-generation-cas"
  );
  const result = await applyOwnedFailedRetranscriptionRestore({
    tx: tx as never,
    generation: {
      transcriptId: "tx-1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      retranscribeCount: 0,
    },
    data: { text: "stale restore" },
  });
  assert.equal(result, "applied");
  assert.equal(restored, true);

  restored = false;
  const stale = await applyOwnedFailedRetranscriptionRestore({
    tx: {
      transcript: {
        updateMany: async () => ({ count: 0 }),
      },
    } as never,
    generation: {
      transcriptId: "tx-1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      retranscribeCount: 0,
    },
    data: { text: "stale restore" },
  });
  assert.equal(stale, "stale");
  assert.equal(restored, false);
});
