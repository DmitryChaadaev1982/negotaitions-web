import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  resolvePublishedTranscriptRefreshObligation,
  shouldReloadPublishedTranscript,
  shouldShowDurableEnhancementProgress,
} from "@/lib/post-processing/enhancement-ux-presentation";
import { shouldSyncSpeakerMappingDraft } from "@/lib/transcription/speaker-mapping-draft-sync";
import { getTranscriptionSectionRefreshKey } from "@/lib/transcription/transcription-section-key";

test("EVAL-PP-ENH-MOUNTED-RUNNING-COMPLETED: section identity survives status transition", () => {
  const runningKey = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    processingStage: "ready",
    enhancementStatus: "IN_PROGRESS",
    diarizationStatus: "COMPLETED",
    speakerMappingRequired: true,
  });
  const completedKey = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    processingStage: "ready",
    enhancementStatus: "COMPLETED",
    diarizationStatus: "COMPLETED",
    speakerMappingRequired: false,
  });
  const continueKey = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    enhancementStatus: "SKIPPED",
  });
  assert.equal(runningKey, "rec:tr");
  assert.equal(completedKey, runningKey);
  assert.equal(continueKey, runningKey);
});

test("LAB27-05 section identity is unchanged after Skip", () => {
  const beforeSkip = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    enhancementStatus: "IN_PROGRESS",
  });
  const afterSkip = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    enhancementStatus: "SKIPPED",
  });
  assert.equal(beforeSkip, afterSkip);
});

test("REFRESH-02 section identity is unchanged after published hydration", () => {
  const before = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    enhancementStatus: "IN_PROGRESS",
  });
  const afterPublish = getTranscriptionSectionRefreshKey({
    sessionId: "sess",
    recordingId: "rec",
    transcriptId: "tr",
    enhancementStatus: "COMPLETED",
  });
  assert.equal(before, afterPublish);
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: {
        uiStatus: "COMPLETED",
        executionStatus: "COMPLETED",
        terminalQuality: "COMPLETED",
        publicationEligible: false,
      },
      hydratedSuccessfulPublication: false,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    true,
  );
});

test("progress polling does not reload published text when the canonical text is unchanged", () => {
  const ticks = [
    { completedChunks: 0, totalChunks: 7, text: "raw" },
    { completedChunks: 3, totalChunks: 7, text: "raw" },
    { completedChunks: 7, totalChunks: 7, text: "raw" },
  ];
  for (const tick of ticks) {
    assert.equal(
      shouldReloadPublishedTranscript({
        previousPublishedText: "raw",
        nextPublishedText: tick.text,
        lexicalEditAvailable: false,
        unsavedLegalLexicalEdit: false,
      }),
      false,
    );
    assert.equal(
      shouldShowDurableEnhancementProgress({
        executionStatus: "RUNNING",
        publicationEligible: true,
        progress: tick,
      }),
      true,
    );
  }
  assert.equal(
    shouldReloadPublishedTranscript({
      previousPublishedText: "raw",
      nextPublishedText: "enhanced published",
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    true,
  );
});

test("mapping draft is retained across same-generation enhancement status ticks", () => {
  assert.equal(
    shouldSyncSpeakerMappingDraft({
      currentTranscriptId: "tr",
      nextTranscriptId: "tr",
      isDirty: true,
    }),
    false,
  );
});

test("source contract: enhancement poll does not loadData or page-level loading", async () => {
  const section = await readFile(
    path.join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  assert.match(section, /shouldReloadPublishedTranscript/);
  assert.match(section, /resolvePublishedTranscriptRefreshObligation/);
  assert.match(section, /refreshPublishedTranscriptQuiet/);
  assert.match(section, /onPublishedTranscriptRefreshPending/);
  assert.match(section, /publicationHydration/);
  assert.match(section, /publishedRefreshObligation[\s\S]{0,500}setInterval/);
  assert.match(section, /data-mount-id/);
  assert.match(panel, /publishedTranscriptRefreshPending/);
  assert.match(
    panel,
    /shouldPoll[\s\S]{0,200}publishedTranscriptRefreshPending/,
  );
  assert.doesNotMatch(section, /enhancementWasRunningRef/);
  assert.doesNotMatch(
    section,
    /enhancementRunning[\s\S]{0,80}loadData\(\)/,
  );
  assert.match(panel, /getTranscriptionSectionRefreshKey/);
  assert.match(panel, /setStatusData\(data\)/);
  assert.doesNotMatch(panel, /setLoading\(/);
  assert.doesNotMatch(panel, /processingStage:[\s\S]{0,40}enhancementStatus/);
  assert.match(panel, /continue-transcript/);
  assert.match(panel, /resolveEnhancementStatusCopyKind/);
  assert.match(panel, /resolveAiWorkflowStepCopyKind/);
  assert.match(panel, /step-enhancement-status/);
  assert.match(panel, /step-ai-status/);
  assert.match(panel, /resolvePostProcessingRailTileTone/);
  assert.match(panel, /data-tone/);
  assert.match(panel, /skipEnhancement/);
  assert.doesNotMatch(section, /continue-with-current-transcript-button/);
  assert.match(section, /enhancementTranscriptLocalProgress/);
  assert.match(panel, /EnhancementStepStatusCopy/);
  assert.match(panel, /ai-analysis-transcript-quality-notice/);
  assert.doesNotMatch(
    panel,
    /handleContinueWithCurrentTranscript[\s\S]{0,400}publicationEligible:\s*false/,
  );
  const continueRoute = await readFile(
    path.join(process.cwd(), "app/api/sessions/[sessionId]/materials/continue-transcript/route.ts"),
    "utf8",
  );
  assert.match(continueRoute, /continueWithCurrentTranscript/);
  assert.match(continueRoute, /CONTINUE_WITH_CURRENT_TRANSCRIPT/);
});

test("INV-TE-11 facilitator notes are not locked by enhancement eligibility", async () => {
  const notesView = await readFile(
    path.join(process.cwd(), "components/account-session-materials-view.tsx"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  assert.doesNotMatch(notesView, /publicationEligible/);
  assert.doesNotMatch(panel, /materials-notes-textarea[\s\S]{0,400}publicationEligible/);
  assert.match(panel, /enhancement-ai-blocked-reason/);
  assert.match(panel, /enhancement-unsaved-lexical-ai-dialog/);
  assert.doesNotMatch(
    panel,
    /handleRunAiAnalysis[\s\S]{0,200}continue-transcript/,
  );
});
