import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateAiAnalysisCurrentness, evaluateRecipientPublishedReportCurrentness } from "@/lib/ai/analysis-currentness";
import { ParticipantType } from "@/app/generated/prisma/client";
import {
  isEnhancementCurrentForTranscriptGeneration,
  resolveEnhancementUxState,
} from "@/lib/post-processing/enhancement-ux-presentation";
import { projectPostProcessingStages } from "@/lib/post-processing/projection";
import {
  acquireMaterialsStatusFetchTurn,
  applyAuthoritativeStatusAfterRetranscribe,
  beginMaterialsStatusObservation,
  createMaterialsStatusRequestAbort,
  detailedTranscriptHydrationAttemptKey,
  isActiveTranscriptGenerationStage,
  isDetailedTranscriptPayloadCurrent,
  isDetailedTranscriptPayloadLifecycleCurrent,
  isLocalTranscriptGenerationFenceActive,
  isSpeakerMappingPresentedCurrent,
  isTranscriptGenerationPresentationActive,
  observeThenRetranscribe,
  projectTranscriptGenerationUiCurrentness,
  resolveDetailedTranscriptGenerationPresentation,
  shouldApplyMaterialsStatusResponse,
  shouldHydrateDetailedTranscriptPayload,
  shouldObserveMaterialsStatus,
  shouldReleaseMaterialsStatusInFlightOwnership,
  shouldReleasePostRetranscriptionFence,
} from "@/lib/post-processing/transcript-generation-currentness";
import { resolveSpeakerReviewMode } from "@/lib/transcription/assisted-speaker-mapping";
import { getTranscriptionSectionRefreshKey } from "@/lib/transcription/transcription-section-key";

const buyer = { id: "buyer", type: ParticipantType.PARTICIPANT };
const seller = { id: "seller", type: ParticipantType.PARTICIPANT };

const completeConfirmedMapping: {
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string;
  segments: Array<{
    speakerLabel: string;
    mappedParticipantId: string | null;
    text: string;
  }>;
  participants: Array<{ id: string; type: typeof ParticipantType.PARTICIPANT }>;
} = {
  hasSpeakerDiarization: true,
  speakerMappingStatus: "CONFIRMED",
  segments: [
    { speakerLabel: "speaker_0", mappedParticipantId: "buyer", text: "Hello" },
    { speakerLabel: "speaker_1", mappedParticipantId: "seller", text: "Hi" },
  ],
  participants: [buyer, seller],
};

const readyProjectionInput = {
  recordingStage: "ready",
  transcriptStage: "ready",
  enhancementStatus: "COMPLETED",
  transcriptPresent: true,
  mappingInput: completeConfirmedMapping,
  aiStage: "ready",
  enhancementCurrentForGeneration: true,
};

function currentnessFromProjection(
  transcriptStage: string,
    extras: {
    localInitiationBusy?: boolean;
    enhancementCurrentForGeneration?: boolean;
    speakerMappingStatus?: string | null;
    analysisCurrent?: boolean;
    publishedReportCurrent?: boolean;
    mappingInput?: typeof completeConfirmedMapping;
    enhancementStatus?: string;
    aiStage?: string;
  } = {},
) {
  const projection = projectPostProcessingStages({
    ...readyProjectionInput,
    transcriptStage,
    enhancementStatus: extras.enhancementStatus ?? "COMPLETED",
    mappingInput: extras.mappingInput ?? completeConfirmedMapping,
    aiStage: extras.aiStage ?? "ready",
    enhancementCurrentForGeneration: extras.enhancementCurrentForGeneration,
  });
  return projectTranscriptGenerationUiCurrentness({
    transcriptionStage: transcriptStage,
    localInitiationBusy: extras.localInitiationBusy,
    enhancementSemantic: projection.stages.TRANSCRIPT_ENHANCEMENT.semantic,
    mappingSemantic: projection.stages.SPEAKER_MAPPING.semantic,
    aiSemantic: projection.stages.AI_ANALYSIS.semantic,
    enhancementCurrentForGeneration: extras.enhancementCurrentForGeneration,
    speakerMappingStatus:
      extras.speakerMappingStatus ?? extras.mappingInput?.speakerMappingStatus ?? "CONFIRMED",
    analysisCurrent: extras.analysisCurrent,
    publishedReportCurrent: extras.publishedReportCurrent,
  });
}

test("R1 local initiation immediately suppresses current downstream presentation", () => {
  const currentness = currentnessFromProjection("ready", {
    localInitiationBusy: true,
    enhancementCurrentForGeneration: true,
    analysisCurrent: true,
  });
  assert.equal(currentness.transcriptionActive, true);
  assert.equal(currentness.authoritativeTranscriptionActive, false);
  assert.equal(currentness.enhancementCurrent, false);
  assert.equal(currentness.mappingCurrent, false);
  assert.equal(currentness.mappingLocked, true);
  assert.equal(currentness.aiCurrent, false);
  assert.equal(currentness.enhancementSemantic, "pending");
  assert.equal(currentness.mappingSemantic, "pending");
  assert.equal(currentness.aiSemantic, "pending");
  assert.equal(
    resolveEnhancementUxState({
      uiStatus: "COMPLETED",
      retranscriptionLocked: true,
      transcriptionStage: "ready",
    }),
    "RETRANSCRIPTION_RUNNING",
  );
});

test("R2 pending POST plus authoritative active stage keeps downstream non-current", () => {
  const currentness = currentnessFromProjection("transcribing", {
    localInitiationBusy: true,
    enhancementCurrentForGeneration: false,
    analysisCurrent: true,
  });
  assert.equal(currentness.transcriptionActive, true);
  assert.equal(currentness.authoritativeTranscriptionActive, true);
  assert.equal(currentness.enhancementCurrent, false);
  assert.equal(currentness.mappingCurrent, false);
  assert.equal(currentness.aiCurrent, false);
});

test("R3 observation starts before the retranscription POST resolves", async () => {
  const order: string[] = [];
  let releasePost!: () => void;
  const post = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  const done = observeThenRetranscribe({
    observe() {
      beginMaterialsStatusObservation({
        forceStatusPolling() {
          order.push("observe");
        },
        fetchStatus() {
          order.push("fetch-status");
        },
      });
    },
    retranscribe() {
      order.push("post-start");
      return post;
    },
  });
  assert.deepEqual(order, ["observe", "fetch-status", "post-start"]);
  assert.equal(
    shouldObserveMaterialsStatus({
      serverShouldPoll: false,
      forcePollingActive: true,
      localTranscriptGenerationBusy: true,
    }),
    true,
  );
  releasePost();
  await done;
});

test("R4 observeThenRetranscribe does not emit a second retranscription request", async () => {
  let retranscribeCalls = 0;
  await observeThenRetranscribe({
    observe() {},
    retranscribe: async () => {
      retranscribeCalls += 1;
    },
  });
  assert.equal(retranscribeCalls, 1);
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(panel, /if \(rerunBusy \|\| awaitingAuthoritativePostRetranscriptionStatus\) \{\s*return;/);
  assert.match(panel, /observeThenRetranscribe\(/);
  assert.match(
    panel,
    /observeThenRetranscribe\([\s\S]*?materialsRetranscribePath\(sessionId\)/,
  );
  const dashboard = readFileSync("components/session-materials-dashboard.tsx", "utf8");
  assert.match(dashboard, /if \(rerunBusy \|\| awaitingAuthoritativePostRetranscriptionStatus\) \{\s*return;/);
  assert.match(
    dashboard,
    /observeThenRetranscribe\([\s\S]*?materialsRetranscribePath\(sessionId\)/,
  );
});

test("R5 after authoritative active stage currentness no longer depends only on rerunBusy", () => {
  const secondTab = currentnessFromProjection("queued", {
    localInitiationBusy: false,
    speakerMappingStatus: "CONFIRMED",
    analysisCurrent: true,
  });
  assert.equal(secondTab.localInitiationBusy, false);
  assert.equal(secondTab.authoritativeTranscriptionActive, true);
  assert.equal(secondTab.transcriptionActive, true);
  assert.equal(secondTab.mappingCurrent, false);
  assert.equal(secondTab.mappingLocked, true);
  assert.equal(secondTab.enhancementCurrent, false);
  assert.equal(secondTab.aiCurrent, false);
  assert.equal(
    isTranscriptGenerationPresentationActive({
      transcriptionStage: "queued",
      localInitiationBusy: false,
    }),
    true,
  );
});

test("M1 second/refreshed view with rerunBusy=false and transcriptionActive=true locks mapping", () => {
  assert.equal(
    isSpeakerMappingPresentedCurrent({
      transcriptionActive: true,
      speakerMappingStatus: "CONFIRMED",
    }),
    false,
  );
  assert.equal(
    resolveSpeakerReviewMode({
      speakerMappingStatus: "CONFIRMED",
      speakersCount: 2,
      isEditable: true,
      manualSpeakerModeEnabled: false,
      transcriptSource: "GENERATED",
      mappingReviewSkipped: false,
      transcriptionActive: true,
    }),
    "NONE",
  );
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(panel, /isLocked=\{generationCurrentness\.transcriptionActive\}/);
  assert.doesNotMatch(panel, /isLocked=\{rerunBusy\}/);
  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  assert.match(section, /transcriptGenerationActive/);
  assert.match(section, /canonicalTranscriptionStage/);
  assert.match(section, /data-mapping-current/);
  assert.match(section, /data-testid="prior-mapping-noncurrent"/);
});

test("M2 prior CONFIRMED mapping is not presented as current during retranscription", () => {
  const currentness = currentnessFromProjection("transcribing", {
    localInitiationBusy: false,
    speakerMappingStatus: "CONFIRMED",
  });
  assert.equal(currentness.mappingCurrent, false);
  assert.equal(currentness.mappingLocked, true);
  assert.equal(
    isSpeakerMappingPresentedCurrent({
      transcriptionActive: true,
      speakerMappingStatus: "CONFIRMED",
    }),
    false,
  );
});

test("M3 prior AUTO_SUGGESTED mapping is not presented as current during retranscription", () => {
  assert.equal(
    isSpeakerMappingPresentedCurrent({
      transcriptionActive: true,
      speakerMappingStatus: "AUTO_SUGGESTED",
    }),
    false,
  );
  assert.equal(
    resolveSpeakerReviewMode({
      speakerMappingStatus: "AUTO_SUGGESTED",
      speakersCount: 2,
      isEditable: true,
      manualSpeakerModeEnabled: false,
      transcriptSource: "GENERATED",
      mappingReviewSkipped: false,
      transcriptionActive: true,
    }),
    "NONE",
  );
  assert.equal(
    resolveSpeakerReviewMode({
      speakerMappingStatus: "AUTO_SUGGESTED",
      speakersCount: 2,
      isEditable: true,
      manualSpeakerModeEnabled: false,
      transcriptSource: "GENERATED",
      mappingReviewSkipped: false,
      transcriptionActive: false,
    }),
    "AUTO_APPLIED_NOTE",
  );
});

test("M4 after new transcript generation old mapping stays stale until new-generation mapping is valid", () => {
  const currentness = currentnessFromProjection("ready", {
    localInitiationBusy: false,
    enhancementCurrentForGeneration: false,
    speakerMappingStatus: "REQUIRED",
    mappingInput: {
      ...completeConfirmedMapping,
      speakerMappingStatus: "REQUIRED",
      segments: [
        { speakerLabel: "speaker_0", mappedParticipantId: null, text: "new raw" },
      ],
    },
    aiStage: "not_started",
    analysisCurrent: false,
  });
  assert.equal(currentness.transcriptionActive, false);
  assert.equal(currentness.enhancementCurrent, false);
  assert.equal(currentness.mappingCurrent, false);
  assert.equal(currentness.mappingSemantic, "action_required");
  assert.equal(currentness.aiCurrent, false);
});

test("M5 ordinary non-retranscription page mapping behavior is unchanged", () => {
  const currentness = currentnessFromProjection("ready", {
    localInitiationBusy: false,
    enhancementCurrentForGeneration: true,
    speakerMappingStatus: "CONFIRMED",
    analysisCurrent: true,
  });
  assert.equal(currentness.transcriptionActive, false);
  assert.equal(currentness.mappingCurrent, true);
  assert.equal(currentness.mappingLocked, false);
  assert.equal(currentness.enhancementCurrent, true);
  assert.equal(currentness.aiCurrent, true);
  assert.equal(currentness.mappingSemantic, "ready");
});

test("cross-surface: one authoritative active stage yields consistent currentness", () => {
  const currentness = currentnessFromProjection("downloading", {
    localInitiationBusy: false,
    speakerMappingStatus: "AUTO_SUGGESTED",
    analysisCurrent: true,
  });
  assert.equal(currentness.transcriptionSemantic, "running");
  assert.equal(currentness.enhancementSemantic, "pending");
  assert.equal(currentness.mappingSemantic, "pending");
  assert.equal(currentness.aiSemantic, "pending");
  assert.equal(currentness.enhancementCurrent, false);
  assert.equal(currentness.mappingCurrent, false);
  assert.equal(currentness.aiCurrent, false);
  assert.equal(
    resolveEnhancementUxState({
      uiStatus: "COMPLETED",
      transcriptionStage: "downloading",
    }),
    "TRANSCRIPTION_RUNNING",
  );
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  const dashboard = readFileSync("components/session-materials-dashboard.tsx", "utf8");
  assert.match(panel, /projectTranscriptGenerationUiCurrentness\(/);
  assert.match(dashboard, /projectTranscriptGenerationUiCurrentness\(/);
  assert.match(section, /isActiveTranscriptGenerationStage\(/);
  assert.doesNotMatch(
    panel,
    /\["queued", "downloading", "compressing", "transcribing"\]/,
  );
});

test("post-retranscription generation fences prevent stale-green restoration", () => {
  const currentness = currentnessFromProjection("ready", {
    localInitiationBusy: false,
    enhancementCurrentForGeneration: false,
    speakerMappingStatus: "REQUIRED",
    mappingInput: {
      ...completeConfirmedMapping,
      speakerMappingStatus: "REQUIRED",
      segments: [
        { speakerLabel: "speaker_0", mappedParticipantId: null, text: "new raw" },
      ],
    },
    analysisCurrent: false,
    aiStage: "not_started",
  });
  assert.equal(currentness.transcriptionActive, false);
  assert.equal(currentness.enhancementSemantic, "pending");
  assert.equal(currentness.enhancementCurrent, false);
  assert.equal(currentness.aiCurrent, false);
  assert.equal(
    resolveEnhancementUxState({
      uiStatus: "COMPLETED",
      transcriptionStage: "ready",
      currentForGeneration: false,
    }),
    "IDLE",
  );
  assert.equal(
    evaluateAiAnalysisCurrentness({
      analysis: {
        inputFingerprint: "gen0",
        transcriptId: "t1",
        transcriptRetranscribeCount: 0,
      },
      currentFingerprint: "gen0",
      transcriptId: "t1",
      transcriptRetranscribeCount: 1,
    }).current,
    false,
  );
});

test("initial transcription uses pending waiting semantics without stale previous-generation copy", () => {
  const currentness = projectTranscriptGenerationUiCurrentness({
    transcriptionStage: "queued",
    localInitiationBusy: true,
    enhancementSemantic: "pending",
    mappingSemantic: "pending",
    aiSemantic: "pending",
    speakerMappingStatus: null,
    analysisCurrent: false,
  });
  assert.equal(currentness.transcriptionActive, true);
  assert.equal(currentness.enhancementCurrent, false);
  assert.equal(currentness.mappingCurrent, false);
  assert.equal(currentness.aiCurrent, false);
  assert.equal(
    resolveEnhancementUxState({
      transcriptionStage: "queued",
      uiStatus: "NOT_STARTED",
    }),
    "TRANSCRIPTION_RUNNING",
  );
});

test("Repeat Improve is not treated as retranscription activity", () => {
  const currentness = currentnessFromProjection("ready", {
    localInitiationBusy: false,
    enhancementCurrentForGeneration: true,
    enhancementStatus: "IN_PROGRESS",
    aiStage: "not_started",
    analysisCurrent: true,
  });
  assert.equal(currentness.transcriptionActive, false);
  assert.equal(currentness.enhancementSemantic, "running");
  assert.equal(currentness.mappingCurrent, true);
  assert.equal(
    isActiveTranscriptGenerationStage("enhancing"),
    false,
  );
  assert.equal(
    isEnhancementCurrentForTranscriptGeneration({
      jobRetranscribeCount: 1,
      currentRetranscribeCount: 1,
    }),
    true,
  );
});

test("shared helper is the only transcript-generation active-stage definition", () => {
  const projection = readFileSync("lib/post-processing/projection.ts", "utf8");
  const currentness = readFileSync(
    "lib/post-processing/transcript-generation-currentness.ts",
    "utf8",
  );
  const enhancement = readFileSync(
    "lib/post-processing/enhancement-ux-presentation.ts",
    "utf8",
  );
  assert.match(projection, /export function isActiveTranscriptGenerationStage/);
  assert.match(currentness, /export \{ isActiveTranscriptGenerationStage \}/);
  assert.match(enhancement, /isActiveTranscriptGenerationStage/);
  assert.doesNotMatch(
    enhancement,
    /\["queued", "downloading", "compressing", "transcribing"\]/,
  );
});

test("DET-01 CONFIRMED mapping during active retranscription is not presented as current", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: true,
    speakerMappingStatus: "CONFIRMED",
  });
  assert.equal(detailed.presentMappedParticipantNames, false);
  assert.equal(detailed.presentSegmentProvenanceDecoration, false);
});

test("DET-02 AUTO_SUGGESTED mapping during active retranscription is not presented as current", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
  });
  assert.equal(detailed.presentMappedParticipantNames, false);
  assert.equal(detailed.presentSegmentProvenanceDecoration, false);
});

test("DET-03/04 prior provenance decoration is suppressed while transcription is active", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: true,
    speakerMappingStatus: "CONFIRMED",
  });
  assert.equal(detailed.presentSegmentProvenanceDecoration, false);
  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  assert.match(section, /resolveDetailedTranscriptGenerationPresentation\(/);
  assert.match(section, /presentMappedParticipantNames/);
  assert.match(section, /presentSegmentProvenanceDecoration/);
  assert.match(section, /turn\.enhancementProvenance \?/);
});

test("DET-05 same-generation ready mapping and provenance remain ordinary", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
  });
  assert.equal(detailed.presentMappedParticipantNames, true);
  assert.equal(detailed.presentSegmentProvenanceDecoration, true);
  const autoSuggested = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "AUTO_SUGGESTED",
  });
  assert.equal(autoSuggested.presentMappedParticipantNames, true);
});

test("DET-06 old mapping does not reappear as current after active ends with generation mismatch", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "REQUIRED",
  });
  assert.equal(detailed.presentMappedParticipantNames, false);
  assert.equal(detailed.presentSegmentProvenanceDecoration, true);
  const currentness = currentnessFromProjection("ready", {
    localInitiationBusy: false,
    enhancementCurrentForGeneration: false,
    speakerMappingStatus: "REQUIRED",
    mappingInput: {
      ...completeConfirmedMapping,
      speakerMappingStatus: "REQUIRED",
      segments: [
        { speakerLabel: "speaker_0", mappedParticipantId: null, text: "new raw" },
      ],
    },
    analysisCurrent: false,
    aiStage: "not_started",
  });
  assert.equal(currentness.transcriptionActive, false);
  assert.equal(currentness.mappingCurrent, false);
});

test("REP-01 facilitator current analysisCurrent remains the facilitator currentness source", () => {
  const currentness = currentnessFromProjection("ready", {
    analysisCurrent: true,
  });
  assert.equal(currentness.aiCurrent, true);
  const statusSource = readFileSync(
    "app/api/sessions/[sessionId]/materials/status/route.ts",
    "utf8",
  );
  assert.match(statusSource, /projectMaterialsAiViewerCurrentnessFields\(/);
  assert.match(statusSource, /viewerCurrentness\.analysisCurrent/);
  assert.match(statusSource, /publishedReportCurrent: viewerCurrentness\.publishedReportCurrent/);
});

test("REP-02/03 recipient publishedReportCurrent shows authorized current reports", () => {
  const participant = currentnessFromProjection("ready", {
    publishedReportCurrent: true,
  });
  assert.equal(participant.aiCurrent, true);
  const observer = currentnessFromProjection("ready", {
    publishedReportCurrent: true,
  });
  assert.equal(observer.aiCurrent, true);
  const dashboard = readFileSync("components/session-materials-dashboard.tsx", "utf8");
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(dashboard, /publishedReportCurrent: liveData\?\.aiAnalysis\?\.publishedReportCurrent/);
  assert.match(panel, /publishedReportCurrent: ai\?\.publishedReportCurrent/);
});

test("REP-04/05 missing publishedReportCurrent does not treat undefined analysisCurrent as true", () => {
  const hidden = currentnessFromProjection("ready", {});
  assert.equal(hidden.aiCurrent, false);
  const explicitFalse = projectTranscriptGenerationUiCurrentness({
    transcriptionStage: "ready",
    enhancementSemantic: "ready",
    mappingSemantic: "ready",
    aiSemantic: "ready",
    speakerMappingStatus: "CONFIRMED",
    analysisCurrent: undefined,
    publishedReportCurrent: false,
  });
  assert.equal(explicitFalse.aiCurrent, false);
});

test("REP-07 authorized prior-generation report is not current during active retranscription", () => {
  const currentness = currentnessFromProjection("transcribing", {
    localInitiationBusy: false,
    publishedReportCurrent: true,
    analysisCurrent: true,
  });
  assert.equal(currentness.transcriptionActive, true);
  assert.equal(currentness.aiCurrent, false);
});

test("REP-08 after new generation old recipient report stays stale until a valid publication exists", () => {
  const currentness = currentnessFromProjection("ready", {
    publishedReportCurrent: false,
    analysisCurrent: false,
    aiStage: "not_started",
  });
  assert.equal(currentness.transcriptionActive, false);
  assert.equal(currentness.aiCurrent, false);
});

test("REF-01 local fence stays active while the POST is pending", () => {
  assert.equal(
    isLocalTranscriptGenerationFenceActive({
      requestBusy: true,
      awaitingAuthoritativePostRetranscriptionStatus: true,
    }),
    true,
  );
  assert.equal(
    shouldReleasePostRetranscriptionFence({
      appliedStatusRequestId: null,
      statusRequestSeqAtPostCompletion: 4,
    }),
    false,
  );
});

test("REF-02 POST resolve before the first interval poll still keeps the local fence", () => {
  assert.equal(
    isLocalTranscriptGenerationFenceActive({
      requestBusy: false,
      awaitingAuthoritativePostRetranscriptionStatus: true,
    }),
    true,
  );
  assert.equal(
    shouldReleasePostRetranscriptionFence({
      appliedStatusRequestId: 4,
      statusRequestSeqAtPostCompletion: 4,
    }),
    false,
  );
});

test("REF-03 exclusive post-response status apply releases the fence only after success", async () => {
  const order: string[] = [];
  await observeThenRetranscribe({
    observe() {
      order.push("observe");
    },
    retranscribe: async () => {
      order.push("post");
    },
  });
  const applied = await applyAuthoritativeStatusAfterRetranscribe({
    statusRequestSeqAtPostCompletion: 4,
    applyAuthoritativeStatus: async () => {
      order.push("apply");
      return { appliedStatusRequestId: 5 };
    },
  });
  assert.deepEqual(order, ["observe", "post", "apply"]);
  assert.equal(applied.authoritativeStatusApplied, true);
  const dashboard = readFileSync("components/session-materials-dashboard.tsx", "utf8");
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(dashboard, /applyAuthoritativeStatusAfterRetranscribe\(/);
  assert.match(panel, /applyAuthoritativeStatusAfterRetranscribe\(/);
  assert.match(dashboard, /fetchStatus\(\{ exclusive: true \}\)/);
  assert.match(panel, /fetchStatus\(\{ exclusive: true \}\)/);
});

test("REF-04/05 failed final refresh fails closed and later poll can release", async () => {
  const failed = await applyAuthoritativeStatusAfterRetranscribe({
    statusRequestSeqAtPostCompletion: 8,
    applyAuthoritativeStatus: async () => ({ appliedStatusRequestId: null }),
  });
  assert.equal(failed.authoritativeStatusApplied, false);
  assert.equal(
    isLocalTranscriptGenerationFenceActive({
      requestBusy: false,
      awaitingAuthoritativePostRetranscriptionStatus: true,
    }),
    true,
  );
  assert.equal(
    shouldReleasePostRetranscriptionFence({
      appliedStatusRequestId: 9,
      statusRequestSeqAtPostCompletion: 8,
    }),
    true,
  );
});

test("REF-07/08 exclusive status turns do not start a second retranscription POST", async () => {
  let retranscribeCalls = 0;
  let inFlight = false;
  await observeThenRetranscribe({
    observe() {},
    retranscribe: async () => {
      retranscribeCalls += 1;
    },
  });
  const first = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: true,
  });
  assert.equal(first, true);
  assert.equal(inFlight, true);
  const skippedPoll = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: false,
  });
  assert.equal(skippedPoll, false);
  inFlight = false;
  assert.equal(retranscribeCalls, 1);
  const dashboard = readFileSync("components/session-materials-dashboard.tsx", "utf8");
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.equal(dashboard.split("materialsRetranscribePath(sessionId)").length - 1, 1);
  assert.equal(panel.split("materialsRetranscribePath(sessionId)").length - 1, 1);
});

test("N02-01 old detailed payload stays non-current during active retranscription toward a new generation", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: true,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 1,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(detailed.presentMappedParticipantNames, false);
  assert.equal(detailed.presentSegmentProvenanceDecoration, false);
  assert.equal(detailed.detailedPayloadCurrent, false);
});

test("N02-02 active ending with stale detailed payload remains fenced", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 1,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(detailed.presentMappedParticipantNames, false);
  assert.equal(detailed.presentSegmentProvenanceDecoration, false);
  assert.equal(detailed.detailedPayloadCurrent, false);
});

test("N02-03 identical transcript text does not release a generation mismatch", () => {
  assert.equal(
    isDetailedTranscriptPayloadCurrent({
      payloadRetranscribeCount: 1,
      authoritativeRetranscribeCount: 2,
    }),
    false,
  );
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 1,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(detailed.presentMappedParticipantNames, false);
});

test("N02-04 same transcript ID still detects generation mismatch", () => {
  const first = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
    retranscribeCount: 1,
  });
  const second = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
    retranscribeCount: 2,
  });
  assert.notEqual(first, second);
  assert.equal(
    isDetailedTranscriptPayloadCurrent({
      payloadRetranscribeCount: 1,
      authoritativeRetranscribeCount: 2,
    }),
    false,
  );
});

test("N02-05 hydrating the matching generation restores ordinary decoration", () => {
  assert.equal(
    shouldHydrateDetailedTranscriptPayload({
      authoritativeRetranscribeCount: 2,
      payloadRetranscribeCount: 1,
      payloadLoaded: true,
    }),
    true,
  );
  const hydrated = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 2,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(hydrated.presentMappedParticipantNames, true);
  assert.equal(hydrated.presentSegmentProvenanceDecoration, true);
  assert.equal(
    shouldHydrateDetailedTranscriptPayload({
      authoritativeRetranscribeCount: 2,
      payloadRetranscribeCount: 2,
      payloadLoaded: true,
    }),
    false,
  );
});

test("N02-06/07 CONFIRMED and AUTO_SUGGESTED old mappings are fenced", () => {
  for (const speakerMappingStatus of ["CONFIRMED", "AUTO_SUGGESTED"] as const) {
    const detailed = resolveDetailedTranscriptGenerationPresentation({
      transcriptionActive: false,
      speakerMappingStatus,
      payloadRetranscribeCount: 1,
      authoritativeRetranscribeCount: 2,
    });
    assert.equal(detailed.presentMappedParticipantNames, false);
    assert.equal(
      isSpeakerMappingPresentedCurrent({
        transcriptionActive: false,
        speakerMappingStatus,
        detailedPayloadCurrent: false,
      }),
      false,
    );
  }
});

test("N02-08/09 stale APPLIED/RAW/EDITED provenance is not current-generation evidence", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 1,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(detailed.presentSegmentProvenanceDecoration, false);
  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  assert.match(section, /payloadRetranscribeCount: transcript\?\.retranscribeCount/);
  assert.match(section, /authoritativeRetranscribeCount: canonicalRetranscribeCount/);
  assert.match(section, /presentSegmentProvenanceDecoration/);
  assert.match(section, /shouldHydrateDetailedTranscriptPayload\(/);
});

test("N02-10 ordinary same-generation detailed view is unchanged", () => {
  const detailed = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 2,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(detailed.presentMappedParticipantNames, true);
  assert.equal(detailed.presentSegmentProvenanceDecoration, true);
  const omitted = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
  });
  assert.equal(omitted.presentMappedParticipantNames, true);
  assert.equal(omitted.presentSegmentProvenanceDecoration, true);
});

test("N02-11 second/refreshed view keeps generation identity in the child key", () => {
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(panel, /retranscribeCount: transcript\?\.retranscribeCount \?\? null/);
  assert.match(panel, /canonicalRetranscribeCount=\{transcript\?\.retranscribeCount \?\? null\}/);
  const sectionKey = readFileSync("lib/transcription/transcription-section-key.ts", "utf8");
  assert.match(sectionKey, /:g\$\{retranscribeCount\}/);
});

test("N02-12 generation fence does not destructively clear historical mapping/provenance", () => {
  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  assert.match(section, /shouldHydrateDetailedTranscriptPayload\(/);
  assert.doesNotMatch(section, /speakerMapping:\s*null/);
  assert.doesNotMatch(section, /speakerMappingStatus:\s*"NOT_REQUIRED"/);
});

function sameGenerationCompletionHydrateInput(extras: {
  payloadStatus: string;
  authoritativeTranscriptionStage: string;
  payloadRetranscribeCount?: number;
  authoritativeRetranscribeCount?: number;
} = {
  payloadStatus: "QUEUED",
  authoritativeTranscriptionStage: "ready",
}) {
  return {
    payloadLoaded: true as const,
    payloadRetranscribeCount: extras.payloadRetranscribeCount ?? 2,
    authoritativeRetranscribeCount: extras.authoritativeRetranscribeCount ?? 2,
    payloadStatus: extras.payloadStatus,
    authoritativeTranscriptionStage: extras.authoritativeTranscriptionStage,
  };
}

test("FINAL-N02-01 generation N+1 QUEUED payload hydrates when same N+1 becomes COMPLETED", () => {
  const whileActive = shouldHydrateDetailedTranscriptPayload({
    ...sameGenerationCompletionHydrateInput({
      payloadStatus: "QUEUED",
      authoritativeTranscriptionStage: "queued",
    }),
  });
  assert.equal(whileActive, false);

  const afterComplete = shouldHydrateDetailedTranscriptPayload(
    sameGenerationCompletionHydrateInput({
      payloadStatus: "QUEUED",
      authoritativeTranscriptionStage: "ready",
    }),
  );
  assert.equal(afterComplete, true);

  const transcribingPayload = shouldHydrateDetailedTranscriptPayload(
    sameGenerationCompletionHydrateInput({
      payloadStatus: "TRANSCRIBING",
      authoritativeTranscriptionStage: "ready",
    }),
  );
  assert.equal(transcribingPayload, true);

  const activeKey = detailedTranscriptHydrationAttemptKey({
    authoritativeRetranscribeCount: 2,
    authoritativeTranscriptionActive: true,
  });
  const terminalKey = detailedTranscriptHydrationAttemptKey({
    authoritativeRetranscribeCount: 2,
    authoritativeTranscriptionActive: false,
  });
  assert.equal(activeKey, "2:active");
  assert.equal(terminalKey, "2:terminal");
  assert.notEqual(activeKey, terminalKey);

  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  assert.match(section, /payloadStatus: transcript\?\.status/);
  assert.match(section, /authoritativeTranscriptionStage: canonicalTranscriptionStage/);
  assert.match(section, /detailedTranscriptHydrationAttemptKey\(/);
  assert.match(
    section,
    /authoritativeTranscriptionActive: isActiveTranscriptGenerationStage\(\s*canonicalTranscriptionStage,/,
  );
  assert.doesNotMatch(
    section,
    /hydrationKey = `\$\{canonicalRetranscribeCount\}:\$\{transcriptGenerationActive/,
  );
});

test("FINAL-N02-02 identical transcript text still triggers same-generation completion refresh", () => {
  assert.equal(
    shouldHydrateDetailedTranscriptPayload(
      sameGenerationCompletionHydrateInput({
        payloadStatus: "QUEUED",
        authoritativeTranscriptionStage: "ready",
      }),
    ),
    true,
  );
  const helper = readFileSync("lib/post-processing/transcript-generation-currentness.ts", "utf8");
  const hydrateStart = helper.indexOf("export function shouldHydrateDetailedTranscriptPayload");
  const hydrateEnd = helper.indexOf("export type DetailedTranscriptGenerationPresentation");
  const hydrateFn = helper.slice(hydrateStart, hydrateEnd);
  assert.doesNotMatch(hydrateFn, /payloadText|transcriptText|transcriptId/);
});

test("FINAL-N02-03 same transcript ID still triggers same-generation completion refresh", () => {
  const transcriptId = "tr_same";
  assert.equal(
    shouldHydrateDetailedTranscriptPayload(
      sameGenerationCompletionHydrateInput({
        payloadStatus: "QUEUED",
        authoritativeTranscriptionStage: "ready",
      }),
    ),
    true,
  );
  const firstKey = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId,
    recordingId: "rec_1",
    retranscribeCount: 2,
  });
  const secondKey = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId,
    recordingId: "rec_1",
    retranscribeCount: 2,
  });
  assert.equal(firstKey, secondKey);
});

test("FINAL-N02-04 completed payload does not repeat the completion refresh", () => {
  const completed = {
    payloadLoaded: true as const,
    payloadRetranscribeCount: 2,
    authoritativeRetranscribeCount: 2,
    payloadStatus: "COMPLETED",
    authoritativeTranscriptionStage: "ready",
  };
  assert.equal(shouldHydrateDetailedTranscriptPayload(completed), false);
  assert.equal(shouldHydrateDetailedTranscriptPayload(completed), false);

  const terminalKey = detailedTranscriptHydrationAttemptKey({
    authoritativeRetranscribeCount: 2,
    authoritativeTranscriptionActive: false,
  });
  let attempts = 0;
  let lastKey: string | null = null;
  const maybeHydrate = () => {
    if (!shouldHydrateDetailedTranscriptPayload(completed)) {
      return;
    }
    if (lastKey === terminalKey) {
      return;
    }
    lastKey = terminalKey;
    attempts += 1;
  };
  maybeHydrate();
  maybeHydrate();
  assert.equal(attempts, 0);
});

test("FINAL-N02-05 generation mismatch hydration from prior remediation still works", () => {
  assert.equal(
    shouldHydrateDetailedTranscriptPayload({
      authoritativeRetranscribeCount: 2,
      payloadRetranscribeCount: 1,
      payloadLoaded: true,
      payloadStatus: "COMPLETED",
      authoritativeTranscriptionStage: "queued",
    }),
    true,
  );
  assert.equal(
    isDetailedTranscriptPayloadCurrent({
      payloadRetranscribeCount: 1,
      authoritativeRetranscribeCount: 2,
      payloadStatus: "COMPLETED",
      authoritativeTranscriptionStage: "queued",
    }),
    false,
  );
  const mismatchKey = detailedTranscriptHydrationAttemptKey({
    authoritativeRetranscribeCount: 2,
    authoritativeTranscriptionActive: true,
  });
  const priorKey = detailedTranscriptHydrationAttemptKey({
    authoritativeRetranscribeCount: 1,
    authoritativeTranscriptionActive: false,
  });
  assert.notEqual(mismatchKey, priorKey);
});

test("FINAL-N02-06 initial transcription active payload hydrates when same generation completes", () => {
  assert.equal(
    shouldHydrateDetailedTranscriptPayload({
      payloadLoaded: true,
      payloadRetranscribeCount: 0,
      authoritativeRetranscribeCount: 0,
      payloadStatus: "QUEUED",
      authoritativeTranscriptionStage: "queued",
    }),
    false,
  );
  assert.equal(
    shouldHydrateDetailedTranscriptPayload({
      payloadLoaded: true,
      payloadRetranscribeCount: 0,
      authoritativeRetranscribeCount: 0,
      payloadStatus: "QUEUED",
      authoritativeTranscriptionStage: "ready",
    }),
    true,
  );
  assert.equal(
    shouldHydrateDetailedTranscriptPayload({
      payloadLoaded: true,
      payloadRetranscribeCount: 0,
      authoritativeRetranscribeCount: 0,
      payloadStatus: "TRANSCRIBING",
      authoritativeTranscriptionStage: "ready",
    }),
    true,
  );
});

test("FINAL-N02-07 completed same-generation steady state does not fetch", () => {
  const steady = {
    payloadLoaded: true as const,
    payloadRetranscribeCount: 0,
    authoritativeRetranscribeCount: 0,
    payloadStatus: "COMPLETED",
    authoritativeTranscriptionStage: "ready",
  };
  assert.equal(shouldHydrateDetailedTranscriptPayload(steady), false);
  assert.equal(
    isDetailedTranscriptPayloadCurrent({
      payloadRetranscribeCount: 0,
      authoritativeRetranscribeCount: 0,
      payloadStatus: "COMPLETED",
      authoritativeTranscriptionStage: "ready",
    }),
    true,
  );
  assert.equal(isDetailedTranscriptPayloadLifecycleCurrent({
    payloadStatus: "COMPLETED",
    authoritativeTranscriptionStage: "ready",
  }), true);
});

test("FINAL-N02-08 mapping/provenance stay fenced until the completed payload hydrates", () => {
  const staleActivePayload = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 2,
    authoritativeRetranscribeCount: 2,
    payloadStatus: "QUEUED",
    authoritativeTranscriptionStage: "ready",
  });
  assert.equal(staleActivePayload.detailedPayloadCurrent, false);
  assert.equal(staleActivePayload.presentMappedParticipantNames, false);
  assert.equal(staleActivePayload.presentSegmentProvenanceDecoration, false);
  assert.equal(
    isSpeakerMappingPresentedCurrent({
      transcriptionActive: false,
      speakerMappingStatus: "CONFIRMED",
      detailedPayloadCurrent: false,
    }),
    false,
  );

  const hydratedCompleted = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 2,
    authoritativeRetranscribeCount: 2,
    payloadStatus: "COMPLETED",
    authoritativeTranscriptionStage: "ready",
  });
  assert.equal(hydratedCompleted.detailedPayloadCurrent, true);
  assert.equal(hydratedCompleted.presentMappedParticipantNames, true);
  assert.equal(hydratedCompleted.presentSegmentProvenanceDecoration, true);
});

test("N03-01/02 stalled materials/status request times out and releases in-flight ownership", async () => {
  const request = createMaterialsStatusRequestAbort({ timeoutMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(request.controller.signal.aborted, true);
  request.dispose();

  let inFlight = true;
  let abortCalls = 0;
  const acquired = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: true,
    waitMs: 5,
    maxWaitMs: 20,
    abortGraceMs: 20,
    abortInFlight: () => {
      abortCalls += 1;
      inFlight = false;
    },
  });
  assert.equal(abortCalls, 1);
  assert.equal(acquired, true);
  inFlight = false;
});

test("N03-03/05/06 timeout stays fail-closed and a later successful apply can release", async () => {
  assert.equal(
    isLocalTranscriptGenerationFenceActive({
      requestBusy: false,
      awaitingAuthoritativePostRetranscriptionStatus: true,
    }),
    true,
  );
  const timedOut = await applyAuthoritativeStatusAfterRetranscribe({
    statusRequestSeqAtPostCompletion: 4,
    applyAuthoritativeStatus: async () => ({ appliedStatusRequestId: null }),
  });
  assert.equal(timedOut.authoritativeStatusApplied, false);
  assert.equal(
    shouldReleasePostRetranscriptionFence({
      appliedStatusRequestId: 6,
      statusRequestSeqAtPostCompletion: 4,
    }),
    true,
  );
});

test("N03-04 later poll can execute after in-flight is released", async () => {
  let inFlight = false;
  const first = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: false,
  });
  assert.equal(first, true);
  inFlight = false;
  const laterPoll = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: false,
  });
  assert.equal(laterPoll, true);
  inFlight = false;
});

test("N03-07 stale or aborted responses cannot overwrite newer status", () => {
  assert.equal(
    shouldApplyMaterialsStatusResponse({
      requestId: 5,
      latestAppliedRequestId: 6,
    }),
    false,
  );
  assert.equal(
    shouldApplyMaterialsStatusResponse({
      requestId: 7,
      latestAppliedRequestId: 6,
      aborted: true,
    }),
    false,
  );
  assert.equal(
    shouldApplyMaterialsStatusResponse({
      requestId: 7,
      latestAppliedRequestId: 6,
    }),
    true,
  );
  const owner = new AbortController();
  const stale = new AbortController();
  assert.equal(
    shouldReleaseMaterialsStatusInFlightOwnership({
      ownerController: owner,
      requestController: stale,
    }),
    false,
  );
  assert.equal(
    shouldReleaseMaterialsStatusInFlightOwnership({
      ownerController: owner,
      requestController: owner,
    }),
    true,
  );
});

test("N03-08 exclusive final refresh cannot wait indefinitely behind a stalled request", async () => {
  let inFlight = true;
  const started = Date.now();
  const acquired = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: true,
    waitMs: 5,
    maxWaitMs: 20,
    abortGraceMs: 15,
    abortInFlight: () => {},
  });
  assert.equal(acquired, false);
  assert.ok(Date.now() - started < 400);
  assert.equal(inFlight, true);
});

test("N03-09/10/11/12 abort wiring and ordinary polling remain a single retranscribe POST", () => {
  const dashboard = readFileSync("components/session-materials-dashboard.tsx", "utf8");
  const panel = readFileSync("components/session-post-processing-panel.tsx", "utf8");
  assert.match(dashboard, /shouldReleaseMaterialsStatusInFlightOwnership\(/);
  assert.match(panel, /shouldReleaseMaterialsStatusInFlightOwnership\(/);
  assert.match(dashboard, /createMaterialsStatusRequestAbort\(/);
  assert.match(panel, /createMaterialsStatusRequestAbort\(/);
  assert.match(dashboard, /signal: request\.controller\.signal/);
  assert.match(panel, /signal: request\.controller\.signal/);
  assert.match(dashboard, /statusRequestAbortRef\.current\?\.abort\(\)/);
  assert.match(panel, /statusRequestAbortRef\.current\?\.abort\(\)/);
  assert.match(dashboard, /clearInterval\(intervalId\)/);
  assert.equal(dashboard.split("materialsRetranscribePath(sessionId)").length - 1, 1);
  assert.equal(panel.split("materialsRetranscribePath(sessionId)").length - 1, 1);
  assert.match(dashboard, /exclusive: Boolean\(options\?\.exclusive\)/);
  assert.match(panel, /exclusive: Boolean\(options\?\.exclusive\)/);
});

test("cross-finding N01/N02/N03 sequence stays fail-closed then recovers", async () => {
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

  const duringRetranscribe = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: true,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 1,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(duringRetranscribe.presentMappedParticipantNames, false);
  assert.equal(duringRetranscribe.presentSegmentProvenanceDecoration, false);

  const staleAfterActive = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 1,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(staleAfterActive.presentMappedParticipantNames, false);
  assert.equal(staleAfterActive.presentSegmentProvenanceDecoration, false);

  let inFlight = true;
  const recoveredSlot = await acquireMaterialsStatusFetchTurn({
    isInFlight: () => inFlight,
    setInFlight: (value) => {
      inFlight = value;
    },
    exclusive: true,
    waitMs: 5,
    maxWaitMs: 15,
    abortGraceMs: 15,
    abortInFlight: () => {
      inFlight = false;
    },
  });
  assert.equal(recoveredSlot, true);
  inFlight = false;

  const applied = await applyAuthoritativeStatusAfterRetranscribe({
    statusRequestSeqAtPostCompletion: 8,
    applyAuthoritativeStatus: async () => ({ appliedStatusRequestId: 9 }),
  });
  assert.equal(applied.authoritativeStatusApplied, true);

  const hydrated = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: false,
    speakerMappingStatus: "CONFIRMED",
    payloadRetranscribeCount: 2,
    authoritativeRetranscribeCount: 2,
  });
  assert.equal(hydrated.presentMappedParticipantNames, true);
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
