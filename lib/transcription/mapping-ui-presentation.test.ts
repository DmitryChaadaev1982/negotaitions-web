import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAutoAppliedMappingSurface,
  resolvePrimaryMappingReasonI18nKey,
  resolveSpeakerMappingStatusDescriptionKey,
} from "@/lib/transcription/mapping-ui-presentation";
import {
  isLexicalEditLockedByEnhancement,
  isSpeakerMappingLockedByEnhancement,
} from "@/lib/post-processing/enhancement-ux-presentation";
import { shouldSyncSpeakerMappingDraft } from "@/lib/transcription/speaker-mapping-draft-sync";

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

test("MAP-UX-01/03 AUTO_SUGGESTED offers inspect/change until the real editor is open", () => {
  assert.equal(
    resolveAutoAppliedMappingSurface({
      speakerMappingStatus: "AUTO_SUGGESTED",
      mappingLocked: false,
      readOnly: false,
      mappingEditorVisible: false,
    }),
    "notice_with_review_action",
  );
  assert.equal(
    resolveAutoAppliedMappingSurface({
      speakerMappingStatus: "AUTO_SUGGESTED",
      mappingLocked: false,
      readOnly: false,
      mappingEditorVisible: true,
    }),
    "notice_with_editor",
  );
});

test("LAB27-03 mapping remains editable while enhancement is RUNNING", () => {
  assert.equal(isSpeakerMappingLockedByEnhancement(), false);
  assert.equal(
    resolveAutoAppliedMappingSurface({
      speakerMappingStatus: "AUTO_SUGGESTED",
      mappingLocked: isSpeakerMappingLockedByEnhancement(),
      readOnly: false,
      mappingEditorVisible: false,
    }),
    "notice_with_review_action",
  );
});

test("MAP-UX-02 enhancement RUNNING does not hide AUTO_SUGGESTED mapping affordance", () => {
  const running = {
    uiStatus: "IN_PROGRESS",
    executionStatus: "RUNNING" as const,
    publicationEligible: true,
  };
  assert.equal(isSpeakerMappingLockedByEnhancement(), false);
  assert.equal(
    resolveAutoAppliedMappingSurface({
      speakerMappingStatus: "AUTO_SUGGESTED",
      mappingLocked: isSpeakerMappingLockedByEnhancement(),
      readOnly: false,
      mappingEditorVisible: false,
    }),
    "notice_with_review_action",
  );
  assert.equal(isLexicalEditLockedByEnhancement(running), true);
});

test("MAP-UX-05 lexical stays locked while mapping remains editable", () => {
  assert.equal(
    isLexicalEditLockedByEnhancement({
      executionStatus: "RUNNING",
      publicationEligible: true,
    }),
    true,
  );
  assert.equal(isSpeakerMappingLockedByEnhancement(), false);
});

test("MAP-UX-06 Skip/status ticks do not reset a dirty mapping draft", () => {
  assert.equal(
    shouldSyncSpeakerMappingDraft({
      currentTranscriptId: "tr",
      nextTranscriptId: "tr",
      isDirty: true,
    }),
    false,
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
