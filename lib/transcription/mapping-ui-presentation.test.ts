import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePrimaryMappingReasonI18nKey,
  resolveSpeakerMappingStatusDescriptionKey,
} from "@/lib/transcription/mapping-ui-presentation";

test("primary mapping reason prefers explicit mappingFailureI18nKey", () => {
  const key = resolvePrimaryMappingReasonI18nKey({
    speakerMappingStatus: "NEEDS_REVIEW",
    mappingFailureI18nKey: "recording.mappingFailureReason.lowMargin",
    mappingFailureCompactI18nKey: "recording.mappingFailureCompact.generic",
    mappingSuggestionDiagnostics: {
      reason: "telemetry_imbalanced",
    },
  });

  assert.equal(key, "recording.mappingFailureReason.lowMargin");
});

test("primary mapping reason falls back to mapped diagnostics before generic compact copy", () => {
  const key = resolvePrimaryMappingReasonI18nKey({
    speakerMappingStatus: "REQUIRED",
    mappingFailureI18nKey: null,
    mappingFailureCompactI18nKey: "recording.mappingFailureCompact.generic",
    mappingSuggestionDiagnostics: {
      reason: "missing_offsets",
    },
  });

  assert.equal(key, "recording.mappingFailureReason.missingOffsets");
});

test("review status description reflects suggestion presence", () => {
  assert.equal(
    resolveSpeakerMappingStatusDescriptionKey({
      speakerMappingStatus: "REQUIRED",
      hasSuggestedMapping: true,
    }),
    "recording.mappingStatusDescription.reviewWithSuggestion",
  );
  assert.equal(
    resolveSpeakerMappingStatusDescriptionKey({
      speakerMappingStatus: "NEEDS_REVIEW",
      hasSuggestedMapping: false,
    }),
    "recording.mappingStatusDescription.reviewWithoutSuggestion",
  );
});

test("partially mapped and auto-suggested statuses use explicit non-confirmed copy", () => {
  assert.equal(
    resolveSpeakerMappingStatusDescriptionKey({
      speakerMappingStatus: "PARTIALLY_MAPPED",
      hasSuggestedMapping: false,
    }),
    "recording.mappingStatusDescription.partiallyMapped",
  );
  assert.equal(
    resolveSpeakerMappingStatusDescriptionKey({
      speakerMappingStatus: "AUTO_SUGGESTED",
      hasSuggestedMapping: true,
    }),
    "recording.mappingStatusDescription.appliedNeedsConfirmation",
  );
});

test("confirmed and not-required statuses do not request mapping warning copy", () => {
  assert.equal(
    resolveSpeakerMappingStatusDescriptionKey({
      speakerMappingStatus: "CONFIRMED",
      hasSuggestedMapping: true,
    }),
    null,
  );
  assert.equal(
    resolveSpeakerMappingStatusDescriptionKey({
      speakerMappingStatus: "NOT_REQUIRED",
      hasSuggestedMapping: false,
    }),
    null,
  );
});
