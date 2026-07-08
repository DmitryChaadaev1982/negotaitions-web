import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import ffmpeg from "fluent-ffmpeg";

import {
  getAudioTranscriptionChannels,
  getAudioTranscriptionSampleRate,
} from "@/lib/audio/config";
import { getFfmpegStatus, getFfmpegVersion } from "@/lib/audio/ffmpeg";
import type { ActiveTimelineInterval } from "@/lib/transcription/active-audio-timeline";

type BuildActiveAudioFilterGraphResult = {
  filterChain: string[];
  concatLabel: string;
  commandPreview: string;
};

export type ActiveAudioBuildDiagnostics = {
  sessionId: string;
  recordingId: string;
  sourceFilePath: string;
  sourceFileName: string;
  sourceFileSizeBytes: number;
  ffmpegPath: string;
  ffmpegSource: string;
  ffmpegVersion: string | null;
  sampleRate: number;
  channels: number;
  intervalCount: number;
  elapsedMs: number;
};

export type ActiveAudioBuildResult = {
  activeAudioPath: string;
  activeTimelinePath: string;
  sourceRecordingInfoPath: string;
  ffmpegCommandPath: string;
  diagnosticsPath: string;
  diagnostics: ActiveAudioBuildDiagnostics;
};

export class ActiveAudioBuilderError extends Error {
  readonly recoverable: boolean;

  constructor(message: string, recoverable = true) {
    super(message);
    this.name = "ActiveAudioBuilderError";
    this.recoverable = recoverable;
  }
}

function toFfmpegSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(6);
}

export function buildActiveAudioFilterGraph(
  activeIntervals: ActiveTimelineInterval[],
): BuildActiveAudioFilterGraphResult {
  if (activeIntervals.length === 0) {
    throw new ActiveAudioBuilderError(
      "Cannot build active audio: active timeline has no intervals.",
      true,
    );
  }

  const filterChain = activeIntervals.map(
    (interval, index) =>
      `[0:a]atrim=start=${toFfmpegSeconds(interval.realStartMs)}:end=${toFfmpegSeconds(
        interval.realEndMs,
      )},asetpts=PTS-STARTPTS[a${index}]`,
  );
  const concatInputs = activeIntervals.map((_, index) => `[a${index}]`).join("");
  const concatLabel = "active_out";
  filterChain.push(`${concatInputs}concat=n=${activeIntervals.length}:v=0:a=1[${concatLabel}]`);

  return {
    filterChain,
    concatLabel,
    commandPreview: `-i <source> -filter_complex "${filterChain.join(";")}" -map [${concatLabel}] -ar ${getAudioTranscriptionSampleRate()} -ac ${getAudioTranscriptionChannels()} -acodec pcm_s16le -f wav active-audio.wav`,
  };
}

export async function buildActiveAudioFromRecording(params: {
  sourceFilePath: string;
  activeIntervals: ActiveTimelineInterval[];
  outputDir: string;
  sessionId: string;
  recordingId: string;
}): Promise<ActiveAudioBuildResult> {
  const ffmpegStatus = getFfmpegStatus();
  const ffmpegPath = ffmpegStatus.path;
  if (!ffmpegStatus.available || !ffmpegPath) {
    throw new ActiveAudioBuilderError(
      "ffmpeg is not available; cannot build active-only audio for source_audio_cut mode. Install ffmpeg or set FFMPEG_PATH/FFMPEG_BIN.",
      true,
    );
  }
  if (params.activeIntervals.length === 0) {
    throw new ActiveAudioBuilderError(
      "Cannot build active audio: active timeline has no intervals.",
      true,
    );
  }

  await mkdir(params.outputDir, { recursive: true });
  const activeAudioPath = join(params.outputDir, "active-audio.wav");
  const activeTimelinePath = join(params.outputDir, "active-timeline.json");
  const sourceRecordingInfoPath = join(params.outputDir, "source-recording-info.json");
  const ffmpegCommandPath = join(params.outputDir, "ffmpeg-command.txt");
  const diagnosticsPath = join(params.outputDir, "diagnostics.json");

  const sourceStat = await stat(params.sourceFilePath);
  const graph = buildActiveAudioFilterGraph(params.activeIntervals);
  const sampleRate = getAudioTranscriptionSampleRate();
  const channels = getAudioTranscriptionChannels();

  await writeFile(
    activeTimelinePath,
    JSON.stringify(
      {
        sessionId: params.sessionId,
        recordingId: params.recordingId,
        activeIntervals: params.activeIntervals,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    sourceRecordingInfoPath,
    JSON.stringify(
      {
        sourceFilePath: params.sourceFilePath,
        sourceFileName: basename(params.sourceFilePath),
        sourceFileSizeBytes: sourceStat.size,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(ffmpegCommandPath, graph.commandPreview, "utf8");

  const startedAtMs = Date.now();
  await new Promise<void>((resolve, reject) => {
    ffmpeg(params.sourceFilePath)
      .setFfmpegPath(ffmpegPath)
      .noVideo()
      .complexFilter(graph.filterChain, graph.concatLabel)
      .outputOptions([
        "-map",
        `[${graph.concatLabel}]`,
        "-ar",
        String(sampleRate),
        "-ac",
        String(channels),
      ])
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("error", (error) => reject(error))
      .on("end", () => resolve())
      .save(activeAudioPath);
  }).catch((error) => {
    throw new ActiveAudioBuilderError(
      `Failed to build active audio with ffmpeg: ${error instanceof Error ? error.message : "unknown error"}`,
      true,
    );
  });

  const elapsedMs = Date.now() - startedAtMs;
  const diagnostics: ActiveAudioBuildDiagnostics = {
    sessionId: params.sessionId,
    recordingId: params.recordingId,
    sourceFilePath: params.sourceFilePath,
    sourceFileName: basename(params.sourceFilePath),
    sourceFileSizeBytes: sourceStat.size,
    ffmpegPath,
    ffmpegSource: ffmpegStatus.source ?? "unknown",
    ffmpegVersion: getFfmpegVersion(ffmpegPath),
    sampleRate,
    channels,
    intervalCount: params.activeIntervals.length,
    elapsedMs,
  };
  await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf8");

  const activeBuffer = await readFile(activeAudioPath);
  if (activeBuffer.length === 0) {
    throw new ActiveAudioBuilderError("Built active audio file is empty.", true);
  }

  return {
    activeAudioPath,
    activeTimelinePath,
    sourceRecordingInfoPath,
    ffmpegCommandPath,
    diagnosticsPath,
    diagnostics,
  };
}
