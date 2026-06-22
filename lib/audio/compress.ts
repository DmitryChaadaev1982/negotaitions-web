import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpeg from "fluent-ffmpeg";

import { CompressionStatus, ExternalService } from "@/app/generated/prisma/client";
import {
  getAudioTranscriptionChannels,
  getAudioTranscriptionSampleRate,
  getAudioTranscriptionTargetBitrateKbps,
} from "@/lib/audio/config";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import { prisma } from "@/lib/prisma";

export type CompressionResult = {
  compressedBuffer: Buffer;
  compressedFileName: string;
  compressedMimeType: string;
  compressedSizeBytes: number;
  codecUsed: "libopus" | "libmp3lame";
  bitrateUsed: number;
};

export type FfmpegSource = "env" | "system" | "static";

export type FfmpegStatus = {
  available: boolean;
  path: string | null;
  source: FfmpegSource | null;
};

const require = createRequire(import.meta.url);

function verifyFfmpegExecutable(candidate: string) {
  const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function resolveSystemFfmpegPath() {
  try {
    const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
    const lookup = spawnSync(lookupCommand, ["ffmpeg"], { encoding: "utf8" });

    if (lookup.error || lookup.status !== 0) {
      return undefined;
    }

    const candidate = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (!candidate || !verifyFfmpegExecutable(candidate)) {
      return undefined;
    }

    return candidate;
  } catch {
    return undefined;
  }
}

function resolveStaticFfmpegPath() {
  try {
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath && existsSync(staticPath) && verifyFfmpegExecutable(staticPath)) {
      return staticPath;
    }
  } catch {
    // ffmpeg-static may be missing in some deployments.
  }

  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const fallback = join(process.cwd(), "node_modules", "ffmpeg-static", executableName);

  if (existsSync(fallback) && verifyFfmpegExecutable(fallback)) {
    return fallback;
  }

  return undefined;
}

export function getFfmpegStatus(): FfmpegStatus {
  const customPath = process.env.FFMPEG_BIN?.trim();
  if (customPath && verifyFfmpegExecutable(customPath)) {
    return { available: true, path: customPath, source: "env" };
  }

  const systemPath = resolveSystemFfmpegPath();
  if (systemPath) {
    return { available: true, path: systemPath, source: "system" };
  }

  const staticPath = resolveStaticFfmpegPath();
  if (staticPath) {
    return { available: true, path: staticPath, source: "static" };
  }

  return { available: false, path: null, source: null };
}

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
    codec: "libopus" | "libmp3lame";
    bitrateKbps: number;
    sampleRate: number;
    channels: number;
    format: "webm" | "mp3";
  },
) {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("ffmpeg is not available on the server.");
  }

  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .setFfmpegPath(ffmpegPath)
      .noVideo()
      .audioCodec(options.codec)
      .audioBitrate(`${options.bitrateKbps}k`)
      .audioFrequency(options.sampleRate)
      .audioChannels(options.channels)
      .format(options.format)
      .on("error", (error) => reject(error))
      .on("end", () => resolve())
      .save(outputPath);
  });
}

export async function compressAudioForTranscription(
  inputBuffer: Buffer,
  inputFileName: string,
  options?: { recordingId?: string; sessionId?: string },
) {
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
    await writeFile(inputPath, inputBuffer);

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
          data: { compressionStatus: CompressionStatus.COMPLETED },
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
      await runFfmpeg(inputPath, mp3Path, {
        codec: "libmp3lame",
        bitrateKbps: Math.max(targetBitrateKbps, 32),
        sampleRate,
        channels,
        format: "mp3",
      });

      const compressedBuffer = await readFile(mp3Path);

      if (options?.recordingId) {
        await prisma.recording.update({
          where: { id: options.recordingId },
          data: { compressionStatus: CompressionStatus.COMPLETED },
        });
      }

      return {
        compressedBuffer,
        compressedFileName: "transcription.mp3",
        compressedMimeType: "audio/mpeg",
        compressedSizeBytes: compressedBuffer.length,
        codecUsed: "libmp3lame" as const,
        bitrateUsed: Math.max(targetBitrateKbps, 32),
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
