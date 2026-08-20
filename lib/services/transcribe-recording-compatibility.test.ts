import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { TranscriptSource } from "@/app/generated/prisma/client";
import {
  buildCompatibilitySuccessBody,
  COMPATIBILITY_TRANSCRIBE_ROUTE_MODE,
  serializeCompatibilityTranscript,
} from "@/lib/services/transcribe-recording-compatibility";

test("F07 old-route mode is the canonical adapter", () => {
  assert.equal(COMPATIBILITY_TRANSCRIBE_ROUTE_MODE, "CANONICAL_ADAPTER");
});

test("F07 compatibility success body keeps the historical JSON shape", () => {
  const updatedAt = new Date("2026-08-19T12:00:00.000Z");
  const transcript = {
    id: "tr-1",
    source: TranscriptSource.GENERATED,
    text: "Mock speaker 1 line. Mock speaker 2 line.",
    diarizedText: "[Speaker 1] Mock speaker 1 line.",
    language: "en",
    transcriptionModel: "mock-transcription",
    hasSpeakerDiarization: true,
    speakerMappingStatus: "REQUIRED",
    speakerMapping: null,
    updatedAt,
    segments: [
      {
        id: "seg-1",
        speakerLabel: "speaker_1",
        mappedParticipantId: null,
        startSeconds: 0,
        endSeconds: 3,
        text: "Mock speaker 1 line.",
        orderIndex: 0,
      },
    ],
  };
  const serialized = serializeCompatibilityTranscript(transcript);
  assert.equal(serialized.id, "tr-1");
  assert.equal(serialized.text, "Mock speaker 1 line. Mock speaker 2 line.");
  assert.equal(serialized.segments.length, 1);
  assert.equal(serialized.updatedAt, updatedAt.toISOString());

  const body = buildCompatibilitySuccessBody({
    transcript,
    compressedSizeBytes: 1024,
    compressionStatus: "SKIPPED",
  });
  assert.ok(body.transcript);
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.recording, {
    compressedSizeBytes: 1024,
    compressionStatus: "SKIPPED",
  });
});

test("F07 compatibility route no longer contains an independent provider writer", async () => {
  const source = await readFile(
    path.join(
      process.cwd(),
      "app/api/sessions/[sessionId]/transcribe-recording/route.ts",
    ),
    "utf8",
  );
  assert.match(source, /admitTranscriptionRun/);
  assert.match(source, /executeClaimedTranscription/);
  assert.match(source, /buildCompatibilitySuccessBody/);
  assert.equal(source.includes("transcribeAudioBuffer"), false);
  assert.equal(source.includes("compressAudioForTranscription"), false);
});
