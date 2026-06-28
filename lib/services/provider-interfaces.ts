import type {
  NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";
import type {
  TranscriptionLanguageHint,
  TranscriptionResult,
} from "@/lib/services/openai-transcription";

export interface AnalysisProvider {
  run(
    prompt: string,
    language: string,
  ): Promise<{
    output: NegotiationAnalysisOutput;
    rawOutput: unknown;
    model: string;
  }>;
}

export interface TranscriptionProvider {
  transcribe(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    languageHint: TranscriptionLanguageHint,
    options?: { sessionId?: string; recordingId?: string; prompt?: string },
  ): Promise<TranscriptionResult>;
}
