import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decideLegacyNullFingerprintBindOnMaterialChange,
  evaluateAiAnalysisCurrentness,
  evaluateRecipientPublishedReportCurrentness,
  isPublishedAnalysisIdentityCurrent,
  isPublishedAnalysisVersionCurrent,
  projectMaterialsAiViewerCurrentnessFields,
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

test("REP-01 facilitator fields expose analysisCurrent and omit publishedReportCurrent", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: true,
    hasValidPublicationGrant: false,
    analysisCurrent: true,
    publicationAiAnalysisId: "a1",
    currentAnalysisId: "a1",
    publicationAnalysisVersion: 1,
    currentAnalysisVersion: 2,
  });
  assert.equal(fields.analysisCurrent, true);
  assert.equal(fields.publishedReportCurrent, undefined);
});

const matchingPublishedV1 = {
  publicationAiAnalysisId: "a1",
  currentAnalysisId: "a1",
  publicationAnalysisVersion: 1,
  currentAnalysisVersion: 1,
} as const;

test("REP-02 authorized participant published report is current outside retranscription", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: true,
    analysisCurrent: true,
    ...matchingPublishedV1,
  });
  assert.equal(fields.analysisCurrent, undefined);
  assert.equal(fields.publishedReportCurrent, true);
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      ...matchingPublishedV1,
    }),
    true,
  );
});

test("REP-03 authorized observer published report uses the same recipient-safe field", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: true,
    analysisCurrent: true,
    ...matchingPublishedV1,
  });
  assert.equal(fields.publishedReportCurrent, true);
  assert.equal(fields.analysisCurrent, undefined);
});

test("REP-04/05 recipients without a publication grant do not get a current published report", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: false,
    analysisCurrent: true,
    ...matchingPublishedV1,
  });
  assert.equal(fields.publishedReportCurrent, false);
  assert.equal(fields.analysisCurrent, undefined);
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: false,
      analysisCurrent: true,
      ...matchingPublishedV1,
    }),
    false,
  );
});

test("REP-06 revoked or non-current publication is not recipient-current", () => {
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: false,
      analysisCurrent: false,
      ...matchingPublishedV1,
    }),
    false,
  );
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: false,
      ...matchingPublishedV1,
    }),
    false,
  );
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: true,
    analysisCurrent: false,
    ...matchingPublishedV1,
  });
  assert.equal(fields.publishedReportCurrent, false);
});

test("recipient currentness never treats missing facilitator analysisCurrent as true", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: false,
    analysisCurrent: false,
  });
  assert.notEqual(fields.analysisCurrent, true);
  assert.equal(fields.publishedReportCurrent, false);
});

test("N01-01 participant current analysis v1 plus publication v1 plus grant is current", () => {
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      ...matchingPublishedV1,
    }),
    true,
  );
});

test("N01-02 observer current analysis v1 plus publication v1 plus grant is current", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: true,
    analysisCurrent: true,
    ...matchingPublishedV1,
  });
  assert.equal(fields.publishedReportCurrent, true);
  assert.equal(fields.analysisCurrent, undefined);
});

test("N01-03/04 publication v1 plus grant does not make private analysis v2 recipient-current", () => {
  const stalePublication = {
    publicationAiAnalysisId: "a1",
    currentAnalysisId: "a1",
    publicationAnalysisVersion: 1,
    currentAnalysisVersion: 2,
  };
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      ...stalePublication,
    }),
    false,
  );
  const observer = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: true,
    analysisCurrent: true,
    ...stalePublication,
  });
  assert.equal(observer.publishedReportCurrent, false);
});

test("N01-05 facilitator private v2 before publish remains facilitator-current", () => {
  const fields = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: true,
    hasValidPublicationGrant: true,
    analysisCurrent: true,
    publicationAiAnalysisId: "a1",
    currentAnalysisId: "a1",
    publicationAnalysisVersion: 1,
    currentAnalysisVersion: 2,
  });
  assert.equal(fields.analysisCurrent, true);
  assert.equal(fields.publishedReportCurrent, undefined);
});

test("N01-06/07 explicit publication v2 restores recipient currentness", () => {
  const publishedV2 = {
    publicationAiAnalysisId: "a1",
    currentAnalysisId: "a1",
    publicationAnalysisVersion: 2,
    currentAnalysisVersion: 2,
  };
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      ...publishedV2,
    }),
    true,
  );
  const observer = projectMaterialsAiViewerCurrentnessFields({
    isFacilitator: false,
    hasValidPublicationGrant: true,
    analysisCurrent: true,
    ...publishedV2,
  });
  assert.equal(observer.publishedReportCurrent, true);
});

test("N01-08 revoked or missing grant stays hidden", () => {
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: false,
      analysisCurrent: true,
      ...matchingPublishedV1,
    }),
    false,
  );
});

test("N01-09 publication.analysisVersion lower than current fails closed", () => {
  assert.equal(
    isPublishedAnalysisVersionCurrent({
      publicationAnalysisVersion: 1,
      currentAnalysisVersion: 2,
    }),
    false,
  );
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      publicationAiAnalysisId: "a1",
      currentAnalysisId: "a1",
      publicationAnalysisVersion: 1,
      currentAnalysisVersion: 2,
    }),
    false,
  );
});

test("N01-10 publication.analysisVersion higher or mismatched fails closed", () => {
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      publicationAiAnalysisId: "a1",
      currentAnalysisId: "a1",
      publicationAnalysisVersion: 3,
      currentAnalysisVersion: 2,
    }),
    false,
  );
  assert.equal(
    isPublishedAnalysisVersionCurrent({
      publicationAnalysisVersion: undefined,
      currentAnalysisVersion: 1,
    }),
    false,
  );
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
    }),
    false,
  );
});

test("N01-11 matching version with stale transcript generation is not current", () => {
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: false,
      ...matchingPublishedV1,
    }),
    false,
  );
});

test("N01-12 active retranscription keeps prior publication not current", () => {
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      transcriptionActive: true,
      ...matchingPublishedV1,
    }),
    false,
  );
});

test("N01-13 unpublished private analysis never becomes recipient-current", () => {
  assert.equal(
    isPublishedAnalysisIdentityCurrent({
      publicationAiAnalysisId: "a1",
      currentAnalysisId: "a2",
    }),
    false,
  );
  assert.equal(
    evaluateRecipientPublishedReportCurrentness({
      hasValidPublicationGrant: true,
      analysisCurrent: true,
      publicationAiAnalysisId: null,
      currentAnalysisId: "a1",
      publicationAnalysisVersion: 2,
      currentAnalysisVersion: 2,
    }),
    false,
  );
  const statusSource = readFileSync(
    "app/api/sessions/[sessionId]/materials/status/route.ts",
    "utf8",
  );
  assert.match(statusSource, /publicationAnalysisVersion: activePublication\?\.analysisVersion/);
  assert.match(statusSource, /currentAnalysisVersion: aiAnalysis\?\.analysisVersion/);
  assert.match(statusSource, /presentCurrentAnalysis = isFacilitator/);
  assert.match(statusSource, /viewerCurrentness\.publishedReportCurrent === true/);
  assert.match(statusSource, /isFacilitator && presentCurrentAnalysis/);
  assert.doesNotMatch(
    statusSource,
    /const presentCurrentAnalysis = analysisCurrent;/,
  );
});
