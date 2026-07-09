import assert from "node:assert/strict";
import test from "node:test";

import {
  getPauseProcessingMode,
  getPauseSourceAudioDebugDir,
} from "@/lib/env";

test("PAUSE_PROCESSING_MODE defaults to source_audio_cut", () => {
  const previous = process.env.PAUSE_PROCESSING_MODE;
  delete process.env.PAUSE_PROCESSING_MODE;
  try {
    assert.equal(getPauseProcessingMode(), "source_audio_cut");
  } finally {
    if (previous === undefined) {
      delete process.env.PAUSE_PROCESSING_MODE;
    } else {
      process.env.PAUSE_PROCESSING_MODE = previous;
    }
  }
});

test("PAUSE_PROCESSING_MODE supports explicit transcript_interval_filter legacy fallback", () => {
  const previous = process.env.PAUSE_PROCESSING_MODE;
  process.env.PAUSE_PROCESSING_MODE = "transcript_interval_filter";
  try {
    assert.equal(getPauseProcessingMode(), "transcript_interval_filter");
  } finally {
    if (previous === undefined) {
      delete process.env.PAUSE_PROCESSING_MODE;
    } else {
      process.env.PAUSE_PROCESSING_MODE = previous;
    }
  }
});

test("invalid PAUSE_PROCESSING_MODE falls back to source_audio_cut and logs warning", () => {
  const previousMode = process.env.PAUSE_PROCESSING_MODE;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  process.env.PAUSE_PROCESSING_MODE = "invalid_mode";
  console.warn = (message?: unknown, ...optionalParams: unknown[]) => {
    warnings.push([message, ...optionalParams].join(" "));
  };
  try {
    assert.equal(getPauseProcessingMode(), "source_audio_cut");
    assert.equal(warnings.length > 0, true);
    assert.equal(
      warnings.some(
        (message) =>
          message.includes("Invalid PAUSE_PROCESSING_MODE") &&
          message.includes("source_audio_cut"),
      ),
      true,
    );
  } finally {
    console.warn = originalWarn;
    if (previousMode === undefined) {
      delete process.env.PAUSE_PROCESSING_MODE;
    } else {
      process.env.PAUSE_PROCESSING_MODE = previousMode;
    }
  }
});

test("PAUSE_SOURCE_AUDIO_DEBUG_DIR defaults and supports override", () => {
  const previous = process.env.PAUSE_SOURCE_AUDIO_DEBUG_DIR;
  delete process.env.PAUSE_SOURCE_AUDIO_DEBUG_DIR;
  try {
    assert.equal(getPauseSourceAudioDebugDir(), ".debug/pause-source-audio");
    process.env.PAUSE_SOURCE_AUDIO_DEBUG_DIR = ".debug/custom-source-audio";
    assert.equal(getPauseSourceAudioDebugDir(), ".debug/custom-source-audio");
  } finally {
    if (previous === undefined) {
      delete process.env.PAUSE_SOURCE_AUDIO_DEBUG_DIR;
    } else {
      process.env.PAUSE_SOURCE_AUDIO_DEBUG_DIR = previous;
    }
  }
});
