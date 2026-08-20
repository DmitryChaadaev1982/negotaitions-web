import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { TranscriptSource } from "@/app/generated/prisma/client";

import { buildCompatibilitySuccessBody } from "@/lib/services/transcribe-recording-compatibility";
import {
  compatibilityTranscribeRecordingPath,
  materialsRetranscribePath,
  materialsTranscribePath,
  nextTranscriptionActionAfterCanonicalFailure,
  OLD_TRANSCRIBE_ROUTE_MODE,
  silentLegacyTranscribeFallbackEnabled,
} from "@/lib/transcription/transcription-routes";

test("F05: canonical failure retries the canonical route and never enables silent fallback", () => {
  assert.equal(OLD_TRANSCRIBE_ROUTE_MODE, "CANONICAL_ADAPTER");
  assert.equal(silentLegacyTranscribeFallbackEnabled(), false);
  assert.equal(nextTranscriptionActionAfterCanonicalFailure(), "retry_canonical");
  assert.equal(
    materialsTranscribePath("session-1"),
    "/api/sessions/session-1/materials/transcribe",
  );
  assert.equal(
    materialsRetranscribePath("session-1"),
    "/api/sessions/session-1/materials/retranscribe",
  );
  assert.equal(
    compatibilityTranscribeRecordingPath("session-1"),
    "/api/sessions/session-1/transcribe-recording",
  );
});

test("F05: canonical transcribe route and runner do not call the old route", () => {
  const transcribeRoute = readFileSync(
    join(process.cwd(), "app/api/sessions/[sessionId]/materials/transcribe/route.ts"),
    "utf8",
  );
  const runner = readFileSync(
    join(process.cwd(), "lib/services/transcription-runner.ts"),
    "utf8",
  );
  assert.doesNotMatch(transcribeRoute, /transcribe-recording/);
  assert.doesNotMatch(runner, /transcribe-recording/);
});

test("F06: normal room and materials UI use the canonical transcribe helpers", () => {
  const panel = readFileSync(
    join(process.cwd(), "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  const section = readFileSync(
    join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  const dashboard = readFileSync(
    join(process.cwd(), "components/session-materials-dashboard.tsx"),
    "utf8",
  );
  assert.match(panel, /materialsTranscribePath/);
  assert.match(panel, /materialsRetranscribePath/);
  assert.doesNotMatch(panel, /transcribe-recording/);
  assert.match(section, /materialsTranscribePath/);
  assert.match(section, /materialsRetranscribePath/);
  assert.doesNotMatch(section, /compatibilityTranscribeRecordingPath/);
  assert.doesNotMatch(section, /\/transcribe-recording`/);
  assert.match(dashboard, /materialsTranscribePath/);
  assert.match(dashboard, /materialsRetranscribePath/);
  assert.doesNotMatch(dashboard, /transcribe-recording/);
});

test("F07: compatibility success body keeps the documented envelope", () => {
  const body = buildCompatibilitySuccessBody({
    transcript: {
      id: "tx-1",
      source: TranscriptSource.GENERATED,
      text: "Mock speaker 1 line. Mock speaker 2 line.",
      diarizedText:
        "[00:00:00-00:00:03] [Speaker 1] Mock speaker 1 line.",
      language: "en",
      transcriptionModel: "mock-transcription",
      hasSpeakerDiarization: true,
      speakerMappingStatus: "REQUIRED",
      speakerMapping: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      segments: [],
    } as never,
    compressedSizeBytes: 2048,
    compressionStatus: "SKIPPED",
  });

  assert.equal(body.transcript.id, "tx-1");
  assert.equal(body.transcript.text, "Mock speaker 1 line. Mock speaker 2 line.");
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.recording, {
    compressedSizeBytes: 2048,
    compressionStatus: "SKIPPED",
  });
});
