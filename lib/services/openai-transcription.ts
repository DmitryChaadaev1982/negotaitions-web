import OpenAI from "openai";
import type { TranscriptionDiarized } from "openai/resources/audio/transcriptions";

import { ExternalService, ExternalServiceEventSeverity } from "@/app/generated/prisma/client";
import {
  getUniqueSpeakerLabels,
  normalizeDiarizationResponse,
  type NormalizedSegment,
} from "@/lib/transcription/speaker-labels";
import { handleExternalServiceFailure, logExternalServiceEvent } from "@/lib/services/external-service-events";

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function createOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  return new OpenAI({ apiKey });
}

export async function checkOpenAiHealth() {
  if (!isOpenAiConfigured()) {
    return {
      ok: false,
      message: "OpenAI API key is missing.",
    };
  }

  try {
    const client = createOpenAiClient();
    await client.models.list();
    return {
      ok: true,
      message: "OpenAI API key validated.",
    };
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.OPENAI,
      error,
      { context: "health" },
    );
    return {
      ok: false,
      message: classified.message,
    };
  }
}

export type TranscriptionLanguageHint = "ru" | "en" | "auto";

export type TranscriptionWarningCode =
  | "DIARIZATION_FAILED"
  | "NO_SPEAKER_LABELS"
  | "SPEAKER_LABELS_NOT_RETURNED";

export type TranscriptionResult = {
  text: string;
  model: string;
  language: string | null;
  hasSpeakerDiarization: boolean;
  segments: NormalizedSegment[];
  diarizedText: string | null;
  warnings: TranscriptionWarningCode[];
};

const DIARIZATION_MODEL = "gpt-4o-transcribe-diarize";
const PRIMARY_MODEL = "gpt-4o-mini-transcribe";
const FALLBACK_MODEL = "whisper-1";

function isDiarizedResponse(
  response: OpenAI.Audio.Transcriptions.TranscriptionCreateResponse,
): response is TranscriptionDiarized {
  return "segments" in response && Array.isArray(response.segments);
}

async function transcribePlain(
  client: OpenAI,
  file: File,
  model: string,
  language?: string,
) {
  const response = await client.audio.transcriptions.create({
    file,
    model,
    ...(language ? { language } : {}),
  });

  return {
    text: response.text,
    model,
    language: language ?? null,
  };
}

async function transcribeWithDiarization(
  client: OpenAI,
  file: File,
  language: string | undefined,
  options?: { sessionId?: string; recordingId?: string },
): Promise<{
  result: TranscriptionResult | null;
  diarizationError: unknown | null;
}> {
  try {
    const response = await client.audio.transcriptions.create({
      file,
      model: DIARIZATION_MODEL,
      response_format: "diarized_json",
      chunking_strategy: "auto",
      ...(language ? { language } : {}),
    });

    if (!isDiarizedResponse(response)) {
      return {
        result: {
          text: "text" in response ? response.text : "",
          model: DIARIZATION_MODEL,
          language: language ?? null,
          hasSpeakerDiarization: false,
          segments: [],
          diarizedText: null,
          warnings: ["SPEAKER_LABELS_NOT_RETURNED"],
        },
        diarizationError: null,
      };
    }

    const segments = normalizeDiarizationResponse(response);
    const speakerLabels = getUniqueSpeakerLabels(segments);

    if (segments.length === 0 || speakerLabels.length === 0) {
      return {
        result: {
          text: response.text,
          model: DIARIZATION_MODEL,
          language: language ?? null,
          hasSpeakerDiarization: false,
          segments: [],
          diarizedText: null,
          warnings: ["NO_SPEAKER_LABELS"],
        },
        diarizationError: null,
      };
    }

    const diarizedText = segments
      .map((segment) => `[${segment.displaySpeakerLabel}] ${segment.text}`)
      .join("\n\n");

    return {
      result: {
        text: response.text,
        model: DIARIZATION_MODEL,
        language: language ?? null,
        hasSpeakerDiarization: true,
        segments,
        diarizedText,
        warnings: [],
      },
      diarizationError: null,
    };
  } catch (error) {
    await logExternalServiceEvent({
      service: ExternalService.OPENAI,
      severity: ExternalServiceEventSeverity.WARNING,
      errorCode: "TRANSCRIPTION_FAILED",
      title: "Speaker diarization failed",
      message:
        error instanceof Error
          ? error.message
          : "Diarization model failed; falling back to plain transcription.",
      rawError: error,
      sessionId: options?.sessionId,
      recordingId: options?.recordingId,
      context: "diarization",
    });

    return { result: null, diarizationError: error };
  }
}

export async function transcribeAudioBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  languageHint: TranscriptionLanguageHint,
  options?: { sessionId?: string; recordingId?: string },
): Promise<TranscriptionResult> {
  const client = createOpenAiClient();
  const file = new File([new Uint8Array(buffer)], fileName, { type: mimeType });

  const language = languageHint === "auto" ? undefined : languageHint;

  const { result: diarizedResult, diarizationError } =
    await transcribeWithDiarization(client, file, language, options);

  if (diarizedResult) {
    return diarizedResult;
  }

  const warnings: TranscriptionWarningCode[] = diarizationError
    ? ["DIARIZATION_FAILED"]
    : [];

  try {
    const primary = await transcribePlain(client, file, PRIMARY_MODEL, language);
    return {
      ...primary,
      hasSpeakerDiarization: false,
      segments: [],
      diarizedText: null,
      warnings,
    };
  } catch (primaryError) {
    try {
      const fallback = await transcribePlain(client, file, FALLBACK_MODEL, language);
      return {
        ...fallback,
        hasSpeakerDiarization: false,
        segments: [],
        diarizedText: null,
        warnings,
      };
    } catch (fallbackError) {
      const classified = await handleExternalServiceFailure(
        ExternalService.OPENAI,
        fallbackError ?? primaryError,
        {
          sessionId: options?.sessionId,
          recordingId: options?.recordingId,
          context: "transcription",
        },
      );
      throw new Error(classified.message);
    }
  }
}
