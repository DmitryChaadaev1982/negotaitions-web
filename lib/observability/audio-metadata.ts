import "server-only";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { getFfmpegStatus } from "@/lib/audio/ffmpeg";

/**
 * Phase 7 — audio capture quality investigation hook (observability only).
 *
 * Captures actual container/codec/sample-rate/channels/bitrate/duration of a
 * recording via ffprobe so we can determine where the observed "mono FLAC
 * 8 kHz" characteristic originates and feed real values into the transcript
 * quality warnings (low_sample_rate / mono_source).
 *
 * Fully graceful: if ffprobe is unavailable, returns `probeAvailable=false`
 * and null metrics. Never throws, never blocks the transcription run.
 */

export type SourceAudioMetadata = {
  probeAvailable: boolean;
  container: string | null;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  durationSeconds: number | null;
  fileSizeBytes: number;
  isLowSampleRate: boolean;
  isMono: boolean;
  probeError: string | null;
};

const LOW_SAMPLE_RATE_HZ = 16000;

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
};

type FfprobePayload = {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
};

function verify(candidate: string): boolean {
  try {
    const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve an ffprobe binary. Preference: FFPROBE_BIN → PATH → alongside the
 * resolved ffmpeg binary (some ffmpeg installs ship ffprobe in the same dir).
 */
function resolveFfprobeCommand(): string | null {
  const custom = process.env.FFPROBE_BIN?.trim();
  if (custom && verify(custom)) return custom;

  try {
    const lookup = process.platform === "win32" ? "where.exe" : "which";
    const resolved = spawnSync(lookup, ["ffprobe"], { encoding: "utf8" });
    if (!resolved.error && resolved.status === 0) {
      const first = resolved.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (first && verify(first)) return first;
    }
  } catch {
    // fall through
  }

  const ffmpeg = getFfmpegStatus();
  if (ffmpeg.path) {
    const executable = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    const sibling = join(dirname(ffmpeg.path), executable);
    if (existsSync(sibling) && verify(sibling)) return sibling;
  }

  return null;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyMetadata(fileSizeBytes: number, probeError: string | null): SourceAudioMetadata {
  return {
    probeAvailable: false,
    container: null,
    codec: null,
    sampleRate: null,
    channels: null,
    bitrateKbps: null,
    durationSeconds: null,
    fileSizeBytes,
    isLowSampleRate: false,
    isMono: false,
    probeError,
  };
}

/**
 * Probe an audio buffer. Writes to a temp file (reliable seeking for all
 * containers) and runs ffprobe. Always resolves; never throws.
 */
export async function probeAudioBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<SourceAudioMetadata> {
  const ffprobe = resolveFfprobeCommand();
  if (!ffprobe) {
    return emptyMetadata(buffer.length, "ffprobe_unavailable");
  }

  let tempDir: string | null = null;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "negotaitions-probe-"));
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "recording";
    const inputPath = join(tempDir, safeName);
    await writeFile(inputPath, buffer);

    const probe = spawnSync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name,duration,bit_rate:stream=codec_type,codec_name,sample_rate,channels,bit_rate",
        "-of",
        "json",
        inputPath,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );

    if (probe.error || probe.status !== 0) {
      return emptyMetadata(buffer.length, "ffprobe_failed");
    }

    const payload = JSON.parse(probe.stdout) as FfprobePayload;
    const audioStream = (payload.streams ?? []).find(
      (stream) => stream.codec_type === "audio",
    );
    const format = payload.format ?? {};

    const sampleRate = toNumberOrNull(audioStream?.sample_rate);
    const channels =
      typeof audioStream?.channels === "number" ? audioStream.channels : null;
    const streamBitrate = toNumberOrNull(audioStream?.bit_rate);
    const fileBitrate = toNumberOrNull(format.bit_rate);
    const bitrate = streamBitrate ?? fileBitrate;

    return {
      probeAvailable: true,
      container: format.format_name ?? null,
      codec: audioStream?.codec_name ?? null,
      sampleRate,
      channels,
      bitrateKbps: bitrate !== null ? Math.round(bitrate / 1000) : null,
      durationSeconds: toNumberOrNull(format.duration),
      fileSizeBytes: buffer.length,
      isLowSampleRate: sampleRate !== null && sampleRate <= LOW_SAMPLE_RATE_HZ,
      isMono: channels !== null && channels <= 1,
      probeError: null,
    };
  } catch {
    return emptyMetadata(buffer.length, "probe_exception");
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
