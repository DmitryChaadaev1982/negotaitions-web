import assert from "node:assert/strict";
import test from "node:test";

import {
  ParticipantType,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import { resolveAiAnalysisRenderState } from "@/lib/materials-ai-analysis-view";
import {
  isRecordingReadyForTranscription,
  resolveTranscriptProcessingStage,
} from "@/lib/materials-status-readiness";
import {
  isTranscriptEnhancementTerminal,
  projectPostProcessingStages,
} from "@/lib/post-processing/projection";
import { evaluateSpeakerMappingStructuralCompleteness } from "@/lib/transcription/speaker-mapping-completeness";

const buyer = { id: "buyer", type: ParticipantType.PARTICIPANT };
const seller = { id: "seller", type: ParticipantType.PARTICIPANT };
const facilitator = { id: "facilitator", type: ParticipantType.FACILITATOR };

const historicalMappedSegments = [
  { speakerLabel: "speaker_1", mappedParticipantId: "buyer", text: "Hello" },
  { speakerLabel: "speaker_2", mappedParticipantId: "seller", text: "Hi" },
  { speakerLabel: "speaker_1", mappedParticipantId: "buyer", text: "Offer" },
  { speakerLabel: "speaker_2", mappedParticipantId: "seller", text: "Counter" },
];

const historicalMappingInput = {
  hasSpeakerDiarization: true,
  speakerMappingStatus: "CONFIRMED",
  segments: historicalMappedSegments,
  participants: [facilitator, buyer, seller],
};

function transcriptionActions(input: {
  recordingStatus: RecordingStatus | null;
  hasFileKey: boolean;
  transcriptStatus: TranscriptStatus | null;
  transcriptHasText: boolean;
}) {
  const recordingReady = isRecordingReadyForTranscription(
    input.recordingStatus,
    input.hasFileKey,
  );
  const transcriptCompleted =
    input.transcriptStatus === TranscriptStatus.COMPLETED &&
    input.transcriptHasText;
  return {
    recordingReady,
    canStart:
      recordingReady &&
      input.hasFileKey &&
      !transcriptCompleted &&
      input.transcriptStatus !== TranscriptStatus.FAILED &&
      !input.transcriptHasText,
    canRerun: recordingReady && input.hasFileKey && transcriptCompleted,
  };
}

test("LEGACY01 completed recording without transcript can start transcription", () => {
  const actions = transcriptionActions({
    recordingStatus: RecordingStatus.COMPLETED,
    hasFileKey: true,
    transcriptStatus: null,
    transcriptHasText: false,
  });
  const transcriptionStage = resolveTranscriptProcessingStage(
    null,
    RecordingStatus.COMPLETED,
    true,
    false,
    "NOT_AVAILABLE",
  );
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: transcriptionStage,
    enhancementStatus: "NOT_AVAILABLE",
    transcriptPresent: false,
    mappingInput: historicalMappingInput,
    aiStage: "waiting_for_transcript",
  });
  const aiRender = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: transcriptionStage as "not_started",
    aiStage: "waiting_for_transcript",
    canViewAiAnalysis: true,
    analysisJson: null,
  });

  assert.equal(actions.recordingReady, true);
  assert.equal(actions.canStart, true);
  assert.equal(actions.canRerun, false);
  assert.equal(transcriptionStage, "not_started");
  assert.equal(projection.stages.RECORDING.semantic, "ready");
  assert.notEqual(transcriptionStage, "waiting_for_recording");
  assert.notEqual(aiRender.stage, "WAITING_FOR_RECORDING");
});

test("LEGACY02 completed recording and transcript keeps rerun available", () => {
  const actions = transcriptionActions({
    recordingStatus: RecordingStatus.COMPLETED,
    hasFileKey: true,
    transcriptStatus: TranscriptStatus.COMPLETED,
    transcriptHasText: true,
  });
  const transcriptionStage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "NOT_AVAILABLE",
  );
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: transcriptionStage,
    enhancementStatus: "NOT_AVAILABLE",
    transcriptPresent: true,
    mappingInput: historicalMappingInput,
    aiStage: "not_started",
  });

  assert.equal(actions.recordingReady, true);
  assert.equal(actions.canStart, false);
  assert.equal(actions.canRerun, true);
  assert.equal(transcriptionStage, "ready");
  assert.equal(projection.stages.RECORDING.semantic, "ready");
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "ready");
});

test("LEGACY03 missing enhancement metadata does not regress to waiting for recording", () => {
  assert.equal(isTranscriptEnhancementTerminal(null), true);
  assert.equal(isTranscriptEnhancementTerminal("NOT_AVAILABLE"), true);
  const transcriptionStage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "NOT_AVAILABLE",
  );
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: transcriptionStage,
    enhancementStatus: "NOT_AVAILABLE",
    transcriptPresent: true,
    mappingInput: historicalMappingInput,
    aiStage: "not_started",
  });

  assert.equal(transcriptionStage, "ready");
  assert.equal(projection.stages.RECORDING.semantic, "ready");
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "ready");
  assert.equal(
    projection.stages.TRANSCRIPT_ENHANCEMENT.semantic,
    "not_applicable",
  );
});

test("LEGACY04 historical CONFIRMED mapping remains structurally complete", () => {
  const completeness = evaluateSpeakerMappingStructuralCompleteness(
    historicalMappingInput,
  );
  assert.equal(completeness.structurallyComplete, true);
  assert.equal(completeness.readyForAnalysis, true);
  assert.equal(completeness.reason, "COMPLETE");
});

test("LEGACY05 NULL AI fingerprint keeps transcriptId plus retranscribeCount currentness", () => {
  const current = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: null,
      transcriptId: "historical-transcript",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: "new-hash-must-be-ignored",
    transcriptId: "historical-transcript",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(current, { current: true, reason: "legacy_current" });
});

test("LEGACY06 materials and room Debrief share one post-processing projection", () => {
  const input = {
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: "NOT_AVAILABLE",
    transcriptPresent: true,
    mappingInput: historicalMappingInput,
    aiStage: "not_started",
  };
  const materials = projectPostProcessingStages(input);
  const roomDebrief = projectPostProcessingStages(input);

  assert.deepEqual(materials, roomDebrief);
  assert.equal(materials.stages.RECORDING.semantic, "ready");
  assert.equal(materials.stages.TRANSCRIPTION.semantic, "ready");
  assert.equal(materials.stages.SPEAKER_MAPPING.semantic, "ready");
  assert.equal(materials.stages.AI_ANALYSIS.semantic, "pending");
});

test("LEGACY07 historical completed session shape is operable without waiting for recording", () => {
  const actions = transcriptionActions({
    recordingStatus: RecordingStatus.COMPLETED,
    hasFileKey: true,
    transcriptStatus: TranscriptStatus.COMPLETED,
    transcriptHasText: true,
  });
  const transcriptionStage = resolveTranscriptProcessingStage(
    TranscriptStatus.COMPLETED,
    RecordingStatus.COMPLETED,
    true,
    true,
    "NOT_AVAILABLE",
  );
  const projection = projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: transcriptionStage,
    enhancementStatus: "NOT_AVAILABLE",
    transcriptPresent: true,
    mappingInput: historicalMappingInput,
    aiStage: "not_started",
  });
  const aiRender = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "not_started",
    canViewAiAnalysis: true,
    analysisJson: null,
  });
  const aiReadiness = evaluateAiAnalysisReadiness({
    status: TranscriptStatus.COMPLETED,
    text: "usable historical transcript",
    diarizedText: "buyer: usable historical transcript",
    hasSpeakerDiarization: true,
    speakerMappingStatus: "CONFIRMED",
    speakerMapping: { speaker_1: "buyer", speaker_2: "seller" },
    enhancementStatus: "NOT_AVAILABLE",
    participants: [facilitator, buyer, seller],
    segments: historicalMappedSegments,
  });

  assert.equal(actions.recordingReady, true);
  assert.equal(actions.canRerun, true);
  assert.equal(actions.canStart, false);
  assert.equal(projection.stages.RECORDING.semantic, "ready");
  assert.equal(projection.stages.TRANSCRIPTION.semantic, "ready");
  assert.notEqual(aiRender.stage, "WAITING_FOR_RECORDING");
  assert.equal(aiRender.stage, "ANALYSIS_NOT_STARTED");
  assert.equal(aiReadiness.ready, true);
  assert.equal(aiReadiness.reason, "READY");
});

test("STOPPED historical recording with a storage key is also transcription-ready", () => {
  assert.equal(
    isRecordingReadyForTranscription(RecordingStatus.STOPPED, true),
    true,
  );
  assert.equal(
    resolveTranscriptProcessingStage(
      null,
      RecordingStatus.STOPPED,
      true,
      false,
      "NOT_AVAILABLE",
    ),
    "not_started",
  );
});
