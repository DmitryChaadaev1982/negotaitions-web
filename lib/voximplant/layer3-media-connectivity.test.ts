import assert from "node:assert/strict";
import test from "node:test";

import {
  createLayer3State,
  isTerminalConferenceIncident,
  layer3AfterSdkReconnectSettled,
  layer3AfterUsableRemoteMedia,
  observeSdkReconnectTransition,
  shouldDeferTerminalRecovery,
} from "@/lib/voximplant/layer3-media-connectivity";

test("CONNECTION_LOST is a terminal membership event even while SDK is reconnecting", () => {
  assert.equal(
    isTerminalConferenceIncident({
      kind: "disconnected",
      disconnectReason: "CONNECTION_LOST",
    }),
    true,
  );
  assert.equal(shouldDeferTerminalRecovery(true), true);
  assert.equal(shouldDeferTerminalRecovery(false), false);
});

test("LOCAL_ENDED and REMOTE_ENDED are not terminal membership events", () => {
  assert.equal(
    isTerminalConferenceIncident({
      kind: "disconnected",
      disconnectReason: "LOCAL_ENDED",
    }),
    false,
  );
  assert.equal(
    isTerminalConferenceIncident({
      kind: "disconnected",
      disconnectReason: "REMOTE_ENDED",
    }),
    false,
  );
  assert.equal(isTerminalConferenceIncident({ kind: "failed" }), true);
});

test("ordinary SDK states are not a reconnect episode", () => {
  let wasReconnecting = false;
  for (const state of ["CREATED", "CONNECTING", "CONNECTED", "LOGGED_IN"] as const) {
    const observation = observeSdkReconnectTransition({
      wasReconnecting,
      clientState: state,
      conferenceState: "CREATED",
    });
    assert.equal(observation.episodeStarted, false);
    assert.equal(observation.episodeSettled, false);
    wasReconnecting = observation.reconnecting;
  }
});

test("only RECONNECTING to settled is a reconnect episode", () => {
  const started = observeSdkReconnectTransition({
    wasReconnecting: false,
    clientState: "RECONNECTING",
    conferenceState: "CONNECTED",
  });
  assert.equal(started.episodeStarted, true);
  assert.equal(started.episodeSettled, false);

  const settled = observeSdkReconnectTransition({
    wasReconnecting: true,
    clientState: "LOGGED_IN",
    conferenceState: "CONNECTED",
  });
  assert.equal(settled.episodeStarted, false);
  assert.equal(settled.episodeSettled, true);

  const duplicate = observeSdkReconnectTransition({
    wasReconnecting: false,
    clientState: "LOGGED_IN",
    conferenceState: "CONNECTED",
  });
  assert.equal(duplicate.episodeSettled, false);
});

test("SDK settle does not infer DEGRADED from empty remotes", () => {
  const current = createLayer3State({
    status: "reconnecting",
    hasEnteredRoom: true,
    reason: null,
  });
  const settled = layer3AfterSdkReconnectSettled(current);
  assert.equal(settled.status, "connected");
  assert.equal(settled.reason, null);
  assert.equal(settled.hasEnteredRoom, true);
});

test("SDK settle preserves explicit media-liveness degradation until usable media", () => {
  const degraded = createLayer3State({
    status: "reconnecting",
    hasEnteredRoom: true,
    reason: "stream_ended",
  });
  const settled = layer3AfterSdkReconnectSettled(degraded);
  assert.equal(settled.status, "degraded");
  assert.equal(settled.reason, "stream_ended");
  const restored = layer3AfterUsableRemoteMedia(settled, false);
  assert.equal(restored.status, "connected");
  assert.equal(restored.reason, null);
});
