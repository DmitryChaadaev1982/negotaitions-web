import {
  isOpenAiConfigured,
  transcribeAudioBuffer as transcribeAudioBufferWithOpenAi,
  type TranscriptionLanguageHint,
  type TranscriptionResult,
  type TranscriptionWarningCode,
} from "@/lib/services/openai-transcription";
import { transcribeAudioBufferWithYandexSpeechKit } from "@/lib/services/yandex-speechkit-transcription";
import {
  getTranscriptionProvider,
  isYandexSpeechKitConfigured,
  type TranscriptionProvider,
} from "@/lib/env";
import type { TranscriptionProvider as TranscriptionProviderContract } from "@/lib/services/provider-interfaces";

export type {
  TranscriptionLanguageHint,
  TranscriptionResult,
  TranscriptionWarningCode,
};

export function getSelectedTranscriptionProvider(): TranscriptionProvider {
  return getTranscriptionProvider();
}

export function isTranscriptionConfiguredForSelectedProvider(): boolean {
  const provider = getTranscriptionProvider();
  if (provider === "yandex_speechkit") {
    return isYandexSpeechKitConfigured();
  }
  return isOpenAiConfigured();
}

export async function transcribeAudioBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  languageHint: TranscriptionLanguageHint,
  options?: { sessionId?: string; recordingId?: string; prompt?: string },
): Promise<TranscriptionResult> {
  const provider = getTranscriptionProvider();
  const providers: Record<TranscriptionProvider, TranscriptionProviderContract> = {
    openai: {
      transcribe: (audio, originalFileName, originalMimeType, hint, inputOptions) =>
        transcribeAudioBufferWithOpenAi(
          audio,
          originalFileName,
          originalMimeType,
          hint,
          inputOptions,
        ),
    },
    yandex_speechkit: {
      transcribe: (audio, originalFileName, originalMimeType, hint) =>
        transcribeAudioBufferWithYandexSpeechKit(audio, hint, {
          fileName: originalFileName,
          mimeType: originalMimeType,
        }),
    },
  };

  return providers[provider].transcribe(
    buffer,
    fileName,
    mimeType,
    languageHint,
    options,
  );
}
