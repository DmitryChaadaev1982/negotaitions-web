import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

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

type ActiveAudioOutputPaths = {
  outputDir: string;
  activeAudioPath: string;
  activeTimelinePath: string;
  sourceRecordingInfoPath: string;
  ffmpegCommandPath: string;
  diagnosticsPath: string;
};

export type ActiveAudioBuildDiagnostics = {
  sessionId: string;
  recordingId: string;
  sourceFilePath: string;
  sourcePath: string;
  sourceFileName: string;
  sourceFileSizeBytes: number;
  ffmpegPath: string;
  ffmpegSource: string;
  ffmpegVersion: string | null;
  ffmpegVersionLine: string | null;
  sampleRate: number;
  channels: number;
  intervalCount: number;
  elapsedMs: number;
  outputPath: string;
  outputDir: string;
  cwd: string;
  platform: NodeJS.Platform;
  commandArgs: string[];
  displayCommand: string;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
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

export function resolveActiveAudioOutputPaths(outputDirInput: string): ActiveAudioOutputPaths {
  const outputDir = resolve(outputDirInput);
  return {
    outputDir,
    activeAudioPath: resolve(outputDir, "active-audio.wav"),
    activeTimelinePath: resolve(outputDir, "active-timeline.json"),
    sourceRecordingInfoPath: resolve(outputDir, "source-recording-info.json"),
    ffmpegCommandPath: resolve(outputDir, "ffmpeg-command.txt"),
    diagnosticsPath: resolve(outputDir, "diagnostics.json"),
  };
}

function shellQuoteArg(arg: string): string {
  if (arg === "") {
    return '""';
  }
  if (/[\s"]/u.test(arg)) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function tailText(value: string, maxChars = 8000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(value.length - maxChars);
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

  const sourcePath = resolve(params.sourceFilePath);
  const outputPaths = resolveActiveAudioOutputPaths(params.outputDir);
  const { outputDir, activeAudioPath, activeTimelinePath, sourceRecordingInfoPath, ffmpegCommandPath, diagnosticsPath } =
    outputPaths;
  await mkdir(outputDir, { recursive: true });

  const sourceStat = await stat(sourcePath);
  const graph = buildActiveAudioFilterGraph(params.activeIntervals);
  const sampleRate = getAudioTranscriptionSampleRate();
  const channels = getAudioTranscriptionChannels();
  const commandArgs = [
    "-y",
    "-i",
    sourcePath,
    "-filter_complex",
    graph.filterChain.join(";"),
    "-map",
    `[${graph.concatLabel}]`,
    "-ar",
    String(sampleRate),
    "-ac",
    String(channels),
    "-acodec",
    "pcm_s16le",
    "-f",
    "wav",
    activeAudioPath,
  ];
  const displayCommand = `${shellQuoteArg(ffmpegPath)} ${commandArgs
    .map(shellQuoteArg)
    .join(" ")}`;

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
        sourcePath,
        sourceFileName: basename(params.sourceFilePath),
        sourceFileSizeBytes: sourceStat.size,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    ffmpegCommandPath,
    `${graph.commandPreview}\n\n${displayCommand}\n`,
    "utf8",
  );

  const startedAtMs = Date.now();
  let stdout = "";
  let stderr = "";
  const ffmpegResult = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(ffmpegPath, commandArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        rejectPromise(error);
      });
      child.on("close", (exitCode, signal) => {
        resolvePromise({ exitCode, signal });
      });
    },
  ).catch(async (error) => {
    const elapsedMs = Date.now() - startedAtMs;
    const diagnostics: ActiveAudioBuildDiagnostics = {
      sessionId: params.sessionId,
      recordingId: params.recordingId,
      sourceFilePath: params.sourceFilePath,
      sourcePath,
      sourceFileName: basename(sourcePath),
      sourceFileSizeBytes: sourceStat.size,
      ffmpegPath,
      ffmpegSource: ffmpegStatus.source ?? "unknown",
      ffmpegVersion: getFfmpegVersion(ffmpegPath),
      ffmpegVersionLine: getFfmpegVersion(ffmpegPath),
      sampleRate,
      channels,
      intervalCount: params.activeIntervals.length,
      elapsedMs,
      outputPath: activeAudioPath,
      outputDir,
      cwd: process.cwd(),
      platform: process.platform,
      commandArgs,
      displayCommand,
      exitCode: null,
      stdoutTail: tailText(stdout),
      stderrTail: tailText(stderr),
    };
    await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf8");
    throw new ActiveAudioBuilderError(
      `Failed to build active audio with ffmpeg: ${error instanceof Error ? error.message : "unknown error"}`,
      true,
    );
  });
  const elapsedMs = Date.now() - startedAtMs;
  const ffmpegVersionLine = getFfmpegVersion(ffmpegPath);
  const diagnostics: ActiveAudioBuildDiagnostics = {
    sessionId: params.sessionId,
    recordingId: params.recordingId,
    sourceFilePath: params.sourceFilePath,
    sourcePath,
    sourceFileName: basename(sourcePath),
    sourceFileSizeBytes: sourceStat.size,
    ffmpegPath,
    ffmpegSource: ffmpegStatus.source ?? "unknown",
    ffmpegVersion: ffmpegVersionLine,
    ffmpegVersionLine,
    sampleRate,
    channels,
    intervalCount: params.activeIntervals.length,
    elapsedMs,
    outputPath: activeAudioPath,
    outputDir,
    cwd: process.cwd(),
    platform: process.platform,
    commandArgs,
    displayCommand,
    exitCode: ffmpegResult.exitCode,
    stdoutTail: tailText(stdout),
    stderrTail: tailText(stderr),
  };
  await writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf8");

  if (ffmpegResult.exitCode !== 0) {
    const suffix = diagnostics.stderrTail || diagnostics.stdoutTail || "unknown error";
    throw new ActiveAudioBuilderError(
      `Failed to build active audio with ffmpeg: ffmpeg exited with code ${
        ffmpegResult.exitCode ?? "null"
      }: ${suffix}`,
      true,
    );
  }

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
