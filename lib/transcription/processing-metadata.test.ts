import assert from "node:assert/strict";
import test from "node:test";

import {
  asProcessingMetadata,
  isTranscriptEnhancementRunning,
  mergeProcessingMetadata,
  patchProcessingMetadataNamespace,
} from "@/lib/transcription/processing-metadata";

test("mergeProcessingMetadata preserves unknown and sibling namespaces", () => {
  const current = {
    transcriptionProvider: "yandex_speechkit",
    historicalCustom: { keep: true },
    transcriptEnhancement: { status: "RUNNING", runId: "run-1" },
    mappingSuggestion: { reason: "previous" },
  };

  const merged = mergeProcessingMetadata(current, {
    mappingSuggestion: { reason: "auto_suggested", candidateParticipantIds: ["a"] },
  });

  assert.equal(merged.transcriptionProvider, "yandex_speechkit");
  assert.deepEqual(merged.historicalCustom, { keep: true });
  assert.deepEqual(merged.transcriptEnhancement, { status: "RUNNING", runId: "run-1" });
  assert.deepEqual(merged.mappingSuggestion, {
    reason: "auto_suggested",
    candidateParticipantIds: ["a"],
  });
});

test("mergeProcessingMetadata does not drop keys omitted from a stale snapshot", () => {
  const latest = {
    transcriptEnhancement: { status: "COMPLETED" },
    mappingSuggestion: { reason: "auto_suggested" },
    pauseProcessing: { mode: "source_audio_cut" },
  };
  const staleWriterSnapshot = {
    mappingSuggestion: { reason: "old" },
  };

  const unsafe = { ...staleWriterSnapshot, mappingSuggestion: { reason: "new" } };
  assert.equal("transcriptEnhancement" in unsafe, false);

  const safe = mergeProcessingMetadata(latest, { mappingSuggestion: { reason: "new" } });
  assert.deepEqual(safe.transcriptEnhancement, { status: "COMPLETED" });
  assert.deepEqual(safe.pauseProcessing, { mode: "source_audio_cut" });
  assert.deepEqual(safe.mappingSuggestion, { reason: "new" });
});

test("asProcessingMetadata treats non-objects as empty", () => {
  assert.deepEqual(asProcessingMetadata(null), {});
  assert.deepEqual(asProcessingMetadata("x"), {});
  assert.deepEqual(asProcessingMetadata(["a"]), {});
});

test("patchProcessingMetadataNamespace replaces only the owned key", () => {
  const current = {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: { executionStatus: "RUNNING", publicationEligible: true },
    mappingSuggestion: { reason: "old" },
    historicalCustom: { keep: true },
  };
  const patched = patchProcessingMetadataNamespace(current, "mappingSuggestion", {
    reason: "auto_suggested",
  });
  assert.deepEqual(patched.transcriptEnhancement, {
    executionStatus: "RUNNING",
    publicationEligible: true,
  });
  assert.deepEqual(patched.historicalCustom, { keep: true });
  assert.deepEqual(patched.mappingSuggestion, { reason: "auto_suggested" });
});

test("enhancement namespace patch does not delete mappingSuggestion", () => {
  const current = {
    mappingSuggestion: { reason: "auto_suggested" },
    pauseProcessing: { mode: "source_audio_cut" },
    transcriptEnhancement: { executionStatus: "QUEUED" },
  };
  const patched = patchProcessingMetadataNamespace(current, "transcriptEnhancement", {
    executionStatus: "CANCELLED_FOR_PUBLICATION",
    publicationEligible: false,
  });
  assert.deepEqual(patched.mappingSuggestion, { reason: "auto_suggested" });
  assert.deepEqual(patched.pauseProcessing, { mode: "source_audio_cut" });
  assert.deepEqual(patched.transcriptEnhancement, {
    executionStatus: "CANCELLED_FOR_PUBLICATION",
    publicationEligible: false,
  });
});

test("enhancement namespace patch preserves publication provenance", () => {
  const current = {
    mappingSuggestion: { reason: "auto_suggested" },
    transcriptEnhancement: { executionStatus: "QUEUED" },
    transcriptEnhancementPublication: { runId: "run-a", retranscribeCount: 1 },
  };
  const patched = patchProcessingMetadataNamespace(current, "transcriptEnhancement", {
    executionStatus: "RUNNING",
    publicationEligible: true,
    runId: "run-b",
  });
  assert.deepEqual(patched.transcriptEnhancementPublication, {
    runId: "run-a",
    retranscribeCount: 1,
  });
  assert.deepEqual(patched.mappingSuggestion, { reason: "auto_suggested" });
});

test("mapping namespace patch preserves publication provenance", () => {
  const current = {
    transcriptEnhancement: { executionStatus: "COMPLETED" },
    transcriptEnhancementPublication: { runId: "run-a", retranscribeCount: 1 },
    mappingSuggestion: { reason: "old" },
  };
  const patched = patchProcessingMetadataNamespace(current, "mappingSuggestion", {
    reason: "human_save",
  });
  assert.deepEqual(patched.transcriptEnhancementPublication, {
    runId: "run-a",
    retranscribeCount: 1,
  });
  assert.deepEqual(patched.transcriptEnhancement, { executionStatus: "COMPLETED" });
});

test("isTranscriptEnhancementRunning recognizes RUNNING aliases", () => {
  assert.equal(
    isTranscriptEnhancementRunning({ transcriptEnhancement: { status: "RUNNING" } }),
    true,
  );
  assert.equal(
    isTranscriptEnhancementRunning({ transcriptEnhancement: { status: "IN_PROGRESS" } }),
    true,
  );
  assert.equal(
    isTranscriptEnhancementRunning({ transcriptEnhancement: { status: "QUEUED" } }),
    true,
  );
  assert.equal(
    isTranscriptEnhancementRunning({ transcriptEnhancement: { status: "COMPLETED" } }),
    false,
  );
  assert.equal(isTranscriptEnhancementRunning({}), false);
});
