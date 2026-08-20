import assert from "node:assert/strict";
import test from "node:test";

import {
  decideLegacyNullFingerprintBindOnMaterialChange,
  evaluateAiAnalysisCurrentness,
  shouldPresentAnalysisFromOlderTranscript,
} from "@/lib/ai/analysis-currentness";

test("fingerprinted analysis is current only when hashes match", () => {
  const match = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: "abc",
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "abc",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(match, { current: true, reason: "fingerprint_match" });

  const mismatch = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: "abc",
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "def",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(mismatch, { current: false, reason: "fingerprint_mismatch" });
});

test("fingerprinted analysis with matching hash is non-current after a new transcript generation", () => {
  const afterRetranscribe = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: "abc",
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "abc",
    transcriptId: "t1",
    transcriptRetranscribeCount: 1,
  });
  assert.deepEqual(afterRetranscribe, {
    current: false,
    reason: "generation_mismatch",
  });
});

test("NULL fingerprint keeps transcriptId + retranscribeCount legacy currentness", () => {
  const legacyCurrent = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: null,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "unused",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(legacyCurrent, { current: true, reason: "legacy_current" });

  const legacyStale = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: null,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "unused",
    transcriptId: "t1",
    transcriptRetranscribeCount: 1,
  });
  assert.deepEqual(legacyStale, { current: false, reason: "legacy_stale" });
});

test("legacy-current NULL rows bind the pre-mutation fingerprint at a material-change boundary", () => {
  const bound = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis: {
      inputFingerprint: null,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    preMutationFingerprint: "pre",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.equal(bound, "pre");

  const alreadyFingerprinted = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis: {
      inputFingerprint: "abc",
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    preMutationFingerprint: "pre",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.equal(alreadyFingerprinted, null);

  const alreadyStale = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis: {
      inputFingerprint: null,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    preMutationFingerprint: "pre",
    transcriptId: "t1",
    transcriptRetranscribeCount: 1,
  });
  assert.equal(alreadyStale, null);
});

test("legacy pre-mutation bind is a PT-22 compatibility baseline, not proven historical model input", () => {
  const bound = decideLegacyNullFingerprintBindOnMaterialChange({
    analysis: {
      inputFingerprint: null,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    preMutationFingerprint: "pre",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.equal(bound, "pre");

  const afterMutation = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: bound,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "post",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(afterMutation, {
    current: false,
    reason: "fingerprint_mismatch",
  });

  const revertedToBoundBaseline = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: bound,
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "pre",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(revertedToBoundBaseline, {
    current: true,
    reason: "fingerprint_match",
  });
});

test("missing analysis is not current", () => {
  const result = evaluateAiAnalysisCurrentness({
    analysis: null,
    currentFingerprint: "abc",
    transcriptId: "t1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(result, { current: false, reason: "missing_analysis" });
});

test("older-transcript warning is not presented after the analysis is already non-current", () => {
  assert.equal(
    shouldPresentAnalysisFromOlderTranscript({
      isFacilitator: true,
      analysisCurrent: false,
      analysisOutdated: true,
    }),
    false,
  );
  assert.equal(
    shouldPresentAnalysisFromOlderTranscript({
      isFacilitator: true,
      analysisCurrent: true,
      analysisOutdated: true,
    }),
    true,
  );
});
