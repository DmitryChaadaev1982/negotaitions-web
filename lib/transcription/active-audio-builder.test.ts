import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import { getFfmpegStatus } from "@/lib/audio/ffmpeg";
import {
  ActiveAudioBuilderError,
  buildActiveAudioFilterGraph,
  buildActiveAudioFromRecording,
  resolveActiveAudioOutputPaths,
} from "@/lib/transcription/active-audio-builder";

test("buildActiveAudioFilterGraph builds concat pipeline for active intervals", () => {
  const graph = buildActiveAudioFilterGraph([
    {
      partIndex: 0,
      realStartMs: 0,
      realEndMs: 20_000,
      activeStartMs: 0,
      activeEndMs: 20_000,
      durationMs: 20_000,
    },
    {
      partIndex: 1,
      realStartMs: 30_000,
      realEndMs: 70_000,
      activeStartMs: 20_000,
      activeEndMs: 60_000,
      durationMs: 40_000,
    },
  ]);

  assert.equal(graph.concatLabel, "active_out");
  assert.equal(graph.filterChain.length, 3);
  assert.ok(graph.filterChain[0]?.includes("atrim=start=0.000000:end=20.000000"));
  assert.ok(graph.filterChain[1]?.includes("atrim=start=30.000000:end=70.000000"));
  assert.ok(graph.filterChain[2]?.includes("concat=n=2:v=0:a=1[active_out]"));
});

test("resolveActiveAudioOutputPaths resolves relative debug dir to absolute paths", () => {
  const paths = resolveActiveAudioOutputPaths(".debug/pause-source-audio/session-1");
  assert.equal(isAbsolute(paths.outputDir), true);
  assert.equal(isAbsolute(paths.activeAudioPath), true);
  assert.equal(paths.activeAudioPath.endsWith("active-audio.wav"), true);
  assert.equal(paths.ffmpegCommandPath.endsWith("ffmpeg-command.txt"), true);
});

test("source_audio_cut ffmpeg failure is explicit and writes diagnostics", async (t) => {
  const ffmpegStatus = getFfmpegStatus();
  if (!ffmpegStatus.available) {
    t.skip("ffmpeg is unavailable in this environment");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "active-audio-builder-test-"));
  try {
    const sourcePath = join(root, "source-recording.wav");
    // Intentionally invalid wav payload to force ffmpeg decode failure.
    await writeFile(sourcePath, Buffer.from("not-a-real-wav-file"), "utf8");
    const outputDir = join(root, "nested", "debug-output");

    await assert.rejects(
      () =>
        buildActiveAudioFromRecording({
          sourceFilePath: sourcePath,
          activeIntervals: [
            {
              partIndex: 0,
              realStartMs: 0,
              realEndMs: 1_000,
              activeStartMs: 0,
              activeEndMs: 1_000,
              durationMs: 1_000,
            },
          ],
          outputDir,
          sessionId: "session-test",
          recordingId: "recording-test",
        }),
      (error: unknown) => error instanceof ActiveAudioBuilderError,
    );

    const diagnosticsPath = join(outputDir, "diagnostics.json");
    await access(diagnosticsPath);
    const diagnostics = JSON.parse(await readFile(diagnosticsPath, "utf8")) as {
      outputPath: string;
      outputDir: string;
      stderrTail: string;
      commandArgs: string[];
    };
    assert.equal(isAbsolute(diagnostics.outputPath), true);
    assert.equal(isAbsolute(diagnostics.outputDir), true);
    assert.equal(diagnostics.commandArgs.at(-1), diagnostics.outputPath);
    assert.equal(diagnostics.stderrTail.length > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
