import test from "node:test";
import assert from "node:assert/strict";

import {
  buildParticipantReconnectMediaState,
  canRenderSpeakingHighlight,
  normalizeParticipantPresenceMedia,
} from "@/lib/voximplant/participant-presence-media-model";
import {
  resolveSpeakingAudioTrackId,
  resolveSpeakingSourceStream,
  shouldAcceptRemoteSpeakingLevel,
  shouldAttachRemoteSpeakingMeter,
} from "@/lib/voximplant/remote-speaking";
import {
  resolveTileBorderState,
  resolveTileSpeakingHighlight,
} from "@/lib/voximplant/tile-speaking-state";

// ── Deterministic media fakes (no microphone hardware, no AudioContext) ───────

function audioTrack(input: { id: string; enabled: boolean }): MediaStreamTrack {
  return { id: input.id, kind: "audio", enabled: input.enabled } as MediaStreamTrack;
}

function audioStream(input: {
  id: string;
  trackId?: string;
  enabled?: boolean;
}): MediaStream {
  const tracks =
    input.trackId === undefined
      ? []
      : [audioTrack({ id: input.trackId, enabled: input.enabled !== false })];
  return {
    id: input.id,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

function videoOnlyStream(id: string): MediaStream {
  return {
    id,
    getAudioTracks: () => [],
    getVideoTracks: () => [{ id: `${id}-video`, kind: "video", enabled: true }],
  } as unknown as MediaStream;
}

/**
 * Room-phase labels used to prove that speaking visualization is phase
 * independent. The phase is never an input to the speaking rule; the fixtures
 * only differ in the microphone policy that each phase permits.
 */
const ROOM_PHASES = ["RUNNING", "PAUSED", "DEBRIEF_OPEN"] as const;
type RoomPhase = (typeof ROOM_PHASES)[number];

/**
 * Mirrors how the video layout resolves one rendered tile: presence/media model,
 * reconnect media state, then the shared speaking rule.
 */
function renderTile(input: {
  role: "OBSERVER" | "FACILITATOR" | "PARTICIPANT";
  phase: RoomPhase;
  connected?: boolean;
  micEnabled?: boolean | null;
  audioStream?: MediaStream | null;
  speakingSignal?: boolean;
  connectionId?: string;
  speakingConnectionId?: string;
  staleConnection?: boolean;
  lastSeenAt?: string | null;
}) {
  const connected = input.connected !== false;
  const stream = input.audioStream === undefined ? audioStream({ id: "audio-1", trackId: "track-1" }) : input.audioStream;
  const micSignal =
    input.micEnabled === null || input.micEnabled === undefined
      ? undefined
      : input.micEnabled
        ? ("on" as const)
        : ("off" as const);
  const mediaModel = normalizeParticipantPresenceMedia({
    displayName: `${input.role} in ${input.phase}`,
    connectedSignal: connected,
    allowConnectedWithoutMediaTile: true,
    lastSeenAt: input.lastSeenAt ?? null,
    videoStream: null,
    audioStream: stream,
    micSignal,
    cameraSignal: "on",
  });
  const connectionId = input.connectionId ?? "connection-current";
  const reconnectMediaState = buildParticipantReconnectMediaState({
    userId: `${input.role.toLowerCase()}-user`,
    role: input.role,
    connectionGeneration: connectionId,
    providerEndpointId: `${input.role.toLowerCase()}-endpoint`,
    streamId: stream?.id ?? null,
    audioStream: stream,
    microphoneEnabled:
      mediaModel.connectionStatus === "connected" && mediaModel.micStatus !== "unknown"
        ? mediaModel.micStatus === "on"
        : null,
    cameraEnabled: true,
    isSpeaking: input.speakingSignal === true,
    lastMediaUpdateAt: "2026-08-03T12:00:00.000Z",
  });
  const speakingSourceStream = resolveSpeakingSourceStream({
    audioStream: stream,
    videoStream: null,
  });
  const meterAttached = shouldAttachRemoteSpeakingMeter({
    id: reconnectMediaState.providerEndpointId ?? "endpoint",
    stream: speakingSourceStream,
    microphoneEnabled: reconnectMediaState.microphoneEnabled === true,
    generation: connectionId,
  });
  // A remote analyser can only report speech while it is attached.
  const isSpeaking = meterAttached && input.speakingSignal === true;
  const highlight = resolveTileSpeakingHighlight({
    connectionStatus: mediaModel.connectionStatus,
    micStatus: mediaModel.micStatus,
    audioTrackPresent: reconnectMediaState.audioTrackPresent,
    isSpeaking,
    staleConnection: input.staleConnection === true,
    connectionGeneration: connectionId,
    speakingGeneration: input.speakingConnectionId ?? connectionId,
  });
  return {
    mediaModel,
    reconnectMediaState,
    meterAttached,
    highlight,
    borderState: resolveTileBorderState({
      connectionStatus: mediaModel.connectionStatus,
      micStatus: mediaModel.micStatus,
      isSpeaking: highlight,
    }),
  };
}

// ── 1. Observer current enabled track + speaking → highlight ─────────────────

test("observer with a current enabled audio track and speech shows the highlight", () => {
  const tile = renderTile({ role: "OBSERVER", phase: "RUNNING", micEnabled: true, speakingSignal: true });
  assert.equal(tile.meterAttached, true);
  assert.equal(tile.highlight, true);
  assert.equal(tile.borderState, "speaking");
});

// ── 2. Observer enabled track + silence → normal connected border ────────────

test("observer with an enabled audio track and silence keeps the connected border", () => {
  const tile = renderTile({ role: "OBSERVER", phase: "RUNNING", micEnabled: true, speakingSignal: false });
  assert.equal(tile.highlight, false);
  assert.equal(tile.borderState, "connected");
});

// ── 3. Observer muted + speaking signal → muted red border ───────────────────

test("muted observer with a speaking signal renders the muted border and no highlight", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "PAUSED",
    micEnabled: false,
    speakingSignal: true,
  });
  assert.equal(tile.meterAttached, false);
  assert.equal(tile.highlight, false);
  assert.equal(tile.borderState, "muted");
});

// ── 4. Observer missing track + speaking signal → no highlight ───────────────

test("observer without an audio track cannot show the highlight even with a speaking signal", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "DEBRIEF_OPEN",
    micEnabled: true,
    audioStream: null,
    speakingSignal: true,
  });
  assert.equal(tile.reconnectMediaState.audioTrackPresent, false);
  assert.equal(tile.meterAttached, false);
  assert.equal(tile.highlight, false);
});

test("observer whose audio stream lost its track cannot show the highlight", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "RUNNING",
    micEnabled: true,
    audioStream: audioStream({ id: "audio-empty" }),
    speakingSignal: true,
  });
  assert.equal(tile.reconnectMediaState.audioTrackPresent, false);
  assert.equal(tile.highlight, false);
});

// ── 5. Observer stale/disconnected + speaking signal → no highlight ──────────

test("disconnected observer with a speaking signal shows no highlight", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "RUNNING",
    connected: false,
    micEnabled: true,
    speakingSignal: true,
    lastSeenAt: new Date().toISOString(),
  });
  assert.equal(tile.mediaModel.connectionStatus, "disconnected");
  assert.equal(tile.highlight, false);
  assert.equal(tile.borderState, "disconnected");
});

test("stale local observer connection with a speaking signal shows no highlight", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "RUNNING",
    micEnabled: true,
    speakingSignal: true,
    staleConnection: true,
  });
  assert.equal(tile.highlight, false);
});

// ── 6-8. Phase independence: RUNNING, PAUSED, DEBRIEF_OPEN ───────────────────

for (const phase of ROOM_PHASES) {
  test(`observer speaking in ${phase} shows the highlight`, () => {
    const tile = renderTile({
      role: "OBSERVER",
      phase,
      micEnabled: true,
      speakingSignal: true,
    });
    assert.equal(tile.highlight, true, `expected highlight in ${phase}`);
    assert.equal(tile.borderState, "speaking");
  });
}

test("observer speaking highlight is identical in every room phase", () => {
  const results = ROOM_PHASES.map(
    (phase) =>
      renderTile({ role: "OBSERVER", phase, micEnabled: true, speakingSignal: true }).highlight,
  );
  assert.deepEqual(results, [true, true, true]);
});

// ── 9-10. Participant and facilitator regression ─────────────────────────────

test("participant speaking behaviour is unchanged", () => {
  for (const phase of ROOM_PHASES) {
    const speaking = renderTile({
      role: "PARTICIPANT",
      phase,
      micEnabled: true,
      speakingSignal: true,
    });
    const silent = renderTile({
      role: "PARTICIPANT",
      phase,
      micEnabled: true,
      speakingSignal: false,
    });
    assert.equal(speaking.borderState, "speaking");
    assert.equal(silent.borderState, "connected");
  }
});

test("facilitator speaking behaviour is unchanged", () => {
  for (const phase of ROOM_PHASES) {
    const speaking = renderTile({
      role: "FACILITATOR",
      phase,
      micEnabled: true,
      speakingSignal: true,
    });
    assert.equal(speaking.borderState, "speaking");
  }
});

test("observer, facilitator, and participant share one speaking rule", () => {
  const roles = ["OBSERVER", "FACILITATOR", "PARTICIPANT"] as const;
  const highlights = roles.map(
    (role) =>
      renderTile({ role, phase: "DEBRIEF_OPEN", micEnabled: true, speakingSignal: true })
        .highlight,
  );
  assert.deepEqual(highlights, [true, true, true]);
});

// ── 11. Old observer generation speaking callback is ignored ─────────────────

test("speaking level from a superseded observer generation is rejected", () => {
  assert.equal(
    shouldAcceptRemoteSpeakingLevel({
      currentGeneration: "observer:connection-new:endpoint:stream-new",
      updateGeneration: "observer:connection-old:endpoint:stream-old",
      microphoneEnabled: true,
      level: 40,
    }),
    false,
  );
});

test("speaking signal tagged with an old observer generation cannot highlight the tile", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "RUNNING",
    micEnabled: true,
    speakingSignal: true,
    connectionId: "connection-new",
    speakingConnectionId: "connection-old",
  });
  assert.equal(tile.highlight, false);
});

test("speaking signal tagged with the current observer generation highlights the tile", () => {
  const tile = renderTile({
    role: "OBSERVER",
    phase: "RUNNING",
    micEnabled: true,
    speakingSignal: true,
    connectionId: "connection-new",
    speakingConnectionId: "connection-new",
  });
  assert.equal(tile.highlight, true);
});

// ── 12. Replacement observer track attaches a new analyser ──────────────────

test("replacement observer audio track produces a new analyser identity", () => {
  const original = audioStream({ id: "audio-1", trackId: "track-1" });
  const replacement = audioStream({ id: "audio-2", trackId: "track-2" });
  assert.equal(resolveSpeakingAudioTrackId(original), "track-1");
  assert.equal(resolveSpeakingAudioTrackId(replacement), "track-2");
  assert.notEqual(
    resolveSpeakingAudioTrackId(original),
    resolveSpeakingAudioTrackId(replacement),
  );
  assert.equal(
    shouldAttachRemoteSpeakingMeter({
      id: "observer-endpoint",
      stream: replacement,
      microphoneEnabled: true,
      generation: "connection-new",
    }),
    true,
  );
});

// ── 18. Reconnect does not create a duplicate analyser or tile ───────────────

test("re-wrapping the same observer audio track keeps one analyser identity", () => {
  const track = audioTrack({ id: "track-1", enabled: true });
  const first = {
    id: "audio-wrapper-1",
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  const second = {
    id: "audio-wrapper-2",
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  assert.notEqual(first, second);
  assert.equal(resolveSpeakingAudioTrackId(first), resolveSpeakingAudioTrackId(second));
});

// ── 13. Removed observer track clears speaking ───────────────────────────────

test("removing the observer audio track clears the analyser and the highlight", () => {
  const before = renderTile({
    role: "OBSERVER",
    phase: "PAUSED",
    micEnabled: true,
    speakingSignal: true,
  });
  const after = renderTile({
    role: "OBSERVER",
    phase: "PAUSED",
    micEnabled: true,
    audioStream: null,
    speakingSignal: true,
  });
  assert.equal(before.highlight, true);
  assert.equal(resolveSpeakingAudioTrackId(null), null);
  assert.equal(after.meterAttached, false);
  assert.equal(after.highlight, false);
});

// ── 14. Muting clears speaking immediately ───────────────────────────────────

test("muting the observer clears speaking immediately", () => {
  const speaking = renderTile({
    role: "OBSERVER",
    phase: "DEBRIEF_OPEN",
    micEnabled: true,
    speakingSignal: true,
  });
  const muted = renderTile({
    role: "OBSERVER",
    phase: "DEBRIEF_OPEN",
    micEnabled: false,
    speakingSignal: true,
  });
  assert.equal(speaking.borderState, "speaking");
  assert.equal(muted.borderState, "muted");
  assert.equal(muted.reconnectMediaState.isSpeaking, false);
  assert.equal(
    shouldAcceptRemoteSpeakingLevel({
      currentGeneration: "connection-current",
      updateGeneration: "connection-current",
      microphoneEnabled: false,
      level: 90,
    }),
    false,
  );
});

// ── 15. Observer rail mapping retains isSpeaking ─────────────────────────────

test("observer rail mapping keeps the audio source and speaking state", () => {
  const observerAudio = audioStream({ id: "observer-audio", trackId: "observer-track" });
  const railTile = {
    participant: { audioStream: observerAudio, stream: videoOnlyStream("observer-video") },
  };
  const source = resolveSpeakingSourceStream({
    audioStream: railTile.participant.audioStream,
    videoStream: railTile.participant.stream,
  });
  assert.equal(source, observerAudio);
  assert.equal(
    shouldAttachRemoteSpeakingMeter({
      id: "observer-endpoint",
      stream: source,
      microphoneEnabled: true,
      generation: "connection-current",
    }),
    true,
  );
  const compactTile = renderTile({
    role: "OBSERVER",
    phase: "RUNNING",
    micEnabled: true,
    audioStream: observerAudio,
    speakingSignal: true,
  });
  assert.equal(compactTile.highlight, true);
});

test("observer speaking source falls back to a stream that carries the audio track", () => {
  const combined = audioStream({ id: "combined", trackId: "combined-track" });
  assert.equal(
    resolveSpeakingSourceStream({ audioStream: null, videoStream: combined }),
    combined,
  );
  assert.equal(
    resolveSpeakingSourceStream({
      audioStream: null,
      videoStream: videoOnlyStream("video-only"),
    }),
    null,
  );
});

// ── 16-17. Border precedence ─────────────────────────────────────────────────

test("observer tile border resolver prioritizes speaking over connected", () => {
  assert.equal(
    resolveTileBorderState({ connectionStatus: "connected", micStatus: "on", isSpeaking: true }),
    "speaking",
  );
  assert.equal(
    resolveTileBorderState({ connectionStatus: "connected", micStatus: "on", isSpeaking: false }),
    "connected",
  );
});

test("muted and disconnected states still override speaking", () => {
  assert.equal(
    resolveTileBorderState({ connectionStatus: "connected", micStatus: "off", isSpeaking: true }),
    "muted",
  );
  assert.equal(
    resolveTileBorderState({
      connectionStatus: "disconnected",
      micStatus: "on",
      isSpeaking: true,
    }),
    "disconnected",
  );
  assert.equal(
    resolveTileBorderState({ connectionStatus: "unknown", micStatus: "on", isSpeaking: true }),
    "disconnected",
  );
});

test("shared speaking rule rejects every incomplete input", () => {
  const complete = {
    connected: true,
    stale: false,
    microphoneEnabled: true,
    audioTrackPresent: true,
    isSpeaking: true,
    connectionGeneration: "generation-1",
    speakingGeneration: "generation-1",
  };
  assert.equal(canRenderSpeakingHighlight(complete), true);
  assert.equal(canRenderSpeakingHighlight({ ...complete, connected: false }), false);
  assert.equal(canRenderSpeakingHighlight({ ...complete, stale: true }), false);
  assert.equal(canRenderSpeakingHighlight({ ...complete, microphoneEnabled: false }), false);
  assert.equal(canRenderSpeakingHighlight({ ...complete, audioTrackPresent: false }), false);
  assert.equal(canRenderSpeakingHighlight({ ...complete, isSpeaking: false }), false);
  assert.equal(
    canRenderSpeakingHighlight({ ...complete, speakingGeneration: "generation-0" }),
    false,
  );
});
