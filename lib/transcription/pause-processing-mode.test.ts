import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveTimelineFromMetadata,
  getPauseProcessingModeFromMetadata,
} from "@/lib/transcription/pause-processing-mode";

test("metadata mode defaults to transcript interval filter", () => {
  assert.equal(getPauseProcessingModeFromMetadata(null), "transcript_interval_filter");
  assert.equal(
    getPauseProcessingModeFromMetadata({ pauseProcessing: { mode: "unknown" } }),
    "transcript_interval_filter",
  );
});

test("metadata mode resolves source audio cut", () => {
  assert.equal(
    getPauseProcessingModeFromMetadata({
      pauseProcessing: { mode: "source_audio_cut" },
    }),
    "source_audio_cut",
  );
});

test("active timeline is extracted from metadata", () => {
  const timeline = getActiveTimelineFromMetadata({
    pauseProcessing: {
      activeTimelineMap: {
        activeIntervals: [
          {
            partIndex: 0,
            realStartMs: 0,
            realEndMs: 10_000,
            activeStartMs: 0,
            activeEndMs: 10_000,
            durationMs: 10_000,
          },
        ],
      },
    },
  });
  assert.equal(timeline?.length, 1);
  assert.equal(timeline?.[0]?.realStartMs, 0);
});
