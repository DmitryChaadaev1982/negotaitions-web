import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAssistedMappingSuggestion,
  resolveMappingConfidenceLevel,
  resolveSpeakerReviewMode,
} from "@/lib/transcription/assisted-speaker-mapping";

test("low margin diagnostics still resolves to review card mode", () => {
  const mode = resolveSpeakerReviewMode({
    speakerMappingStatus: "NEEDS_REVIEW",
    speakersCount: 2,
    isEditable: true,
    manualSpeakerModeEnabled: false,
    transcriptSource: "GENERATED",
    mappingReviewSkipped: false,
  });
  const suggestion = resolveAssistedMappingSuggestion({
    mappingSuggestionDiagnostics: {
      reason: "low_margin_review_required",
      candidateMapping: {
        speaker_1: "participant-a",
        speaker_2: "participant-b",
      },
      candidateConfidence: {
        speaker_1: 0.74,
        speaker_2: 0.71,
      },
    },
  });

  assert.equal(mode, "REVIEW_CARD");
  assert.equal(suggestion.reason, "low_margin_review_required");
});

test("assistant suggestion resolves preselected mapping and confidence labels", () => {
  const suggestion = resolveAssistedMappingSuggestion({
    mappingSuggestionDiagnostics: {
      candidateMapping: {
        speaker_1: "participant-a",
        speaker_2: "participant-b",
      },
      candidateConfidence: {
        speaker_1: 0.9,
        speaker_2: 0.67,
      },
      minConfidence: 0.67,
    },
  });

  assert.deepEqual(suggestion.suggestedMapping, {
    speaker_1: "participant-a",
    speaker_2: "participant-b",
  });
  assert.equal(suggestion.perSpeakerConfidence.speaker_1, "HIGH");
  assert.equal(suggestion.perSpeakerConfidence.speaker_2, "MEDIUM");
  assert.equal(suggestion.globalConfidenceLevel, "MEDIUM");
  assert.equal(
    suggestion.hasFullSuggestionForSpeakers(["speaker_1", "speaker_2"]),
    true,
  );
});

test("no suggestion keeps review mode with manual mapping fallback", () => {
  const mode = resolveSpeakerReviewMode({
    speakerMappingStatus: "REQUIRED",
    speakersCount: 2,
    isEditable: true,
    manualSpeakerModeEnabled: false,
    transcriptSource: "GENERATED",
    mappingReviewSkipped: false,
  });
  const suggestion = resolveAssistedMappingSuggestion({
    mappingSuggestionDiagnostics: {
      reason: "manual_review_required",
      candidateMapping: {},
    },
  });

  assert.equal(mode, "REVIEW_CARD");
  assert.equal(suggestion.hasAnySuggestion, false);
  assert.equal(
    suggestion.hasFullSuggestionForSpeakers(["speaker_1", "speaker_2"]),
    false,
  );
});

test("auto-suggested status stays compact and non-blocking", () => {
  const mode = resolveSpeakerReviewMode({
    speakerMappingStatus: "AUTO_SUGGESTED",
    speakersCount: 2,
    isEditable: true,
    manualSpeakerModeEnabled: false,
    transcriptSource: "GENERATED",
    mappingReviewSkipped: false,
  });

  assert.equal(mode, "AUTO_APPLIED_NOTE");
});

test("confidence level thresholds are stable", () => {
  assert.equal(resolveMappingConfidenceLevel(0.9), "HIGH");
  assert.equal(resolveMappingConfidenceLevel(0.7), "MEDIUM");
  assert.equal(resolveMappingConfidenceLevel(0.4), "LOW");
  assert.equal(resolveMappingConfidenceLevel(null), null);
});

