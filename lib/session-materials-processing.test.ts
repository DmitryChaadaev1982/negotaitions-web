import assert from "node:assert/strict";
import test from "node:test";

import { resolveRecordingProcessingStatus } from "@/lib/session-materials-processing";

test("STARTING recording is shown as in progress", () => {
  assert.equal(
    resolveRecordingProcessingStatus({
      status: "STARTING",
      fileUrl: null,
      updatedAt: null,
      errorMessage: null,
    }),
    "in_progress",
  );
});

test("RECORDING is shown as in progress until completion", () => {
  assert.equal(
    resolveRecordingProcessingStatus({
      status: "RECORDING",
      fileUrl: null,
      updatedAt: null,
      errorMessage: null,
    }),
    "in_progress",
  );
});

test("COMPLETED recording is shown as ready", () => {
  assert.equal(
    resolveRecordingProcessingStatus({
      status: "COMPLETED",
      fileUrl: "https://example.com/file.mp4",
      updatedAt: null,
      errorMessage: null,
    }),
    "ready",
  );
});
