import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getRecordingDisplayPresentation,
  getRecordingDisplayState,
} from "@/lib/recording-display-state";

describe("getRecordingDisplayState", () => {
  it("maps active recording to active", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "RECORDING",
      }),
      "active",
    );
  });

  it("maps paused recording to paused", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "PAUSED",
      }),
      "paused",
    );
  });

  it("maps durable stop intent to stopping before terminal status", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "RECORDING",
        stopOperationState: "DELIVERED",
      }),
      "stopping",
    );
  });

  it("maps in-flight durable stop states to stopping", () => {
    for (const stopOperationState of ["PENDING", "DELIVERING", "DELIVERED"]) {
      assert.equal(
        getRecordingDisplayState({
          recordingStatus: "RECORDING",
          stopOperationState,
        }),
        "stopping",
      );
    }
  });

  it("maps stopped/completed recording to completed", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "STOPPED",
      }),
      "completed",
    );
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "COMPLETED",
      }),
      "completed",
    );
  });

  it("maps failed recording to failed", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "FAILED",
        stopOperationState: "DELIVERING",
      }),
      "failed",
    );
  });

  it("does not treat FAILED stop operation as ongoing stopping", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "FAILED",
        stopOperationState: "FAILED",
      }),
      "failed",
    );
  });

  it("maps missing recording to none", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: null,
      }),
      "none",
    );
  });

  it("maps unknown recording enum to none (safe fallback)", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "SOME_NEW_STATUS",
      }),
      "none",
    );
  });

  it("uses precedence: completed beats stop intent", () => {
    assert.equal(
      getRecordingDisplayState({
        recordingStatus: "COMPLETED",
        stopOperationState: "PENDING",
      }),
      "completed",
    );
  });
});

describe("getRecordingDisplayPresentation", () => {
  it("never exposes raw enum labels", () => {
    const completed = getRecordingDisplayPresentation("completed");
    assert.equal(completed.labelKey, "recording.recordingCompleted");

    const none = getRecordingDisplayPresentation("none");
    assert.equal(none.labelKey, "recording.noRecording");
  });
});
