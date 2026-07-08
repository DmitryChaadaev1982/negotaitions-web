import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpeg from "fluent-ffmpeg";

import { CompressionStatus, ExternalService } from "@/app/generated/prisma/client";

/**
 * lame MP3 encoder minimum bitrate floor.
 * Values below 32 kbps are not reliably supported by libmp3lame.
 * This constant intentionally guards the encoder, not a configurable setting.
 */
export const MP3_MIN_BITRATE_KBPS = 32;
import {
  getAudioTranscriptionQualityProfile,
  getAudioTranscriptionChannels,
  getAudioTranscriptionMaxFileBytes,
  getAudioTranscriptionSampleRate,
  getAudioTranscriptionTargetBitrateKbps,
} from "@/lib/audio/config";
import {
  getFfmpegStatus,
  type FfmpegSource,
  type FfmpegStatus,
} from "@/lib/audio/ffmpeg";
import { shouldReuseOriginalAudioForTranscription } from "@/lib/audio/transcription-file-selection";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import { prisma } from "@/lib/prisma";

export { getFfmpegStatus };
export type { FfmpegSource, FfmpegStatus };

export type CompressionResult = {
  compressedBuffer: Buffer;
  compressedFileName: string;
  compressedMimeType: string;
  compressedSizeBytes: number;
  codecUsed: "libopus" | "libmp3lame" | "pcm_s16le" | "passthrough";
  bitrateUsed: number;
};

function getFfmpegPath() {
  return getFfmpegStatus().path ?? undefined;
}

export function isFfmpegAvailable() {
  return getFfmpegStatus().available;
}

export async function checkFfmpegHealth() {
  const status = getFfmpegStatus();

  if (!status.available || !status.path) {
    return {
      ok: false,
      message: "ffmpeg is not available on the server.",
      path: status.path,
      source: status.source,
    };
  }

  return new Promise<{
    ok: boolean;
    message: string;
    path?: string;
    source?: FfmpegSource | null;
  }>((resolve) => {
    ffmpeg()
      .setFfmpegPath(status.path!)
      .getAvailableFormats((error) => {
        if (error) {
          resolve({
            ok: false,
            message: error.message || "ffmpeg health check failed.",
            path: status.path ?? undefined,
            source: status.source,
          });
          return;
        }

        resolve({
          ok: true,
          message: "ffmpeg is available.",
          path: status.path ?? undefined,
          source: status.source,
        });
      });
  });
}

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  options: {
    codec: "libopus" | "libmp3lame" | "pcm_s16le";
    bitrateKbps: number;
    sampleRate: number;
    channels: number;
    format: "webm" | "mp3" | "wav";
  },
) {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("ffmpeg is not available on the server.");
  }

  return new Promise<void>((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .setFfmpegPath(ffmpegPath)
      .noVideo()
      .audioCodec(options.codec)
      .audioFrequency(options.sampleRate)
      .audioChannels(options.channels)
      .format(options.format);

    if (options.codec !== "pcm_s16le") {
      command.audioBitrate(`${options.bitrateKbps}k`);
    }

    command
      .on("error", (error) => reject(error))
      .on("end", () => resolve())
      .save(outputPath);
  });
}

function inferMimeTypeFromFileName(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".mp3")) return "audio/mpeg";
  if (normalized.endsWith(".wav")) return "audio/wav";
  if (normalized.endsWith(".ogg")) return "audio/ogg";
  if (normalized.endsWith(".opus")) return "audio/ogg";
  if (normalized.endsWith(".webm")) return "audio/webm";
  return "application/octet-stream";
}

export async function compressAudioForTranscription(
  inputBuffer: Buffer,
  inputFileName: string,
  options?: {
    recordingId?: string;
    sessionId?: string;
    forceTranscode?: boolean;
    probe?: {
      container?: string | null;
      codec?: string | null;
      sampleRate?: number | null;
      channels?: number | null;
      probeAvailable?: boolean;
    } | null;
  },
) {
  const qualityProfile = getAudioTranscriptionQualityProfile();
  const sampleRate = getAudioTranscriptionSampleRate();
  const channels = getAudioTranscriptionChannels();
  const targetBitrateKbps = getAudioTranscriptionTargetBitrateKbps();

  const tempDir = await mkdtemp(join(tmpdir(), "negotaitions-audio-"));
  const inputPath = join(tempDir, inputFileName);
  const webmPath = join(tempDir, "transcription.webm");
  const mp3Path = join(tempDir, "transcription.mp3");

  if (options?.recordingId) {
    await prisma.recording.update({
      where: { id: options.recordingId },
      data: { compressionStatus: CompressionStatus.COMPRESSING },
    });
  }

  try {
    const reuseOriginalDecision = shouldReuseOriginalAudioForTranscription(
      inputBuffer.length,
      inputFileName,
      getAudioTranscriptionMaxFileBytes(),
      options?.probe,
    );
    if (!options?.forceTranscode && reuseOriginalDecision.shouldReuseOriginal) {
      if (options?.recordingId) {
        await prisma.recording.update({
          where: { id: options.recordingId },
          data: { compressionStatus: CompressionStatus.SKIPPED, compressionError: null },
        });
      }
      return {
        compressedBuffer: inputBuffer,
        compressedFileName: inputFileName,
        compressedMimeType: inferMimeTypeFromFileName(inputFileName),
        compressedSizeBytes: inputBuffer.length,
        codecUsed: "passthrough" as const,
        bitrateUsed: 0,
      };
    }

    await writeFile(inputPath, inputBuffer);

    if (qualityProfile === "diagnostic") {
      const wavPath = join(tempDir, "transcription.wav");
      await runFfmpeg(inputPath, wavPath, {
        codec: "pcm_s16le",
        bitrateKbps: targetBitrateKbps,
        sampleRate,
        channels,
        format: "wav",
      });
      const compressedBuffer = await readFile(wavPath);
      if (options?.recordingId) {
        await prisma.recording.update({
          where: { id: options.recordingId },
          data: { compressionStatus: CompressionStatus.COMPLETED, compressionError: null },
        });
      }
      return {
        compressedBuffer,
        compressedFileName: "transcription.wav",
        compressedMimeType: "audio/wav",
        compressedSizeBytes: compressedBuffer.length,
        codecUsed: "pcm_s16le" as const,
        bitrateUsed: targetBitrateKbps,
      };
    }

    try {
      await runFfmpeg(inputPath, webmPath, {
        codec: "libopus",
        bitrateKbps: targetBitrateKbps,
        sampleRate,
        channels,
        format: "webm",
      });

      const compressedBuffer = await readFile(webmPath);

      if (options?.recordingId) {
        await prisma.recording.update({
          where: { id: options.recordingId },
          data: { compressionStatus: CompressionStatus.COMPLETED, compressionError: null },
        });
      }

      return {
        compressedBuffer,
        compressedFileName: "transcription.webm",
        compressedMimeType: "audio/webm",
        compressedSizeBytes: compressedBuffer.length,
        codecUsed: "libopus" as const,
        bitrateUsed: targetBitrateKbps,
      };
    } catch {
      const mp3BitrateKbps = Math.max(targetBitrateKbps, MP3_MIN_BITRATE_KBPS);
      await runFfmpeg(inputPath, mp3Path, {
        codec: "libmp3lame",
        bitrateKbps: mp3BitrateKbps,
        sampleRate,
        channels,
        format: "mp3",
      });

      const compressedBuffer = await readFile(mp3Path);

      if (options?.recordingId) {
        await prisma.recording.update({
          where: { id: options.recordingId },
          data: { compressionStatus: CompressionStatus.COMPLETED, compressionError: null },
        });
      }

      return {
        compressedBuffer,
        compressedFileName: "transcription.mp3",
        compressedMimeType: "audio/mpeg",
        compressedSizeBytes: compressedBuffer.length,
        codecUsed: "libmp3lame" as const,
        bitrateUsed: mp3BitrateKbps,
      };
    }
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.FFMPEG,
      error,
      {
        recordingId: options?.recordingId,
        sessionId: options?.sessionId,
      },
    );

    if (options?.recordingId) {
      await prisma.recording.update({
        where: { id: options.recordingId },
        data: {
          compressionStatus: CompressionStatus.FAILED,
          compressionError: classified.message,
        },
      });
    }

    throw new Error(classified.message);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
