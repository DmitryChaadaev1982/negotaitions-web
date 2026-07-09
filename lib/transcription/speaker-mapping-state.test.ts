import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSpeakerMappingStatus,
  resolveSpeakerMappingForUi,
} from "@/lib/transcription/speaker-mapping-state";

test("manual mapping wins over unsafe suggestion", () => {
  const resolved = resolveSpeakerMappingForUi({
    speakerMapping: { speaker_1: "A", speaker_2: "B" },
    speakerMappingStatus: "PARTIALLY_MAPPED",
    processingMetadata: {
      mappingSuggestion: {
        candidateMapping: { speaker_1: "X", speaker_2: "X" },
        rejectedBySafety: true,
      },
    },
  });

  assert.deepEqual(resolved, { speaker_1: "A", speaker_2: "B" });
});

test("unsafe suggestion is not used as selected mapping", () => {
  const resolved = resolveSpeakerMappingForUi({
    speakerMapping: null,
    speakerMappingStatus: "AUTO_SUGGESTED",
    processingMetadata: {
      mappingSuggestion: {
        candidateMapping: { speaker_1: "A", speaker_2: "B" },
        safety: { safeToApply: false },
      },
    },
  });

  assert.deepEqual(resolved, {});
});

test("safe suggestion is used for auto and review-required statuses", () => {
  const autoSuggested = resolveSpeakerMappingForUi({
    speakerMapping: null,
    speakerMappingStatus: "AUTO_SUGGESTED",
    processingMetadata: {
      mappingSuggestion: {
        candidateMapping: { speaker_1: "A", speaker_2: "B" },
        rejectedBySafety: false,
      },
    },
  });
  const requiredStatus = resolveSpeakerMappingForUi({
    speakerMapping: null,
    speakerMappingStatus: "REQUIRED",
    processingMetadata: {
      mappingSuggestion: {
        candidateMapping: { speaker_1: "A", speaker_2: "B" },
      },
    },
  });

  assert.deepEqual(autoSuggested, { speaker_1: "A", speaker_2: "B" });
  assert.deepEqual(requiredStatus, { speaker_1: "A", speaker_2: "B" });
});

test("review-required statuses prefill diagnostics suggestion for manual confirmation", () => {
  const requiredStatus = resolveSpeakerMappingForUi({
    speakerMapping: null,
    speakerMappingStatus: "REQUIRED",
    processingMetadata: {
      mappingSuggestion: {
        candidateMapping: { speaker_1: "A", speaker_2: "B" },
        rejectedBySafety: true,
      },
    },
  });
  const needsReviewStatus = resolveSpeakerMappingForUi({
    speakerMapping: null,
    speakerMappingStatus: "NEEDS_REVIEW",
    processingMetadata: {
      mappingSuggestion: {
        candidateMapping: { speaker_1: "A", speaker_2: "B" },
        rejectedBySafety: true,
      },
    },
  });

  assert.deepEqual(requiredStatus, { speaker_1: "A", speaker_2: "B" });
  assert.deepEqual(needsReviewStatus, { speaker_1: "A", speaker_2: "B" });
});

test("partial manual mapping remains PARTIALLY_MAPPED", () => {
  const status = deriveSpeakerMappingStatus({
    hasSpeakerDiarization: true,
    speakerLabels: ["speaker_1", "speaker_2"],
    mapping: { speaker_1: "A", speaker_2: null },
    confirm: false,
    previousStatus: "REQUIRED",
  });

  assert.equal(status.status, "PARTIALLY_MAPPED");
  assert.equal(status.allMapped, false);
});

test("complete manual mapping allows confirm status", () => {
  const status = deriveSpeakerMappingStatus({
    hasSpeakerDiarization: true,
    speakerLabels: ["speaker_1", "speaker_2"],
    mapping: { speaker_1: "A", speaker_2: "B" },
    confirm: true,
    previousStatus: "REQUIRED",
  });

  assert.equal(status.status, "CONFIRMED");
  assert.equal(status.allMapped, true);
  assert.equal(status.canConfirm, true);
});

test("confirm is rejected when mapping is incomplete", () => {
  const status = deriveSpeakerMappingStatus({
    hasSpeakerDiarization: true,
    speakerLabels: ["speaker_1", "speaker_2"],
    mapping: { speaker_1: "A", speaker_2: null },
    confirm: true,
    previousStatus: "REQUIRED",
  });

  assert.equal(status.status, "PARTIALLY_MAPPED");
  assert.equal(status.canConfirm, false);
});
