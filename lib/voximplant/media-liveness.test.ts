import assert from "node:assert/strict";
import test from "node:test";

import {
  bindEndpointStreamLiveness,
  createEndpointStreamLivenessRegistry,
  disposeAllEndpointStreamLiveness,
  disposeEndpointStreamLiveness,
  disposeEndpointStreamLivenessBinding,
  endpointStreamLivenessCount,
  hasEndpointStreamLiveness,
  pruneMissingEndpointStreamLiveness,
} from "@/lib/voximplant/media-liveness";

function createFakeStream() {
  const streamEnded = new Set<() => void>();
  const trackEnded = new Set<() => void>();
  return {
    streamEnded,
    trackEnded,
    addStreamEndedListener: (handler: () => void) => {
      streamEnded.add(handler);
    },
    removeStreamEndedListener: (handler: () => void) => {
      streamEnded.delete(handler);
    },
    addTrackEndedListener: (handler: () => void) => {
      trackEnded.add(handler);
    },
    removeTrackEndedListener: (handler: () => void) => {
      trackEnded.delete(handler);
    },
    emitStreamEnded() {
      for (const handler of Array.from(streamEnded)) handler();
    },
    emitTrackEnded() {
      for (const handler of Array.from(trackEnded)) handler();
    },
  };
}

test("late Stream ENDED after endpoint dispose cannot resurrect remote state", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const stream = createFakeStream();
  const remotes = new Set<string>(["ep-a"]);
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "stream-a",
    addStreamEndedListener: stream.addStreamEndedListener,
    removeStreamEndedListener: stream.removeStreamEndedListener,
    addTrackEndedListener: stream.addTrackEndedListener,
    removeTrackEndedListener: stream.removeTrackEndedListener,
    onEnded: () => {
      remotes.add("ep-a");
    },
  });
  remotes.delete("ep-a");
  disposeEndpointStreamLiveness(registry, "ep-a");
  stream.emitStreamEnded();
  assert.equal(remotes.has("ep-a"), false);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "stream-a"), false);
});

test("late native track ended after endpoint dispose cannot resurrect remote state", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const stream = createFakeStream();
  const remotes = new Set<string>(["ep-a"]);
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "stream-a",
    addStreamEndedListener: stream.addStreamEndedListener,
    removeStreamEndedListener: stream.removeStreamEndedListener,
    addTrackEndedListener: stream.addTrackEndedListener,
    removeTrackEndedListener: stream.removeTrackEndedListener,
    onEnded: () => {
      remotes.add("ep-a");
    },
  });
  remotes.delete("ep-a");
  disposeEndpointStreamLiveness(registry, "ep-a");
  stream.emitTrackEnded();
  assert.equal(remotes.has("ep-a"), false);
});

test("duplicate bind for the same stream is ignored", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const stream = createFakeStream();
  const input = {
    registry,
    endpointId: "ep-a",
    streamId: "stream-a",
    addStreamEndedListener: stream.addStreamEndedListener,
    removeStreamEndedListener: stream.removeStreamEndedListener,
    onEnded: () => undefined,
  };
  assert.equal(bindEndpointStreamLiveness(input), true);
  assert.equal(bindEndpointStreamLiveness(input), false);
  assert.equal(stream.streamEnded.size, 1);
  assert.equal(endpointStreamLivenessCount(registry, "ep-a"), 1);
});

test("full teardown disposes remaining endpoint-owned liveness listeners", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const first = createFakeStream();
  const second = createFakeStream();
  let fires = 0;
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s1",
    addStreamEndedListener: first.addStreamEndedListener,
    removeStreamEndedListener: first.removeStreamEndedListener,
    onEnded: () => {
      fires += 1;
    },
  });
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-b",
    streamId: "s2",
    addStreamEndedListener: second.addStreamEndedListener,
    removeStreamEndedListener: second.removeStreamEndedListener,
    onEnded: () => {
      fires += 1;
    },
  });
  disposeAllEndpointStreamLiveness(registry);
  first.emitStreamEnded();
  second.emitStreamEnded();
  assert.equal(fires, 0);
  assert.equal(endpointStreamLivenessCount(registry), 0);
});

test("old endpoint callbacks cannot affect a new endpoint with a different id", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const oldStream = createFakeStream();
  const affected = new Set<string>();
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-old",
    streamId: "stream-old",
    addStreamEndedListener: oldStream.addStreamEndedListener,
    removeStreamEndedListener: oldStream.removeStreamEndedListener,
    onEnded: () => {
      affected.add("ep-old");
    },
  });
  disposeEndpointStreamLiveness(registry, "ep-old");
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-new",
    streamId: "stream-new",
    addStreamEndedListener: () => undefined,
    removeStreamEndedListener: () => undefined,
    onEnded: () => {
      affected.add("ep-new");
    },
  });
  oldStream.emitStreamEnded();
  assert.equal(affected.has("ep-old"), false);
  assert.equal(affected.has("ep-new"), false);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-new", "stream-new"), true);
});

test("R6: disposing one stream leaves the replacement stream binding intact", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const first = createFakeStream();
  const second = createFakeStream();
  const ended: string[] = [];
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s1",
    addStreamEndedListener: first.addStreamEndedListener,
    removeStreamEndedListener: first.removeStreamEndedListener,
    addTrackEndedListener: first.addTrackEndedListener,
    removeTrackEndedListener: first.removeTrackEndedListener,
    onEnded: () => {
      ended.push("s1");
    },
  });
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s2",
    addStreamEndedListener: second.addStreamEndedListener,
    removeStreamEndedListener: second.removeStreamEndedListener,
    addTrackEndedListener: second.addTrackEndedListener,
    removeTrackEndedListener: second.removeTrackEndedListener,
    onEnded: () => {
      ended.push("s2");
    },
  });
  assert.equal(disposeEndpointStreamLivenessBinding(registry, "ep-a", "s1"), true);
  first.emitStreamEnded();
  first.emitTrackEnded();
  assert.deepEqual(ended, []);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "s1"), false);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "s2"), true);
  second.emitStreamEnded();
  assert.deepEqual(ended, ["s2"]);
});

test("R6: prune removes only streams no longer present on the endpoint", () => {
  const registry = createEndpointStreamLivenessRegistry();
  const first = createFakeStream();
  const second = createFakeStream();
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s1",
    addStreamEndedListener: first.addStreamEndedListener,
    removeStreamEndedListener: first.removeStreamEndedListener,
    onEnded: () => undefined,
  });
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s2",
    addStreamEndedListener: second.addStreamEndedListener,
    removeStreamEndedListener: second.removeStreamEndedListener,
    onEnded: () => undefined,
  });
  const disposed = pruneMissingEndpointStreamLiveness(
    registry,
    "ep-a",
    new Set(["s2"]),
  );
  assert.deepEqual(disposed, ["s1"]);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "s1"), false);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "s2"), true);
  first.emitStreamEnded();
  assert.equal(endpointStreamLivenessCount(registry, "ep-a"), 1);
});

test("R6: endpoint-wide dispose still removes every stream on that endpoint", () => {
  const registry = createEndpointStreamLivenessRegistry();
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s1",
    addStreamEndedListener: () => undefined,
    removeStreamEndedListener: () => undefined,
    onEnded: () => undefined,
  });
  bindEndpointStreamLiveness({
    registry,
    endpointId: "ep-a",
    streamId: "s2",
    addStreamEndedListener: () => undefined,
    removeStreamEndedListener: () => undefined,
    onEnded: () => undefined,
  });
  disposeEndpointStreamLiveness(registry, "ep-a");
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "s1"), false);
  assert.equal(hasEndpointStreamLiveness(registry, "ep-a", "s2"), false);
});
