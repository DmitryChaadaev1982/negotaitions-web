import assert from "node:assert/strict";
import test from "node:test";

import { ru } from "@/lib/i18n/dictionaries/ru";
import {
  buildTranscriptEnhancementPublication,
  digestPublishedSegmentText,
} from "@/lib/services/transcript-enhancement-publication";
import {
  clampEnhancementProgress,
  enhancementProgressIsNotPartial,
  isAiBlockedByEnhancementEligibility,
  isLexicalEditLockedByEnhancement,
  isSpeakerMappingLockedByEnhancement,
  resolveAiAnalysisTranscriptQualityNotice,
  resolveAiWorkflowStepCopyKind,
  enhancementStartActionCopyKey,
  resolveEnhancementStartActionKind,
  resolveEnhancementStatusCopyKind,
  resolveEnhancementUxState,
  authoritativeEnhancedPublicationRunIdFromMetadata,
  resolveSkippedEnhancementCopyVariant,
  skippedEnhancementBodyKey,
  skippedEnhancementHeadlineKey,
  resolvePublishedTranscriptKind,
  countSegmentEnhancementProvenance,
  resolveSegmentEnhancementProvenance,
  resolveTurnEnhancementProvenance,
  isSuccessfulAtomicPublication,
  resolvePublishedTranscriptRefreshObligation,
  shouldReloadPublishedTranscript,
  shouldShowDurableEnhancementProgress,
  shouldShowSkipEnhancementAction,
} from "@/lib/post-processing/enhancement-ux-presentation";

test("k/n RUNNING is not terminal PARTIAL and clamps impossible counts", () => {
  const running = resolveEnhancementUxState({
    uiStatus: "IN_PROGRESS",
    executionStatus: "RUNNING",
    publicationEligible: true,
    progress: { completedChunks: 3, totalChunks: 7 },
  });
  assert.equal(running, "ENHANCEMENT_RUNNING");
  assert.equal(enhancementProgressIsNotPartial(running), true);
  assert.deepEqual(
    clampEnhancementProgress({ completedChunks: 9, totalChunks: 7 }),
    { completed: 7, total: 7 },
  );
  assert.deepEqual(
    clampEnhancementProgress({ completedChunks: -2, totalChunks: 4 }),
    { completed: 0, total: 4 },
  );
  assert.equal(clampEnhancementProgress({ completedChunks: 1, totalChunks: 0 }), null);
  assert.equal(
    shouldShowDurableEnhancementProgress({
      uiStatus: "IN_PROGRESS",
      executionStatus: "RUNNING",
      publicationEligible: true,
      progress: { completedChunks: 3, totalChunks: 7 },
    }),
    true,
  );
});

test("leftover previous-generation COMPLETED enhancement is not current UX", () => {
  assert.equal(
    resolveEnhancementUxState({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      terminalQuality: "COMPLETED",
      transcriptionStage: "ready",
      currentForGeneration: false,
    }),
    "IDLE",
  );
});

test("historical timeout rows do not invent durable progress", () => {
  const historical = resolveEnhancementUxState({
    uiStatus: "SKIPPED",
    skipReason: "timeout",
    publicationEligible: false,
    progress: { completedChunks: 0, totalChunks: 0 },
  });
  assert.equal(historical, "ENHANCEMENT_HISTORICAL_TIMEOUT");
  assert.equal(
    shouldShowDurableEnhancementProgress({
      uiStatus: "SKIPPED",
      skipReason: "timeout",
      publicationEligible: false,
      progress: { completedChunks: 0, totalChunks: 0 },
    }),
    false,
  );
});

test("LAB27-01 RUNNING eligible projects running copy with Skip, not skipped", () => {
  const input = {
    uiStatus: "IN_PROGRESS",
    executionStatus: "RUNNING" as const,
    publicationEligible: true,
    terminalQuality: null,
    cancelReason: null,
    progress: { completedChunks: 2, totalChunks: 7 },
  };
  assert.equal(resolveEnhancementUxState(input), "ENHANCEMENT_RUNNING");
  assert.equal(resolveEnhancementStatusCopyKind(input), "in_progress");
  assert.equal(shouldShowSkipEnhancementAction(input), true);
  assert.equal(isAiBlockedByEnhancementEligibility(input), true);
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(input), "none");
});

test("RUNNING publicationEligible locks lexical/AI and leaves mapping usable", () => {
  const input = {
    uiStatus: "IN_PROGRESS",
    executionStatus: "RUNNING",
    publicationEligible: true,
  };
  assert.equal(isLexicalEditLockedByEnhancement(input), true);
  assert.equal(isAiBlockedByEnhancementEligibility(input), true);
  assert.equal(isSpeakerMappingLockedByEnhancement(), false);
});

test("Continue leftover RUNNING is ineligible and does not show publishable progress", () => {
  const state = resolveEnhancementUxState({
    uiStatus: "IN_PROGRESS",
    executionStatus: "RUNNING",
    publicationEligible: false,
    cancelReason: "continue_with_current",
    progress: { completedChunks: 2, totalChunks: 7 },
  });
  assert.equal(state, "ENHANCEMENT_RUNNING_INELIGIBLE");
  assert.equal(
    shouldShowDurableEnhancementProgress({
      uiStatus: "IN_PROGRESS",
      executionStatus: "RUNNING",
      publicationEligible: false,
      progress: { completedChunks: 2, totalChunks: 7 },
    }),
    false,
  );
  assert.equal(
    resolveEnhancementUxState({
      executionStatus: "CANCELLED_FOR_PUBLICATION",
      publicationEligible: false,
      cancelReason: "continue_with_current",
    }),
    "ENHANCEMENT_CONTINUED",
  );
});

test("permanent failure while leftover RUNNING is ineligible, not PARTIAL", () => {
  const state = resolveEnhancementUxState({
    executionStatus: "RUNNING",
    publicationEligible: false,
    progress: {
      completedChunks: 4,
      totalChunks: 7,
      permanentFailedChunks: 1,
    },
  });
  assert.equal(state, "ENHANCEMENT_RUNNING_INELIGIBLE");
  assert.equal(
    shouldShowDurableEnhancementProgress({
      executionStatus: "RUNNING",
      publicationEligible: false,
      progress: {
        completedChunks: 4,
        totalChunks: 7,
        permanentFailedChunks: 1,
      },
    }),
    false,
  );
});

test("terminal PARTIAL is quality, not a k/n RUNNING label", () => {
  assert.equal(
    resolveEnhancementUxState({
      executionStatus: "COMPLETED",
      terminalQuality: "PARTIAL",
      publicationEligible: false,
      uiStatus: "PARTIAL",
    }),
    "ENHANCEMENT_TERMINAL_PARTIAL",
  );
});

test("published kind is enhanced only after completed publication", () => {
  assert.equal(
    resolvePublishedTranscriptKind({
      uiStatus: "IN_PROGRESS",
      publicationEligible: true,
    }),
    "raw",
  );
  assert.equal(
    resolvePublishedTranscriptKind({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      terminalQuality: "COMPLETED",
      publicationEligible: false,
    }),
    "enhanced",
  );
  assert.equal(
    resolvePublishedTranscriptKind({
      uiStatus: "PARTIAL",
      terminalQuality: "PARTIAL",
      publicationEligible: false,
    }),
    "raw",
  );
  assert.equal(
    resolveTurnEnhancementProvenance({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      terminalQuality: "COMPLETED",
      publicationEligible: false,
    }),
    "applied",
  );
  assert.equal(
    resolveTurnEnhancementProvenance({
      uiStatus: "IN_PROGRESS",
      publicationEligible: true,
      progress: { completedChunks: 3, totalChunks: 7 },
    }),
    "raw",
  );
  assert.equal(
    resolveTurnEnhancementProvenance({
      uiStatus: "PARTIAL",
      terminalQuality: "PARTIAL",
      publicationEligible: false,
    }),
    "raw",
  );
});

test("Step 2 copy/action matrix and AI quality notice", () => {
  const notStarted = {
    uiStatus: "NOT_STARTED",
    executionStatus: "NOT_STARTED",
    publicationEligible: false,
  };
  const queued = {
    uiStatus: "QUEUED",
    executionStatus: "QUEUED",
    publicationEligible: true,
  };
  const running = {
    uiStatus: "IN_PROGRESS",
    executionStatus: "RUNNING",
    publicationEligible: true,
    progress: { completedChunks: 2, totalChunks: 7 },
  };
  const completed = {
    uiStatus: "COMPLETED",
    executionStatus: "COMPLETED",
    terminalQuality: "COMPLETED",
    publicationEligible: false,
  };
  const failed = {
    uiStatus: "FAILED",
    executionStatus: "FAILED",
    terminalQuality: "FAILED",
    publicationEligible: false,
  };
  const partial = {
    uiStatus: "PARTIAL",
    executionStatus: "COMPLETED",
    terminalQuality: "PARTIAL",
    publicationEligible: false,
  };
  const skipped = {
    uiStatus: "SKIPPED",
    executionStatus: "CANCELLED_FOR_PUBLICATION",
    publicationEligible: false,
    cancelReason: "continue_with_current",
  };

  assert.equal(resolveEnhancementStatusCopyKind(notStarted), "not_started");
  assert.equal(shouldShowSkipEnhancementAction(notStarted), false);
  assert.equal(resolveAiWorkflowStepCopyKind(notStarted), "stage");
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(notStarted), "none");

  assert.equal(resolveEnhancementStatusCopyKind(queued), "in_progress");
  assert.equal(shouldShowSkipEnhancementAction(queued), true);
  assert.equal(resolveAiWorkflowStepCopyKind(queued), "blocked_by_enhancement");
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(queued), "none");

  assert.equal(resolveEnhancementStatusCopyKind(running), "in_progress");
  assert.equal(shouldShowSkipEnhancementAction(running), true);
  assert.equal(isAiBlockedByEnhancementEligibility(running), true);
  assert.equal(resolveAiWorkflowStepCopyKind(running), "blocked_by_enhancement");
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(running), "none");

  assert.equal(resolveEnhancementStatusCopyKind(completed), "completed");
  assert.equal(shouldShowSkipEnhancementAction(completed), false);
  assert.equal(resolveAiWorkflowStepCopyKind(completed), "stage");
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(completed), "none");
  assert.equal(resolveTurnEnhancementProvenance(completed), "applied");

  assert.equal(resolveEnhancementStatusCopyKind(failed), "failed");
  assert.equal(shouldShowSkipEnhancementAction(failed), false);
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(failed), "not_applied");
  assert.equal(resolveTurnEnhancementProvenance(failed), "raw");

  assert.equal(resolveEnhancementStatusCopyKind(partial), "partial");
  assert.equal(shouldShowSkipEnhancementAction(partial), false);
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(partial), "not_applied");
  assert.equal(resolveTurnEnhancementProvenance(partial), "raw");

  assert.equal(resolveEnhancementStatusCopyKind(skipped), "skipped");
  assert.equal(shouldShowSkipEnhancementAction(skipped), false);
  assert.equal(isAiBlockedByEnhancementEligibility(skipped), false);
  assert.equal(resolveAiWorkflowStepCopyKind(skipped), "stage");
  assert.equal(resolveAiAnalysisTranscriptQualityNotice(skipped), "skipped");
});

test("fresh NOT_STARTED uses start copy even when Improve would be available", () => {
  const freshSuggested = {
    uiStatus: "SUGGESTED",
    executionStatus: "NOT_STARTED",
    publicationEligible: false,
  };
  const freshIdle = {
    uiStatus: "IDLE",
    executionStatus: "NOT_STARTED",
    publicationEligible: false,
  };
  const freshNotStarted = {
    uiStatus: "NOT_STARTED",
    executionStatus: "NOT_STARTED",
    publicationEligible: false,
  };
  assert.equal(resolveEnhancementStartActionKind(freshSuggested), "start");
  assert.equal(resolveEnhancementStartActionKind(freshIdle), "start");
  assert.equal(resolveEnhancementStartActionKind(freshNotStarted), "start");
  assert.equal(
    enhancementStartActionCopyKey(freshSuggested),
    "sessionMaterials.runTranscriptEnhancement",
  );
  assert.equal(
    ru.sessionMaterials.runTranscriptEnhancement,
    "Запустить ИИ-улучшение",
  );
});

test("historical completed/failed/skipped Improve uses retry copy", () => {
  assert.equal(
    resolveEnhancementStartActionKind({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      terminalQuality: "COMPLETED",
      publicationEligible: false,
    }),
    "retry",
  );
  assert.equal(
    resolveEnhancementStartActionKind({
      uiStatus: "FAILED",
      executionStatus: "FAILED",
      terminalQuality: "FAILED",
      publicationEligible: false,
    }),
    "retry",
  );
  assert.equal(
    resolveEnhancementStartActionKind({
      uiStatus: "PARTIAL",
      executionStatus: "COMPLETED",
      terminalQuality: "PARTIAL",
      publicationEligible: false,
    }),
    "retry",
  );
  assert.equal(
    resolveEnhancementStartActionKind({
      uiStatus: "SKIPPED",
      executionStatus: "CANCELLED_FOR_PUBLICATION",
      publicationEligible: false,
      cancelReason: "continue_with_current",
    }),
    "retry",
  );
  assert.equal(
    resolveEnhancementStartActionKind({
      uiStatus: "SKIPPED",
      skipReason: "timeout",
      publicationEligible: false,
    }),
    "retry",
  );
  assert.equal(
    enhancementStartActionCopyKey({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      terminalQuality: "COMPLETED",
      publicationEligible: false,
    }),
    "sessionMaterials.retryTranscriptEnhancement",
  );
  assert.equal(
    ru.sessionMaterials.retryTranscriptEnhancement,
    "Повторить ИИ-улучшение",
  );
});

const publishedCompleted = {
  uiStatus: "COMPLETED",
  executionStatus: "COMPLETED",
  terminalQuality: "COMPLETED",
  publicationEligible: false,
} as const;

const publishedA = buildTranscriptEnhancementPublication({
  runId: "run-a",
  retranscribeCount: 4,
  inputIdentity: "identity-a",
  publishedAt: "2026-01-01T00:00:00.000Z",
  segments: [
    { orderIndex: 0, publishedText: "улучшенный текст", originalText: "исходный текст" },
    { orderIndex: 1, publishedText: "тот же текст", originalText: "тот же текст" },
    { orderIndex: 2, publishedText: "also changed", originalText: "raw" },
  ],
});

const publishedB = buildTranscriptEnhancementPublication({
  runId: "run-b",
  retranscribeCount: 4,
  inputIdentity: "identity-b",
  publishedAt: "2026-01-02T00:00:00.000Z",
  segments: [
    { orderIndex: 0, publishedText: "second enhance", originalText: "исходный текст" },
    { orderIndex: 1, publishedText: "тот же текст", originalText: "тот же текст" },
    { orderIndex: 2, publishedText: "also changed again", originalText: "raw" },
  ],
});

test("PROV-01 changed published lexical gets green AI provenance", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 0,
      publishedText: "улучшенный текст",
    }),
    "applied",
  );
});

test("PROV-02 identical published lexical gets no green AI provenance", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 1,
      publishedText: "тот же текст",
      rawText: "тот же текст",
    }),
    "raw",
  );
});

test("PROV-03 completed transcript can mix changed and unchanged segments", () => {
  const counts = countSegmentEnhancementProvenance({
    publication: publishedA,
    currentRetranscribeCount: 4,
    segments: [
      { orderIndex: 0, text: "улучшенный текст", rawText: "исходный текст" },
      { orderIndex: 1, text: "тот же текст", rawText: "тот же текст" },
      { orderIndex: 2, text: "also changed", rawText: "raw" },
    ],
  });
  assert.equal(counts.total, 3);
  assert.equal(counts.applied, 2);
  assert.equal(counts.raw, 1);
  assert.equal(resolveTurnEnhancementProvenance(publishedCompleted), "applied");
});

test("PROV-04 Skip does not mint green provenance from unpublished chunk results", () => {
  const skipped = {
    uiStatus: "SKIPPED",
    executionStatus: "CANCELLED_FOR_PUBLICATION",
    publicationEligible: false,
    cancelReason: "continue_with_current",
  };
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: null,
      currentRetranscribeCount: 0,
      orderIndex: 0,
      publishedText: "current raw",
      rawText: "current raw",
    }),
    "raw",
  );
  assert.equal(resolveTurnEnhancementProvenance(skipped), "raw");
});

test("PROV-05 missing run-input backup after manual lexical rewrite is not AI provenance", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 0,
      publishedText: "human edited text",
    }),
    "edited",
  );
});

test("PROV-RPT-01 Success A then Repeat B RUNNING keeps A-published segments green", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 0,
      publishedText: "улучшенный текст",
    }),
    "applied",
  );
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 1,
      publishedText: "тот же текст",
      rawText: "тот же текст",
    }),
    "raw",
  );
});

test("PROV-RPT-02 Success A then Repeat Skip keeps A provenance", () => {
  assert.equal(
    digestPublishedSegmentText("улучшенный текст"),
    publishedA.segmentDigestByOrderIndex["0"],
  );
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 2,
      publishedText: "also changed",
    }),
    "applied",
  );
});

test("PROV-RPT-03 Success A then Repeat FAILED keeps A provenance", () => {
  const counts = countSegmentEnhancementProvenance({
    publication: publishedA,
    currentRetranscribeCount: 4,
    segments: [
      { orderIndex: 0, text: "улучшенный текст", rawText: "исходный текст" },
      { orderIndex: 1, text: "тот же текст", rawText: "тот же текст" },
      { orderIndex: 2, text: "also changed", rawText: "raw" },
    ],
  });
  assert.equal(counts.applied, 2);
});

test("PROV-RPT-04 Success B switches publication provenance atomically", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedB,
      currentRetranscribeCount: 4,
      orderIndex: 0,
      publishedText: "second enhance",
    }),
    "applied",
  );
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedB,
      currentRetranscribeCount: 4,
      orderIndex: 0,
      publishedText: "улучшенный текст",
    }),
    "edited",
  );
});

test("PROV-RPT-05 Raw then first Improve Skip has no green", () => {
  const counts = countSegmentEnhancementProvenance({
    publication: null,
    currentRetranscribeCount: 0,
    segments: [
      { orderIndex: 0, text: "raw", rawText: "raw" },
      { orderIndex: 1, text: "still raw", rawText: "still raw" },
    ],
  });
  assert.equal(counts.applied, 0);
  assert.equal(counts.raw, 2);
});

test("PROV-RPT-06 human lexical edit on a published segment is not green", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 0,
      publishedText: "facilitator rewrite",
    }),
    "edited",
  );
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 4,
      orderIndex: 2,
      publishedText: "also changed",
    }),
    "applied",
  );
});

test("PROV-RPT-07 retranscription N+1 drops old generation provenance even if text matches", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 5,
      orderIndex: 0,
      publishedText: "улучшенный текст",
      rawText: "исходный текст",
    }),
    "edited",
  );
  assert.notEqual(
    resolveSegmentEnhancementProvenance({
      publication: publishedA,
      currentRetranscribeCount: 5,
      orderIndex: 0,
      publishedText: "улучшенный текст",
      rawText: "исходный текст",
    }),
    "applied",
  );
});

const runningEligible = {
  uiStatus: "IN_PROGRESS",
  executionStatus: "RUNNING",
  publicationEligible: true,
  terminalQuality: null,
} as const;

const recoveryOrStandardPublished = {
  uiStatus: "COMPLETED",
  executionStatus: "COMPLETED",
  terminalQuality: "COMPLETED",
  publicationEligible: false,
} as const;

test("REFRESH-01 RUNNING RAW does not hydrate; COMPLETED/published creates obligation", () => {
  assert.equal(isSuccessfulAtomicPublication(runningEligible), false);
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: runningEligible,
      hydratedSuccessfulPublication: false,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    false,
  );
  assert.equal(isSuccessfulAtomicPublication(recoveryOrStandardPublished), true);
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: recoveryOrStandardPublished,
      hydratedSuccessfulPublication: false,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    true,
  );
});

test("REFRESH-03 failed quiet refresh keeps obligation until hydrate succeeds", () => {
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: recoveryOrStandardPublished,
      hydratedSuccessfulPublication: false,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    true,
  );
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: recoveryOrStandardPublished,
      hydratedSuccessfulPublication: true,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    false,
  );
});

test("REFRESH-04 recovery completion uses the same publication obligation", () => {
  assert.equal(isSuccessfulAtomicPublication(recoveryOrStandardPublished), true);
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: recoveryOrStandardPublished,
      hydratedSuccessfulPublication: false,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    true,
  );
});

test("COPY-UX-03 skip wording keeps default copy without prior enhanced publication", () => {
  const skipped = {
    uiStatus: "SKIPPED",
    executionStatus: "CANCELLED_FOR_PUBLICATION" as const,
    publicationEligible: false,
    cancelReason: "continue_with_current" as const,
  };
  const copyKind = resolveEnhancementStatusCopyKind(skipped);
  const variant = resolveSkippedEnhancementCopyVariant({
    copyKind,
    authoritativeEnhancedPublicationRunId: authoritativeEnhancedPublicationRunIdFromMetadata({}),
  });
  assert.equal(copyKind, "skipped");
  assert.equal(variant, "default");
  assert.equal(skippedEnhancementHeadlineKey(variant), "sessionMaterials.enhancementStatusSkipped");
  assert.equal(
    skippedEnhancementBodyKey(variant),
    "sessionMaterials.enhancementStatusSkippedBody",
  );
  assert.equal(resolveEnhancementUxState(skipped), "ENHANCEMENT_CONTINUED");
  assert.equal(skipped.publicationEligible, false);
  assert.equal(skipped.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(resolvePublishedTranscriptKind(skipped), "raw");
});

test("COPY-UX-03 skip wording names retained prior enhanced publication", () => {
  const skipped = {
    uiStatus: "SKIPPED",
    executionStatus: "CANCELLED_FOR_PUBLICATION" as const,
    publicationEligible: false,
    cancelReason: "continue_with_current" as const,
  };
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-a",
    retranscribeCount: 0,
    inputIdentity: "identity-a",
    publishedAt: "2026-01-01T00:00:00.000Z",
    segments: [{ orderIndex: 0, publishedText: "улучшенный", originalText: "сырой" }],
  });
  const copyKind = resolveEnhancementStatusCopyKind(skipped);
  const variant = resolveSkippedEnhancementCopyVariant({
    copyKind,
    authoritativeEnhancedPublicationRunId: authoritativeEnhancedPublicationRunIdFromMetadata({
      transcriptEnhancementPublication: publication,
    }),
  });
  assert.equal(copyKind, "skipped");
  assert.equal(variant, "retaining_prior_publication");
  assert.equal(
    skippedEnhancementHeadlineKey(variant),
    "sessionMaterials.enhancementStatusSkippedRetainingPrior",
  );
  assert.equal(resolveEnhancementUxState(skipped), "ENHANCEMENT_CONTINUED");
  assert.equal(isSuccessfulAtomicPublication(skipped), false);
  assert.equal(resolvePublishedTranscriptKind(skipped), "raw");
  assert.equal(skipped.publicationEligible, false);
});

test("REFRESH-05 Skip / CANCELLED_FOR_PUBLICATION is not successful publication", () => {
  const skipped = {
    uiStatus: "SKIPPED",
    executionStatus: "CANCELLED_FOR_PUBLICATION",
    publicationEligible: false,
    cancelReason: "continue_with_current",
  };
  assert.equal(isSuccessfulAtomicPublication(skipped), false);
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: skipped,
      hydratedSuccessfulPublication: false,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    false,
  );
  assert.equal(
    isSuccessfulAtomicPublication({
      uiStatus: "PARTIAL",
      executionStatus: "COMPLETED",
      terminalQuality: "PARTIAL",
      publicationEligible: false,
    }),
    false,
  );
  assert.equal(
    isSuccessfulAtomicPublication({
      uiStatus: "FAILED",
      executionStatus: "FAILED",
      terminalQuality: "FAILED",
      publicationEligible: false,
    }),
    false,
  );
});

test("REFRESH-06 already-hydrated COMPLETED page does not keep a refresh obligation", () => {
  assert.equal(
    resolvePublishedTranscriptRefreshObligation({
      enhancement: recoveryOrStandardPublished,
      hydratedSuccessfulPublication: true,
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    false,
  );
  assert.equal(
    shouldReloadPublishedTranscript({
      previousPublishedText: "Добрый день. Мы готовы",
      nextPublishedText: "Добрый день. Мы готовы",
      lexicalEditAvailable: true,
      unsavedLegalLexicalEdit: false,
    }),
    false,
  );
});

test("published text reload is skipped for legal unsaved edits and identical text", () => {
  assert.equal(
    shouldReloadPublishedTranscript({
      previousPublishedText: "raw",
      nextPublishedText: "enhanced",
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    true,
  );
  assert.equal(
    shouldReloadPublishedTranscript({
      previousPublishedText: "raw",
      nextPublishedText: "raw",
      lexicalEditAvailable: false,
      unsavedLegalLexicalEdit: false,
    }),
    false,
  );
  assert.equal(
    shouldReloadPublishedTranscript({
      previousPublishedText: "raw",
      nextPublishedText: "newer",
      lexicalEditAvailable: true,
      unsavedLegalLexicalEdit: true,
    }),
    false,
  );
});
