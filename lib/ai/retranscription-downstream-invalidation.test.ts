import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateAiAnalysisCurrentness,
  shouldPresentAnalysisFromOlderTranscript,
} from "@/lib/ai/analysis-currentness";
import {
  MATERIAL_CHANGE_AI_ONLY_CONFIRMATION_MESSAGE,
  MATERIAL_CHANGE_CONFIRMATION_MESSAGE,
  MATERIAL_CHANGE_CONFIRMATION_REQUIRED,
  decideFacilitatorMaterialChangeGuard,
} from "@/lib/ai/material-input-invalidation";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const OLD_GENERATION = {
  inputFingerprint: "gen0-hash",
  transcriptId: "transcript-1",
  transcriptRetranscribeCount: 0,
};

function afterRetranscribeCurrentness(fingerprint: string | null = OLD_GENERATION.inputFingerprint) {
  return evaluateAiAnalysisCurrentness({
    analysis: {
      ...OLD_GENERATION,
      inputFingerprint: fingerprint,
    },
    currentFingerprint: fingerprint,
    transcriptId: OLD_GENERATION.transcriptId,
    transcriptRetranscribeCount: 1,
  });
}

test("RT01 current published AI becomes non-current at the retranscription generation boundary", () => {
  const before = evaluateAiAnalysisCurrentness({
    analysis: OLD_GENERATION,
    currentFingerprint: OLD_GENERATION.inputFingerprint,
    transcriptId: OLD_GENERATION.transcriptId,
    transcriptRetranscribeCount: 0,
  });
  assert.equal(before.current, true);

  const after = afterRetranscribeCurrentness();
  assert.deepEqual(after, { current: false, reason: "generation_mismatch" });

  const mappingSave = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: after.current,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.deepEqual(mappingSave, { allow: true, revokePublication: false });

  const claimSource = readFileSync(
    join(ROOT, "lib/services/transcription-run-claim.ts"),
    "utf8",
  );
  assert.match(claimSource, /revokeActiveAiAnalysisPublicationInTransaction/);
  assert.match(ru.recording.rerunTranscriptionConfirmBody, /потребуется запустить заново/);
  assert.doesNotMatch(ru.recording.rerunTranscriptionConfirmBody, /может потребоваться/);
  assert.doesNotMatch(en.recording.rerunTranscriptionConfirmBody, /may be required/i);
  assert.match(en.recording.rerunTranscriptionConfirmBody, /will need to be run again/);
  assert.match(ru.recording.rerunTranscriptionConfirmBody, /публикация будет отозвана/);
});

test("RT02 unpublished current AI is still non-current after retranscription and copy is definite", () => {
  const after = afterRetranscribeCurrentness();
  assert.equal(after.current, false);
  assert.doesNotMatch(ru.sessionMaterials.rerunTranscriptionConfirmBody, /может потребоваться/);
  assert.doesNotMatch(en.sessionMaterials.rerunTranscriptionConfirmBody, /may be required/i);
});

test("RT03 retranscription without AI does not invent an invalidation warning", () => {
  const missing = evaluateAiAnalysisCurrentness({
    analysis: null,
    currentFingerprint: null,
    transcriptId: "transcript-1",
    transcriptRetranscribeCount: 1,
  });
  assert.deepEqual(missing, { current: false, reason: "missing_analysis" });
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: null,
    runLeaseActive: false,
    analysisCurrent: false,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.deepEqual(decision, { allow: true, revokePublication: false });
});

test("RT04 new generation mapping save does not warn or revoke", () => {
  const after = afterRetranscribeCurrentness();
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: after.current,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.equal(decision.allow, true);
  if (decision.allow) {
    assert.equal(decision.revokePublication, false);
  }
});

test("RT05 new generation manual attribution save does not warn", () => {
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: false,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.deepEqual(decision, { allow: true, revokePublication: false });
});

test("RT06 new generation transcript correction does not warn", () => {
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: "NOT_STARTED",
    runLeaseActive: false,
    analysisCurrent: false,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.deepEqual(decision, { allow: true, revokePublication: false });
});

test("RT07 new current published AI requires a site-styled warning and revoke on confirm", () => {
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
    assert.equal(blocked.error, MATERIAL_CHANGE_CONFIRMATION_MESSAGE);
    assert.equal(blocked.willRevokePublication, true);
  }
  const confirmed = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: true,
    confirmRewindPublication: true,
  });
  assert.deepEqual(confirmed, { allow: true, revokePublication: true });
});

test("RT08 new current unpublished AI warns without claiming publication revoke", () => {
  const blocked = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.equal(blocked.allow, false);
  if (!blocked.allow) {
    assert.equal(blocked.error, MATERIAL_CHANGE_AI_ONLY_CONFIRMATION_MESSAGE);
    assert.equal(blocked.willRevokePublication, false);
  }
  assert.doesNotMatch(en.recording.materialChangeAiOnlyWarning, /publication will be revoked/i);
  assert.doesNotMatch(ru.recording.materialChangeAiOnlyWarning, /публикация будет отозвана/);
});

test("RT09 historical NULL-fingerprint AI is invalidated once by retranscription", () => {
  const before = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: null,
      transcriptId: "transcript-1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "unused",
    transcriptId: "transcript-1",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(before, { current: true, reason: "legacy_current" });

  const after = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: null,
      transcriptId: "transcript-1",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "unused",
    transcriptId: "transcript-1",
    transcriptRetranscribeCount: 1,
  });
  assert.deepEqual(after, { current: false, reason: "legacy_stale" });

  const laterMapping = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: after.current,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.deepEqual(laterMapping, { allow: true, revokePublication: false });
});

test("RT10 active presentation does not keep the older-transcript warning after rewind", () => {
  assert.equal(
    shouldPresentAnalysisFromOlderTranscript({
      isFacilitator: true,
      analysisCurrent: false,
      analysisOutdated: true,
    }),
    false,
  );
  const statusSource = readFileSync(
    join(ROOT, "app/api/sessions/[sessionId]/materials/status/route.ts"),
    "utf8",
  );
  assert.match(statusSource, /shouldPresentAnalysisFromOlderTranscript/);
});

test("RT11 room Debrief and Materials share the canonical materials/status presentation flag", () => {
  const panel = readFileSync(
    join(ROOT, "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  const dashboard = readFileSync(
    join(ROOT, "components/session-materials-dashboard.tsx"),
    "utf8",
  );
  assert.match(panel, /analysisFromOlderTranscript/);
  assert.match(dashboard, /analysisFromOlderTranscript/);
  assert.doesNotMatch(panel, /analysisOutdated/);
  assert.doesNotMatch(dashboard, /analysisOutdated/);
});

test("RT12 legitimate material invalidation uses ConfirmDialog, not window.confirm", () => {
  const section = readFileSync(
    join(ROOT, "components/recording-transcription-section.tsx"),
    "utf8",
  );
  assert.doesNotMatch(section, /window\.confirm/);
  assert.match(section, /ConfirmDialog/);
  assert.match(section, /material-change-confirm-dialog/);
  assert.match(section, /confirmRewindPublication: true/);
});
