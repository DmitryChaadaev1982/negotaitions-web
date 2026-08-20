import {
  evaluateSpeakerMappingStructuralCompleteness,
  type SpeakerMappingCompleteness,
  type SpeakerMappingCompletenessInput,
} from "../transcription/speaker-mapping-completeness";

export const POST_PROCESSING_STAGES = [
  "RECORDING",
  "TRANSCRIPTION",
  "TRANSCRIPT_ENHANCEMENT",
  "SPEAKER_MAPPING",
  "AI_ANALYSIS",
] as const;

export type PostProcessingStageId = (typeof POST_PROCESSING_STAGES)[number];

export const POST_PROCESSING_SEMANTIC_STATES = [
  "pending",
  "running",
  "ready",
  "action_required",
  "informational",
  "failed",
  "not_applicable",
] as const;

export type PostProcessingSemanticState =
  (typeof POST_PROCESSING_SEMANTIC_STATES)[number];

export type PostProcessingStageProjection = {
  id: PostProcessingStageId;
  semantic: PostProcessingSemanticState;
  raw: Record<string, unknown>;
};

export type PostProcessingProjection = {
  stages: Record<PostProcessingStageId, PostProcessingStageProjection>;
};

const TERMINAL_ENHANCEMENT_STATUSES = new Set([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "SKIPPED",
]);

export function isTranscriptEnhancementTerminal(
  status: string | null | undefined,
): boolean {
  if (!status) {
    return true;
  }
  if (status === "IN_PROGRESS" || status === "RUNNING" || status === "QUEUED") {
    return false;
  }
  return (
    TERMINAL_ENHANCEMENT_STATUSES.has(status) ||
    status === "NOT_AVAILABLE" ||
    status === "IDLE" ||
    status === "SUGGESTED" ||
    status === "NOT_STARTED"
  );
}

export function isEnhancementStatusRunning(
  status: string | null | undefined,
): boolean {
  return status === "IN_PROGRESS" || status === "RUNNING" || status === "QUEUED";
}

export function canContinueWithCurrentTranscript(status: string | null | undefined): boolean {
  return status === "FAILED" || status === "PARTIAL" || status === "SKIPPED";
}

function semanticFromLegacyProcessingStage(
  stage: string | null | undefined,
): PostProcessingSemanticState {
  const normalized = (stage ?? "").toLowerCase();
  if (normalized === "ready" || normalized === "completed") {
    return "ready";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (
    [
      "in_progress",
      "finalizing",
      "processing",
      "queued",
      "downloading",
      "compressing",
      "transcribing",
      "enhancing",
      "analyzing",
    ].includes(normalized)
  ) {
    return "running";
  }
  if (normalized === "not_available") {
    return "not_applicable";
  }
  return "pending";
}

export function projectSpeakerMappingSemantic(input: {
  transcriptPresent: boolean;
  speakerMappingStatus: string | null;
  completeness: SpeakerMappingCompleteness;
}): PostProcessingSemanticState {
  if (!input.transcriptPresent) {
    return "pending";
  }
  if (input.completeness.reason === "NOT_REQUIRED") {
    return "not_applicable";
  }
  if (!input.completeness.readyForAnalysis) {
    return "action_required";
  }
  if (input.speakerMappingStatus === "CONFIRMED") {
    return "ready";
  }
  return "informational";
}

export function toSessionListMappingStage(
  semantic: PostProcessingSemanticState,
): "required" | "confirmed" | "informational" | null {
  if (semantic === "action_required") {
    return "required";
  }
  if (semantic === "ready") {
    return "confirmed";
  }
  if (semantic === "informational") {
    return "informational";
  }
  return null;
}

function projectEnhancementSemantic(
  status: string | null | undefined,
): PostProcessingSemanticState {
  if (!status || status === "NOT_STARTED") {
    return "pending";
  }
  if (status === "NOT_AVAILABLE") {
    return "not_applicable";
  }
  if (isEnhancementStatusRunning(status)) {
    return "running";
  }
  if (status === "COMPLETED") {
    return "ready";
  }
  if (status === "FAILED" || status === "PARTIAL") {
    return "failed";
  }
  if (status === "SKIPPED" || status === "IDLE" || status === "SUGGESTED") {
    return "informational";
  }
  return "pending";
}

function projectAiSemantic(input: {
  aiStage: string | null | undefined;
  mappingReady: boolean;
  enhancementRunning: boolean;
  conflictingOwnership: boolean;
}): PostProcessingSemanticState {
  if (input.enhancementRunning || input.conflictingOwnership) {
    return "pending";
  }
  const fromLegacy = semanticFromLegacyProcessingStage(input.aiStage);
  if (fromLegacy === "running" || fromLegacy === "ready" || fromLegacy === "failed") {
    return fromLegacy;
  }
  if (!input.mappingReady) {
    return "pending";
  }
  return fromLegacy;
}

export function projectPostProcessingStages(input: {
  recordingStage: string | null;
  transcriptStage: string | null;
  enhancementStatus: string | null;
  transcriptPresent: boolean;
  mappingInput: SpeakerMappingCompletenessInput;
  aiStage: string | null;
  conflictingOwnership?: boolean;
}): PostProcessingProjection {
  const completeness = evaluateSpeakerMappingStructuralCompleteness(input.mappingInput);
  const mappingSemantic = projectSpeakerMappingSemantic({
    transcriptPresent: input.transcriptPresent,
    speakerMappingStatus: input.mappingInput.speakerMappingStatus,
    completeness,
  });
  const enhancementRunning = isEnhancementStatusRunning(input.enhancementStatus);

  return {
    stages: {
      RECORDING: {
        id: "RECORDING",
        semantic: semanticFromLegacyProcessingStage(input.recordingStage),
        raw: { processingStage: input.recordingStage },
      },
      TRANSCRIPTION: {
        id: "TRANSCRIPTION",
        semantic: semanticFromLegacyProcessingStage(input.transcriptStage),
        raw: { processingStage: input.transcriptStage },
      },
      TRANSCRIPT_ENHANCEMENT: {
        id: "TRANSCRIPT_ENHANCEMENT",
        semantic: projectEnhancementSemantic(input.enhancementStatus),
        raw: {
          status: input.enhancementStatus,
          terminal: isTranscriptEnhancementTerminal(input.enhancementStatus),
          canContinueWithCurrentTranscript: canContinueWithCurrentTranscript(
            input.enhancementStatus,
          ),
        },
      },
      SPEAKER_MAPPING: {
        id: "SPEAKER_MAPPING",
        semantic: mappingSemantic,
        raw: {
          status: input.mappingInput.speakerMappingStatus,
          structurallyComplete: completeness.structurallyComplete,
          readyForAnalysis: completeness.readyForAnalysis,
          reason: completeness.reason,
        },
      },
      AI_ANALYSIS: {
        id: "AI_ANALYSIS",
        semantic: projectAiSemantic({
          aiStage: input.aiStage,
          mappingReady: completeness.readyForAnalysis,
          enhancementRunning,
          conflictingOwnership: Boolean(input.conflictingOwnership),
        }),
        raw: { processingStage: input.aiStage },
      },
    },
  };
}

export function listMappingStageFromTranscript(input: {
  transcriptPresent: boolean;
  mappingInput: SpeakerMappingCompletenessInput;
}): "required" | "confirmed" | "informational" | null {
  const completeness = evaluateSpeakerMappingStructuralCompleteness(input.mappingInput);
  return toSessionListMappingStage(
    projectSpeakerMappingSemantic({
      transcriptPresent: input.transcriptPresent,
      speakerMappingStatus: input.mappingInput.speakerMappingStatus,
      completeness,
    }),
  );
}
