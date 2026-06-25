import { getAudioTranscriptionMaxFileBytes } from "@/lib/audio/config";

/**
 * Throws if the compressed audio buffer exceeds the configured transcription
 * file-size limit (AUDIO_TRANSCRIPTION_MAX_FILE_MB).
 *
 * Centralises the check that was previously duplicated in both transcription
 * routes. Throws a plain Error so callers can inspect message and return 413.
 */
export function assertCompressedAudioWithinLimit(
  sizeBytes: number,
  context?: string,
): void {
  const maxBytes = getAudioTranscriptionMaxFileBytes();
  if (sizeBytes > maxBytes) {
    const ctx = context ? ` (${context})` : "";
    throw new AudioFileTooLargeError(sizeBytes, maxBytes, ctx);
  }
}

export class AudioFileTooLargeError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(sizeBytes: number, maxBytes: number, context = "") {
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(2);
    super(
      `Compressed audio is too large for transcription${context}: ${sizeMb} MB (limit: ${maxMb} MB).`,
    );
    this.name = "AudioFileTooLargeError";
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}
