import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import {
  isEnhancementCurrentForTranscriptGeneration,
  resolveEnhancementStatusCopyKind,
  resolveEnhancementUxState,
} from "@/lib/post-processing/enhancement-ux-presentation";
import { projectPostProcessingStages } from "@/lib/post-processing/projection";
import { ParticipantType } from "@/app/generated/prisma/client";

const buyer = { id: "buyer", type: ParticipantType.PARTICIPANT };
const seller = { id: "seller", type: ParticipantType.PARTICIPANT };

const completeMappingInput = {
  hasSpeakerDiarization: true,
  speakerMappingStatus: "CONFIRMED",
  segments: [
    { speakerLabel: "speaker_0", mappedParticipantId: "buyer", text: "Hello" },
    { speakerLabel: "speaker_1", mappedParticipantId: "seller", text: "Hi" },
  ],
  participants: [buyer, seller],
};

const readyProjection = {
  recordingStage: "ready",
  transcriptStage: "ready",
  enhancementStatus: "COMPLETED",
  transcriptPresent: true,
  mappingInput: completeMappingInput,
  aiStage: "ready",
  enhancementCurrentForGeneration: true,
};

test("R1 before retranscription old-generation downstream may be current", () => {
  const projection = projectPostProcessingStages(readyProjection);
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "ready");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "ready");
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "ready");
  assert.equal(
    evaluateAiAnalysisCurrentness({
      analysis: {
        inputFingerprint: "gen0",
        transcriptId: "t1",
        transcriptRetranscribeCount: 0,
      },
      currentFingerprint: "gen0",
      transcriptId: "t1",
      transcriptRetranscribeCount: 0,
    }).current,
    true,
  );
});

test("R2 immediately after Repeat transcription is RUNNING downstream is not current", () => {
  const projection = projectPostProcessingStages({
    ...readyProjection,
    transcriptStage: "queued",
    conflictingOwnership: true,
    enhancementCurrentForGeneration: false,
  });
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "running");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "pending");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "pending");
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "pending");
  assert.equal(
    resolveEnhancementUxState({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      transcriptionStage: "queued",
    }),
    "TRANSCRIPTION_RUNNING",
  );
  assert.equal(
    resolveEnhancementStatusCopyKind({
      uiStatus: "COMPLETED",
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      transcriptionStage: "queued",
    }),
    "not_started",
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

test("R3 leftover successful history may exist but is not presented current for the new generation", () => {
  assert.equal(
    isEnhancementCurrentForTranscriptGeneration({
      jobRetranscribeCount: 0,
      currentRetranscribeCount: 1,
    }),
    false,
  );
  const projection = projectPostProcessingStages({
    ...readyProjection,
    transcriptStage: "transcribing",
    enhancementStatus: "COMPLETED",
    enhancementCurrentForGeneration: false,
  });
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.raw.status, "COMPLETED");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "pending");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.raw.currentForGeneration, false);
});

test("R4 after the new transcript generation completes old downstream stays stale", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "COMPLETED",
    transcriptPresent: true,
    mappingInput: {
      ...completeMappingInput,
      speakerMappingStatus: "REQUIRED",
      segments: [
        { speakerLabel: "speaker_0", mappedParticipantId: null, text: "new raw" },
      ],
    },
    aiStage: "not_started",
    enhancementCurrentForGeneration: false,
  });
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "ready");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "pending");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "action_required");
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "pending");
});

test("R5 new-generation enhancement mapping and AI become current normally", () => {
  const projection = projectPostProcessingStages({
    ...readyProjection,
    enhancementCurrentForGeneration: true,
  });
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "ready");
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "ready");
  assert.equal(
    isEnhancementCurrentForTranscriptGeneration({
      jobRetranscribeCount: 1,
      currentRetranscribeCount: 1,
    }),
    true,
  );
});

test("live enhancement on a completed transcript generation is not treated as retranscription stale", () => {
  const projection = projectPostProcessingStages({
    ...readyProjection,
    enhancementStatus: "IN_PROGRESS",
    aiStage: "not_started",
    enhancementPublicationEligible: true,
    enhancementCurrentForGeneration: true,
  });
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "ready");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "running");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "ready");
});

test("R6 currentness gating is presentation-only and does not mutate backend authority helpers", () => {
  const projectionSource = readFileSync("lib/post-processing/projection.ts", "utf8");
  assert.match(projectionSource, /enhancementCurrentForGeneration/);
  assert.match(projectionSource, /transcriptionActive/);
  assert.doesNotMatch(projectionSource, /prisma\./);
  assert.doesNotMatch(projectionSource, /transcript\.update/);
  const statusSource = readFileSync(
    "app/api/sessions/[sessionId]/materials/status/route.ts",
    "utf8",
  );
  assert.match(statusSource, /isEnhancementCurrentForTranscriptGeneration/);
  assert.doesNotMatch(statusSource, /fenceEnhancementJobInMetadata/);
  assert.doesNotMatch(statusSource, /clearTranscriptEnhancementPublication/);
});
