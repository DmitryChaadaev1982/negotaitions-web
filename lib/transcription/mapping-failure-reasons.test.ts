import assert from "node:assert/strict";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { resolveMappingFailure } from "@/lib/transcription/mapping-failure-reasons";

test("no_audio_activity resolves to RU/EN localized reason keys", () => {
  const result = resolveMappingFailure({
    speakerMappingStatus: "REQUIRED",
    processingMetadata: {
      mappingSuggestion: {
        available: false,
        reason: "unavailable:no_audio_activity",
        unavailableReason: "no_audio_activity",
      },
    },
  });
  assert.equal(result.mappingFailureReason, "unavailable:no_audio_activity");
  assert.equal(
    ru.recording.mappingFailureReason.unavailableNoAudioActivity,
    "Автосопоставление не выполнено: не получена телеметрия активности микрофона. Назначьте говорящих вручную.",
  );
  assert.equal(
    en.recording.mappingFailureReason.unavailableNoAudioActivity,
    "Automatic speaker matching was not completed: microphone activity telemetry was not received. Assign speakers manually.",
  );
});

test("many_to_one and low_coverage resolve to localized dictionaries", () => {
  const manyToOne = resolveMappingFailure({
    speakerMappingStatus: "NEEDS_REVIEW",
    processingMetadata: { mappingSuggestion: { reason: "many_to_one" } },
  });
  const lowCoverage = resolveMappingFailure({
    speakerMappingStatus: "NEEDS_REVIEW",
    processingMetadata: { mappingSuggestion: { reason: "low_coverage" } },
  });
  assert.equal(manyToOne.mappingFailureReason, "many_to_one");
  assert.equal(lowCoverage.mappingFailureReason, "low_coverage");
  assert.ok(ru.recording.mappingFailureReason.manyToOne.length > 0);
  assert.ok(en.recording.mappingFailureReason.manyToOne.length > 0);
  assert.ok(ru.recording.mappingFailureReason.lowCoverage.length > 0);
  assert.ok(en.recording.mappingFailureReason.lowCoverage.length > 0);
});

test("unknown reason falls back to localized generic message key", () => {
  const result = resolveMappingFailure({
    speakerMappingStatus: "REQUIRED",
    processingMetadata: { mappingSuggestion: { reason: "unexpected_reason" } },
  });
  assert.equal(result.mappingFailureReason, "unknown_mapping_failure");
  assert.equal(result.mappingFailureI18nKey, "recording.mappingFailureReason.unknownMappingFailure");
  assert.equal(
    ru.recording.mappingFailureReason.unknownMappingFailure,
    "Автосопоставление не выполнено. Назначьте говорящих вручную.",
  );
  assert.equal(
    en.recording.mappingFailureReason.unknownMappingFailure,
    "Automatic speaker matching was not completed. Assign speakers manually.",
  );
});
