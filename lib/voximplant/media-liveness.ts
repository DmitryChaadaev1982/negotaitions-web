/**
 * Event-driven remote media liveness for Vox WebSDK 5.1.0.
 *
 * A stream object existing is not enough to call media usable. Slice A uses
 * these primitives on the session-room path; full peer-endpoint convergence
 * remains Slice B.
 */

export const VOX_STREAM_EVENT_ENDED = "ENDED";
export const VOX_STOP_RECEIVING_AUTOMATIC = "Automatic";

export type VoxLikeMediaStream = {
  track?: MediaStreamTrack;
  sourceStream?: MediaStream;
};

export function isLiveMediaTrack(
  track: Pick<MediaStreamTrack, "readyState"> | null | undefined,
): boolean {
  if (!track) return false;
  return track.readyState !== "ended";
}

export function isLiveMediaStream(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getTracks().some((track) => isLiveMediaTrack(track));
}

export function liveTracksOfKind(
  stream: MediaStream | null | undefined,
  kind: "audio" | "video",
): MediaStreamTrack[] {
  if (!stream) return [];
  const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
  return tracks.filter((track) => isLiveMediaTrack(track));
}

/**
 * Prefer the original MediaStream when every track is live so the healthy
 * render path does not allocate a replacement stream.
 */
export function mediaStreamFromLiveVoxStream(
  stream: VoxLikeMediaStream | null | undefined,
): MediaStream | null {
  if (!stream) return null;
  if (stream.sourceStream) {
    const tracks = stream.sourceStream.getTracks();
    if (tracks.length === 0) return null;
    if (tracks.every((track) => isLiveMediaTrack(track))) {
      return stream.sourceStream;
    }
    const live = tracks.filter((track) => isLiveMediaTrack(track));
    return live.length > 0 ? new MediaStream(live) : null;
  }
  if (stream.track && isLiveMediaTrack(stream.track)) {
    return new MediaStream([stream.track]);
  }
  return null;
}

export function selectLiveVoxStream<T extends VoxLikeMediaStream>(
  streams: readonly T[],
): T | null {
  for (const stream of streams) {
    if (mediaStreamFromLiveVoxStream(stream)) return stream;
  }
  return null;
}

export function isAutomaticStopReceivingReason(
  reason: string | null | undefined,
): boolean {
  return reason === VOX_STOP_RECEIVING_AUTOMATIC;
}

export type StreamLivenessCleanup = () => void;
export type EndpointStreamLivenessRegistry = Map<string, Map<string, StreamLivenessCleanup>>;

export function createEndpointStreamLivenessRegistry(): EndpointStreamLivenessRegistry {
  return new Map();
}

export function endpointStreamLivenessCount(
  registry: EndpointStreamLivenessRegistry,
  endpointId?: string,
): number {
  if (endpointId !== undefined) {
    return registry.get(endpointId)?.size ?? 0;
  }
  let total = 0;
  for (const streams of registry.values()) {
    total += streams.size;
  }
  return total;
}

export function hasEndpointStreamLiveness(
  registry: EndpointStreamLivenessRegistry,
  endpointId: string,
  streamId: string,
): boolean {
  return registry.get(endpointId)?.has(streamId) === true;
}

export function registerEndpointStreamLiveness(
  registry: EndpointStreamLivenessRegistry,
  endpointId: string,
  streamId: string,
  cleanup: StreamLivenessCleanup,
): boolean {
  let streams = registry.get(endpointId);
  if (!streams) {
    streams = new Map();
    registry.set(endpointId, streams);
  }
  if (streams.has(streamId)) {
    return false;
  }
  streams.set(streamId, cleanup);
  return true;
}

export function disposeEndpointStreamLivenessBinding(
  registry: EndpointStreamLivenessRegistry,
  endpointId: string,
  streamId: string,
): boolean {
  const streams = registry.get(endpointId);
  if (!streams) return false;
  const cleanup = streams.get(streamId);
  if (!cleanup) return false;
  try {
    cleanup();
  } catch {
    /* ignore */
  }
  streams.delete(streamId);
  if (streams.size === 0) {
    registry.delete(endpointId);
  }
  return true;
}

/**
 * Endpoint-wide disposal for EndpointRemoved / teardown. Pass streamId to
 * dispose only that stream-scoped binding (RemoteMediaRemoved).
 */
export function disposeEndpointStreamLiveness(
  registry: EndpointStreamLivenessRegistry,
  endpointId: string,
  streamId?: string,
): void {
  if (streamId !== undefined) {
    disposeEndpointStreamLivenessBinding(registry, endpointId, streamId);
    return;
  }
  const streams = registry.get(endpointId);
  if (!streams) return;
  for (const cleanup of streams.values()) {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
  }
  streams.clear();
  registry.delete(endpointId);
}

export function pruneMissingEndpointStreamLiveness(
  registry: EndpointStreamLivenessRegistry,
  endpointId: string,
  presentStreamIds: ReadonlySet<string>,
): string[] {
  const streams = registry.get(endpointId);
  if (!streams) return [];
  const disposed: string[] = [];
  for (const streamId of Array.from(streams.keys())) {
    if (presentStreamIds.has(streamId)) continue;
    if (disposeEndpointStreamLivenessBinding(registry, endpointId, streamId)) {
      disposed.push(streamId);
    }
  }
  return disposed;
}

export function disposeAllEndpointStreamLiveness(
  registry: EndpointStreamLivenessRegistry,
): void {
  for (const endpointId of Array.from(registry.keys())) {
    disposeEndpointStreamLiveness(registry, endpointId);
  }
}

/**
 * One stream/track liveness binding. Cleanup disposes the handler so a late
 * ENDED / native ended callback cannot resurrect a removed endpoint.
 */
export function bindEndpointStreamLiveness(input: {
  registry: EndpointStreamLivenessRegistry;
  endpointId: string;
  streamId: string;
  addStreamEndedListener: (handler: () => void) => void;
  removeStreamEndedListener: (handler: () => void) => void;
  addTrackEndedListener?: (handler: () => void) => void;
  removeTrackEndedListener?: (handler: () => void) => void;
  onEnded: () => void;
}): boolean {
  if (hasEndpointStreamLiveness(input.registry, input.endpointId, input.streamId)) {
    return false;
  }
  let disposed = false;
  const handler = () => {
    if (disposed) return;
    if (!hasEndpointStreamLiveness(input.registry, input.endpointId, input.streamId)) {
      return;
    }
    input.onEnded();
  };
  const cleanup = () => {
    disposed = true;
    input.removeStreamEndedListener(handler);
    input.removeTrackEndedListener?.(handler);
  };
  if (!registerEndpointStreamLiveness(
    input.registry,
    input.endpointId,
    input.streamId,
    cleanup,
  )) {
    return false;
  }
  input.addStreamEndedListener(handler);
  input.addTrackEndedListener?.(handler);
  return true;
}
