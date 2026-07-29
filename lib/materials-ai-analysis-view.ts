import {
  NegotiationAnalysisOutputSchema,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";
import type {
  ProcessingAiAnalysisStatus,
  ProcessingRecordingStatus,
  ProcessingTranscriptionStatus,
} from "@/lib/session-materials-processing";

export type AiAnalysisRenderStage =
  | "WAITING_FOR_RECORDING"
  | "WAITING_FOR_TRANSCRIPT"
  | "TRANSCRIPT_PROCESSING"
  | "ANALYSIS_NOT_STARTED"
  | "ANALYSIS_IN_PROGRESS"
  | "ANALYSIS_FAILED"
  | "ANALYSIS_READY"
  | "ANALYSIS_READY_WITHOUT_RESULT"
  | "ANALYSIS_INVALID";

export type ResolveAiAnalysisRenderStateInput = {
  recordingStage: ProcessingRecordingStatus;
  transcriptionStage: ProcessingTranscriptionStatus;
  aiStage: ProcessingAiAnalysisStatus;
  canViewAiAnalysis: boolean;
  analysisJson: unknown;
  parseAnalysisJson?: (value: unknown) => {
    success: boolean;
    data?: unknown;
  };
};

export type ResolveAiAnalysisRenderStateOutput = {
  stage: AiAnalysisRenderStage;
  analysis: NegotiationAnalysisOutput | null;
  showInvalidResultError: boolean;
};

const TRANSCRIPTION_ACTIVE_STAGES = new Set<ProcessingTranscriptionStatus>([
  "queued",
  "downloading",
  "compressing",
  "transcribing",
  "enhancing",
]);

const AI_ACTIVE_STAGES = new Set<ProcessingAiAnalysisStatus>(["queued", "analyzing"]);

export function resolveAiAnalysisRenderState(
  input: ResolveAiAnalysisRenderStateInput,
): ResolveAiAnalysisRenderStateOutput {
  if (input.recordingStage === "not_available") {
    return {
      stage: "WAITING_FOR_RECORDING",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  if (input.transcriptionStage === "waiting_for_recording") {
    return {
      stage: "WAITING_FOR_RECORDING",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  if (TRANSCRIPTION_ACTIVE_STAGES.has(input.transcriptionStage)) {
    return {
      stage: "TRANSCRIPT_PROCESSING",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  if (input.transcriptionStage === "failed") {
    return {
      stage: "WAITING_FOR_TRANSCRIPT",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  if (AI_ACTIVE_STAGES.has(input.aiStage)) {
    return {
      stage: "ANALYSIS_IN_PROGRESS",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  if (input.aiStage === "failed") {
    return {
      stage: "ANALYSIS_FAILED",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  if (input.aiStage === "ready") {
    if (!input.canViewAiAnalysis) {
      return {
        stage: "ANALYSIS_READY_WITHOUT_RESULT",
        analysis: null,
        showInvalidResultError: false,
      };
    }

    // Null/empty legacy payloads are treated as "ready without renderable report",
    // not as malformed analysis.
    if (input.analysisJson == null) {
      return {
        stage: "ANALYSIS_READY_WITHOUT_RESULT",
        analysis: null,
        showInvalidResultError: false,
      };
    }

    const parseAnalysisJson =
      input.parseAnalysisJson ??
      ((value: unknown) => NegotiationAnalysisOutputSchema.safeParse(value));
    const parsed = parseAnalysisJson(input.analysisJson);
    if (parsed.success) {
      return {
        stage: "ANALYSIS_READY",
        analysis: parsed.data as NegotiationAnalysisOutput,
        showInvalidResultError: false,
      };
    }

    return {
      stage: "ANALYSIS_INVALID",
      analysis: null,
      showInvalidResultError: true,
    };
  }

  if (input.transcriptionStage === "ready") {
    return {
      stage: "ANALYSIS_NOT_STARTED",
      analysis: null,
      showInvalidResultError: false,
    };
  }

  return {
    stage: "WAITING_FOR_TRANSCRIPT",
    analysis: null,
    showInvalidResultError: false,
  };
}
