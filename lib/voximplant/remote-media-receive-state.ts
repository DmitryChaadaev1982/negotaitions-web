/**
 * Remote media receive state for Vox WebSDK 5.1.0.
 *
 * Independent of local transport (Layer 3) and local Conference membership.
 * EndpointEvent.StopReceivingVideoStream reason=Automatic means Vox Cloud
 * paused inbound VIDEO for one remote stream. It does not prove Client,
 * Conference, membership, or endpoint loss.
 *
 * usableRemoteVideo =
 *   currentGeneration && trackLive && isReceiving !== false
 *
 * track.readyState !== "ended" is not sufficient evidence that the SDK is
 * currently receiving video.
 */

import {
  isLiveMediaTrack,
  mediaStreamFromLiveVoxStream,
  type VoxLikeMediaStream,
} from "@/lib/voximplant/media-liveness";

export type RemoteVideoReceiveStatus = "receiving" | "paused" | "ended";

/**
 * WebSDK 5.1.0 RemoteStream.isReceiving is Watchable<boolean>.
 * Application receive-state stays boolean | undefined after normalization.
 */
export type SdkIsReceivingWatchable = {
  readonly value: boolean;
};

export type RemoteVideoStreamLike = VoxLikeMediaStream & {
  id?: string;
  isReceiving?: SdkIsReceivingWatchable;
};

export type RemoteVideoReceiveBinding = {
  endpointId: string;
  streamId: string;
  generation: number;
  isReceiving: boolean;
};

export type RemoteVideoReceiveRegistry = Map<string, Map<string, RemoteVideoReceiveBinding>>;

export function createRemoteVideoReceiveRegistry(): RemoteVideoReceiveRegistry {
  return new Map();
}

export function shouldApplyRemoteReceiveEvent(input: {
  eventGeneration: number;
  currentGeneration: number;
}): boolean {
  return input.eventGeneration === input.currentGeneration;
}

export function readSdkIsReceiving(
  stream: Pick<RemoteVideoStreamLike, "isReceiving"> | null | undefined,
): boolean | undefined {
  if (!stream) return undefined;
  const watchable = stream.isReceiving;
  if (watchable == null || typeof watchable !== "object") return undefined;
  const value = watchable.value;
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

/**
 * Overlay (Stop/Start) wins when present. SDK isReceiving is next.
 * Unknown is treated as receiving until an explicit Stop says otherwise.
 */
export function resolveRemoteVideoReceiving(input: {
  sdkIsReceiving?: boolean;
  overlayIsReceiving?: boolean;
}): boolean {
  if (input.overlayIsReceiving !== undefined) return input.overlayIsReceiving;
  if (input.sdkIsReceiving !== undefined) return input.sdkIsReceiving;
  return true;
}

export function isUsableRemoteVideo(input: {
  currentGeneration: boolean;
  trackLive: boolean;
  isReceiving?: boolean | null;
}): boolean {
  return input.currentGeneration && input.trackLive && input.isReceiving !== false;
}

export function remoteVideoReceiveStatus(input: {
  streamPresent: boolean;
  trackLive: boolean;
  isReceiving?: boolean | null;
}): RemoteVideoReceiveStatus {
  if (!input.streamPresent) return "ended";
  if (input.isReceiving === false) return "paused";
  if (!input.trackLive) return "ended";
  return "receiving";
}

export function setRemoteVideoReceiving(
  registry: RemoteVideoReceiveRegistry,
  binding: RemoteVideoReceiveBinding,
): void {
  let streams = registry.get(binding.endpointId);
  if (!streams) {
    streams = new Map();
    registry.set(binding.endpointId, streams);
  }
  streams.set(binding.streamId, binding);
}

export function getRemoteVideoReceiving(
  registry: RemoteVideoReceiveRegistry,
  endpointId: string,
  streamId: string,
): RemoteVideoReceiveBinding | undefined {
  return registry.get(endpointId)?.get(streamId);
}

export function deleteRemoteVideoReceiving(
  registry: RemoteVideoReceiveRegistry,
  endpointId: string,
  streamId?: string,
): void {
  if (streamId === undefined) {
    registry.delete(endpointId);
    return;
  }
  const streams = registry.get(endpointId);
  if (!streams) return;
  streams.delete(streamId);
  if (streams.size === 0) registry.delete(endpointId);
}

export function clearRemoteVideoReceiveRegistry(registry: RemoteVideoReceiveRegistry): void {
  registry.clear();
}

export function applyAutomaticStopReceivingOverlay(input: {
  registry: RemoteVideoReceiveRegistry;
  eventGeneration: number;
  currentGeneration: number;
  endpointId: string;
  streamId: string;
}): boolean {
  if (!shouldApplyRemoteReceiveEvent(input)) return false;
  if (!input.streamId) return false;
  setRemoteVideoReceiving(input.registry, {
    endpointId: input.endpointId,
    streamId: input.streamId,
    generation: input.currentGeneration,
    isReceiving: false,
  });
  return true;
}

export function applyStartReceivingOverlay(input: {
  registry: RemoteVideoReceiveRegistry;
  eventGeneration: number;
  currentGeneration: number;
  endpointId: string;
  streamId: string;
}): boolean {
  if (!shouldApplyRemoteReceiveEvent(input)) return false;
  if (!input.streamId) return false;
  setRemoteVideoReceiving(input.registry, {
    endpointId: input.endpointId,
    streamId: input.streamId,
    generation: input.currentGeneration,
    isReceiving: true,
  });
  return true;
}

export type ProjectedRemoteVideo<T extends RemoteVideoStreamLike> = {
  stream: T | null;
  streamId: string | null;
  isReceiving: boolean;
  trackLive: boolean;
  usable: boolean;
  status: RemoteVideoReceiveStatus;
};

function streamTrackLive(stream: RemoteVideoStreamLike): boolean {
  if (stream.track && isLiveMediaTrack(stream.track)) return true;
  if (stream.sourceStream?.getVideoTracks().some((track) => isLiveMediaTrack(track))) {
    return true;
  }
  return Boolean(mediaStreamFromLiveVoxStream(stream));
}

/**
 * Project current remote video without faking removal.
 * A paused SDK stream keeps the same RemoteStream identity.
 * Usable live video requires current generation, live track, and receiving.
 */
export function projectRemoteVideoStream<T extends RemoteVideoStreamLike>(input: {
  streams: readonly T[];
  currentGeneration: boolean;
  overlayByStreamId?: ReadonlyMap<string, boolean>;
  preferredStreamId?: string | null;
}): ProjectedRemoteVideo<T> {
  if (input.streams.length === 0) {
    return {
      stream: null,
      streamId: null,
      isReceiving: false,
      trackLive: false,
      usable: false,
      status: "ended",
    };
  }

  const inspected = input.streams.map((stream) => {
    const streamId = stream.id ?? null;
    const overlay =
      streamId && input.overlayByStreamId
        ? input.overlayByStreamId.get(streamId)
        : undefined;
    const isReceiving = resolveRemoteVideoReceiving({
      sdkIsReceiving: readSdkIsReceiving(stream),
      overlayIsReceiving: overlay,
    });
    const trackLive = streamTrackLive(stream);
    const usable = isUsableRemoteVideo({
      currentGeneration: input.currentGeneration,
      trackLive,
      isReceiving,
    });
    return { stream, streamId, isReceiving, trackLive, usable };
  });

  const preferred = input.preferredStreamId
    ? inspected.find((item) => item.streamId === input.preferredStreamId)
    : undefined;
  const usable = inspected.find((item) => item.usable);
  const chosen = usable ?? preferred ?? inspected[0]!;
  const status = remoteVideoReceiveStatus({
    streamPresent: chosen.stream != null,
    trackLive: chosen.trackLive,
    isReceiving: chosen.isReceiving,
  });

  return {
    stream: chosen.stream,
    streamId: chosen.streamId,
    isReceiving: chosen.isReceiving,
    trackLive: chosen.trackLive,
    usable: chosen.usable,
    status,
  };
}

export function overlayMapForEndpoint(
  registry: RemoteVideoReceiveRegistry,
  endpointId: string,
): Map<string, boolean> {
  const overlay = new Map<string, boolean>();
  const streams = registry.get(endpointId);
  if (!streams) return overlay;
  for (const [streamId, binding] of streams) {
    overlay.set(streamId, binding.isReceiving);
  }
  return overlay;
}

export function resolveAffectedVideoStreamId(input: {
  eventStreamId?: string | null;
  eventStream?: Pick<RemoteVideoStreamLike, "id"> | null;
  currentVideoStreamId?: string | null;
  availableStreamIds?: readonly string[];
}): string | null {
  return (
    input.eventStreamId ??
    input.eventStream?.id ??
    input.currentVideoStreamId ??
    input.availableStreamIds?.[0] ??
    null
  );
}
