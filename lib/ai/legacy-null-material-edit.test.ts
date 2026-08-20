import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  decideLegacyNullFingerprintBindOnMaterialChange,
  evaluateAiAnalysisCurrentness,
} from "@/lib/ai/analysis-currentness";
import {
  MATERIAL_CHANGE_CONFIRMATION_REQUIRED,
  decideFacilitatorMaterialChangeGuard,
} from "@/lib/ai/material-input-invalidation";
import { areNotesMaterialToNegotiationAnalysis } from "@/lib/ai/material-negotiation-notes";

const TRANSCRIPT_ID = "historical-transcript";
const RETRANSCRIBE_COUNT = 0;
const PRE_EDIT_FINGERPRINT = "pre-edit-envelope-hash";
const POST_EDIT_FINGERPRINT = "post-edit-envelope-hash";
const NEW_RUN_FINGERPRINT = "new-run-envelope-hash";

const historicalNullAnalysis = {
  inputFingerprint: null,
  transcriptId: TRANSCRIPT_ID,
  transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
};

function recipientCanViewPublishedAnalysis(input: {
  isFacilitator: boolean;
  hasValidPublicationGrant: boolean;
  analysisCurrent: boolean;
}): boolean {
  return input.isFacilitator || (input.hasValidPublicationGrant && input.analysisCurrent);
}

function applyLegacyMaterialEdit(analysis = historicalNullAnalysis) {
  const bound = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis,
    preMutationFingerprint: PRE_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.equal(bound, PRE_EDIT_FINGERPRINT);
  assert.equal(analysis.transcriptRetranscribeCount, RETRANSCRIBE_COUNT);
  return evaluateAiAnalysisCurrentness({
    analysis: {
      ...analysis,
      inputFingerprint: bound,
    },
    currentFingerprint: POST_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
}

test("LEGACY_EDIT_01 NULL fingerprint lexical edit makes old analysis non-current without touching retranscribeCount", () => {
  const before = evaluateAiAnalysisCurrentness({
    analysis: historicalNullAnalysis,
    currentFingerprint: POST_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.deepEqual(before, { current: true, reason: "legacy_current" });

  const after = applyLegacyMaterialEdit();
  assert.deepEqual(after, { current: false, reason: "fingerprint_mismatch" });
});

test("LEGACY_EDIT_02 NULL fingerprint material edit with active publication warns, revokes path, and denies stale recipients", () => {
  const blocked = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: true,
    confirmRewindPublication: false,
  });
  assert.equal(blocked.allow, false);
  if (!blocked.allow) {
    assert.equal(blocked.errorCode, MATERIAL_CHANGE_CONFIRMATION_REQUIRED);
  }

  const confirmed = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: true,
    confirmRewindPublication: true,
  });
  assert.deepEqual(confirmed, { allow: true, revokePublication: true });

  const after = applyLegacyMaterialEdit();
  assert.equal(after.current, false);
  assert.equal(
    recipientCanViewPublishedAnalysis({
      isFacilitator: false,
      hasValidPublicationGrant: false,
      analysisCurrent: after.current,
    }),
    false,
  );
  assert.equal(
    recipientCanViewPublishedAnalysis({
      isFacilitator: false,
      hasValidPublicationGrant: true,
      analysisCurrent: after.current,
    }),
    false,
  );
});

test("LEGACY_EDIT_03 untouched historical NULL fingerprint stays legacy-current", () => {
  const bound = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis: historicalNullAnalysis,
    preMutationFingerprint: PRE_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.equal(bound, PRE_EDIT_FINGERPRINT);

  const untouched = evaluateAiAnalysisCurrentness({
    analysis: historicalNullAnalysis,
    currentFingerprint: PRE_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.deepEqual(untouched, { current: true, reason: "legacy_current" });
});

test("LEGACY_EDIT_04 facilitator note edit does not bind or invalidate historical NULL analysis", () => {
  assert.equal(areNotesMaterialToNegotiationAnalysis("FACILITATOR"), false);
  const afterFacilitatorNote = evaluateAiAnalysisCurrentness({
    analysis: historicalNullAnalysis,
    currentFingerprint: "facilitator-notes-are-excluded",
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.deepEqual(afterFacilitatorNote, {
    current: true,
    reason: "legacy_current",
  });
});

test("LEGACY_EDIT_05 observer note edit does not invalidate historical NULL analysis", () => {
  assert.equal(areNotesMaterialToNegotiationAnalysis("OBSERVER"), false);
  const afterObserverNote = evaluateAiAnalysisCurrentness({
    analysis: historicalNullAnalysis,
    currentFingerprint: "observer-notes-are-excluded",
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.deepEqual(afterObserverNote, {
    current: true,
    reason: "legacy_current",
  });
});

test("LEGACY_EDIT_06 speaker mapping material edit uses the canonical helper and invalidates NULL analysis", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const mappingRoute = readFileSync(
    join(root, "app/api/sessions/[sessionId]/speaker-mapping/route.ts"),
    "utf8",
  );
  const attributionRoute = readFileSync(
    join(root, "app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts"),
    "utf8",
  );
  const transcriptRoute = readFileSync(
    join(root, "app/api/sessions/[sessionId]/transcript/route.ts"),
    "utf8",
  );
  assert.match(mappingRoute, /applyFacilitatorMaterialInputChange/);
  assert.match(attributionRoute, /applyFacilitatorMaterialInputChange/);
  assert.match(transcriptRoute, /applyFacilitatorMaterialInputChange/);

  const afterMapping = applyLegacyMaterialEdit();
  assert.deepEqual(afterMapping, {
    current: false,
    reason: "fingerprint_mismatch",
  });
});

test("LEGACY_EDIT_07 fingerprinted analysis material edit keeps Phase D mismatch behavior", () => {
  const fingerprinted = {
    inputFingerprint: PRE_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  };
  const bind = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis: fingerprinted,
    preMutationFingerprint: PRE_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.equal(bind, null);

  const after = evaluateAiAnalysisCurrentness({
    analysis: fingerprinted,
    currentFingerprint: POST_EDIT_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.deepEqual(after, { current: false, reason: "fingerprint_mismatch" });
});

test("LEGACY_EDIT_08 rerun after historical material edit stores a real fingerprint and can republish", () => {
  const afterEdit = applyLegacyMaterialEdit();
  assert.equal(afterEdit.current, false);

  const afterRerun = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: NEW_RUN_FINGERPRINT,
      transcriptId: TRANSCRIPT_ID,
      transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
    },
    currentFingerprint: NEW_RUN_FINGERPRINT,
    transcriptId: TRANSCRIPT_ID,
    transcriptRetranscribeCount: RETRANSCRIBE_COUNT,
  });
  assert.deepEqual(afterRerun, { current: true, reason: "fingerprint_match" });
  assert.notEqual(NEW_RUN_FINGERPRINT, PRE_EDIT_FINGERPRINT);
});
