import assert from "node:assert/strict";
import test from "node:test";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  canContinueWithCurrentTranscript,
  listMappingStageFromTranscript,
  projectPostProcessingStages,
  toSessionListMappingStage,
} from "@/lib/post-processing/projection";

const buyer = { id: "buyer", type: ParticipantType.PARTICIPANT };
const seller = { id: "seller", type: ParticipantType.PARTICIPANT };

const completeMappingInput = {
  hasSpeakerDiarization: true,
  speakerMappingStatus: "AUTO_SUGGESTED",
  segments: [
    { speakerLabel: "speaker_0", mappedParticipantId: "buyer", text: "Hello" },
    { speakerLabel: "speaker_1", mappedParticipantId: "seller", text: "Hi" },
  ],
  participants: [buyer, seller],
};

test("complete AUTO_SUGGESTED is informational on every derived surface", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "COMPLETED",
    transcriptPresent: true,
    mappingInput: completeMappingInput,
    aiStage: "not_started",
  });

  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "informational");
  assert.equal(projection.stages.SPEAKER_MAPPING.raw.readyForAnalysis, true);
  assert.equal(toSessionListMappingStage("informational"), "informational");
  assert.equal(
    listMappingStageFromTranscript({
      transcriptPresent: true,
      mappingInput: completeMappingInput,
    }),
    "informational",
  );
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "pending");
});

test("REQUIRED mapping is action_required and list required", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "COMPLETED",
    transcriptPresent: true,
    mappingInput: {
      ...completeMappingInput,
      speakerMappingStatus: "REQUIRED",
    },
    aiStage: "not_started",
  });

  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "action_required");
  assert.equal(projection.stages.SPEAKER_MAPPING.raw.readyForAnalysis, false);
  assert.equal(toSessionListMappingStage("action_required"), "required");
});

test("CONFIRMED complete mapping is ready / list confirmed", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "COMPLETED",
    transcriptPresent: true,
    mappingInput: {
      ...completeMappingInput,
      speakerMappingStatus: "CONFIRMED",
    },
    aiStage: "not_started",
  });

  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "ready");
  assert.equal(toSessionListMappingStage("ready"), "confirmed");
});

test("enhancement RUNNING keeps AI pending", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "IN_PROGRESS",
    transcriptPresent: true,
    mappingInput: completeMappingInput,
    aiStage: "not_started",
  });

  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "running");
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "pending");
});

test("FAILED enhancement is failed and continue-current-transcript is allowed", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "FAILED",
    transcriptPresent: true,
    mappingInput: completeMappingInput,
    aiStage: "not_started",
  });

  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "failed");
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.raw.canContinueWithCurrentTranscript, true);
  assert.equal(canContinueWithCurrentTranscript("FAILED"), true);
  assert.equal(canContinueWithCurrentTranscript("PARTIAL"), true);
  assert.equal(canContinueWithCurrentTranscript("SKIPPED"), true);
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "pending");
});

test("AUTO_SUGGESTED plus completed AI does not become mapping-required", () => {
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "COMPLETED",
    transcriptPresent: true,
    mappingInput: completeMappingInput,
    aiStage: "ready",
  });

  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "informational");
  assert.equal(projection.stages.AI_ANALYSIS.semantic, "ready");
  assert.notEqual(
    listMappingStageFromTranscript({
      transcriptPresent: true,
      mappingInput: completeMappingInput,
    }),
    "required",
  );
});
