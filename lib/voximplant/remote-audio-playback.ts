/**
 * Selected-endpoint + current-stream remote HTMLAudioElement playback ownership.
 *
 * Playback follows the same authoritative endpoint selection as
 * `createPeerMediaSelectionOwner`, then further restricts to that remote's
 * current projected `audioStream.id`. Planning is synchronous. Callers must not
 * wait for `HTMLMediaElement.play()` before candidate state or render selection.
 */

export type RemoteAudioPlaybackElement = {
  paused: boolean;
  play: () => Promise<void>;
  pause: () => void;
};

export type RemoteAudioPlaybackPlan = {
  playKeys: string[];
  pauseKeys: string[];
};

export type RemoteAudioElementOwnership = {
  endpointId: string;
  streamId: string;
  voxStreamId?: string;
};

export type RemoteAudioStreamProjection = {
  id: string;
  audioStream?: { id?: string } | null;
};

export type PlanRemoteAudioPlaybackInput = {
  selectedEndpointIds: ReadonlySet<string>;
  selectedAudioStreamIdsByEndpoint: ReadonlyMap<string, string>;
  previouslySelectedEndpointIds?: ReadonlySet<string>;
  previouslySelectedAudioStreamIdsByEndpoint?: ReadonlyMap<string, string>;
  newlyAttachedKeys?: ReadonlySet<string>;
  unlock?: boolean;
  elements: ReadonlyArray<{
    key: string;
    endpointId: string;
    streamId: string;
    paused: boolean;
  }>;
};

/**
 * Unambiguous element identity. Do not parse this string for ownership;
 * callers must keep structured endpointId/streamId metadata.
 */
export function remoteAudioElementKey(endpointId: string, streamId: string): string {
  return `${encodeURIComponent(endpointId)}/${encodeURIComponent(streamId)}`;
}

export function selectedRemoteAudioStreamIdsByEndpoint(
  remotes: readonly RemoteAudioStreamProjection[],
  selectedEndpointIds: ReadonlySet<string>,
): Map<string, string> {
  const selected = new Map<string, string>();
  for (const remote of remotes) {
    if (!selectedEndpointIds.has(remote.id)) continue;
    const streamId = remote.audioStream?.id;
    if (typeof streamId !== "string" || streamId.length === 0) continue;
    selected.set(remote.id, streamId);
  }
  return selected;
}

export function findRemoteAudioElementKey(
  ownership: ReadonlyMap<string, RemoteAudioElementOwnership>,
  endpointId: string,
  streamId: string,
): string | null {
  const direct = remoteAudioElementKey(endpointId, streamId);
  const directMeta = ownership.get(direct);
  if (
    directMeta &&
    directMeta.endpointId === endpointId &&
    (directMeta.streamId === streamId || directMeta.voxStreamId === streamId)
  ) {
    return direct;
  }
  for (const [key, meta] of ownership) {
    if (meta.endpointId !== endpointId) continue;
    if (meta.streamId === streamId || meta.voxStreamId === streamId) return key;
  }
  return null;
}

function isAuthoritativeRemoteAudioElement(
  endpointId: string,
  streamId: string,
  selectedEndpointIds: ReadonlySet<string>,
  selectedAudioStreamIdsByEndpoint: ReadonlyMap<string, string>,
): boolean {
  if (!selectedEndpointIds.has(endpointId)) return false;
  return selectedAudioStreamIdsByEndpoint.get(endpointId) === streamId;
}

export function planRemoteAudioPlayback(
  input: PlanRemoteAudioPlaybackInput,
): RemoteAudioPlaybackPlan {
  const playKeys: string[] = [];
  const pauseKeys: string[] = [];
  const previouslySelected = input.previouslySelectedEndpointIds ?? new Set<string>();
  const previousStreams =
    input.previouslySelectedAudioStreamIdsByEndpoint ?? new Map<string, string>();
  const newlyAttached = input.newlyAttachedKeys ?? new Set<string>();

  for (const element of input.elements) {
    const authoritative = isAuthoritativeRemoteAudioElement(
      element.endpointId,
      element.streamId,
      input.selectedEndpointIds,
      input.selectedAudioStreamIdsByEndpoint,
    );
    if (!authoritative) {
      pauseKeys.push(element.key);
      continue;
    }
    if (!element.paused) continue;
    const becameSelected = !previouslySelected.has(element.endpointId);
    const streamBecameCurrent = previousStreams.get(element.endpointId) !== element.streamId;
    if (input.unlock || newlyAttached.has(element.key) || becameSelected || streamBecameCurrent) {
      playKeys.push(element.key);
    }
  }

  return { playKeys, pauseKeys };
}

export function reconcileRemoteAudioPlayback<T extends RemoteAudioPlaybackElement>(input: {
  remotes: readonly RemoteAudioStreamProjection[];
  selectedEndpointIds: ReadonlySet<string>;
  previouslySelectedEndpointIds?: ReadonlySet<string>;
  previousRemotes?: readonly RemoteAudioStreamProjection[];
  previouslySelectedAudioStreamIdsByEndpoint?: ReadonlyMap<string, string>;
  newlyAttachedKeys?: ReadonlySet<string>;
  unlock?: boolean;
  elements: Map<string, T>;
  elementOwnership: ReadonlyMap<string, RemoteAudioElementOwnership>;
}): {
  playKeys: string[];
  pauseKeys: string[];
  playResults: Array<{ key: string; result: Promise<void> }>;
} {
  const selectedAudioStreamIdsByEndpoint = selectedRemoteAudioStreamIdsByEndpoint(
    input.remotes,
    input.selectedEndpointIds,
  );
  const previouslySelectedAudioStreamIdsByEndpoint =
    input.previouslySelectedAudioStreamIdsByEndpoint ??
    (input.previousRemotes
      ? selectedRemoteAudioStreamIdsByEndpoint(
          input.previousRemotes,
          input.previouslySelectedEndpointIds ?? new Set(),
        )
      : undefined);

  const plan = planRemoteAudioPlayback({
    selectedEndpointIds: input.selectedEndpointIds,
    selectedAudioStreamIdsByEndpoint,
    previouslySelectedEndpointIds: input.previouslySelectedEndpointIds,
    previouslySelectedAudioStreamIdsByEndpoint,
    newlyAttachedKeys: input.newlyAttachedKeys,
    unlock: input.unlock,
    elements: [...input.elements.entries()].map(([key, audio]) => {
      const ownership = input.elementOwnership.get(key);
      return {
        key,
        endpointId: ownership?.endpointId ?? "",
        streamId: ownership?.streamId ?? "",
        paused: audio.paused,
      };
    }),
  });

  for (const key of plan.pauseKeys) {
    input.elements.get(key)?.pause();
  }

  const playResults: Array<{ key: string; result: Promise<void> }> = [];
  for (const key of plan.playKeys) {
    const audio = input.elements.get(key);
    if (!audio) continue;
    playResults.push({ key, result: audio.play() });
  }

  return {
    playKeys: plan.playKeys,
    pauseKeys: plan.pauseKeys,
    playResults,
  };
}

export function isRemoteAudioAutoplayBlock(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lower = msg.toLowerCase();
  return (
    (error instanceof Error && error.name === "NotAllowedError") ||
    lower.includes("interact") ||
    lower.includes("user gesture") ||
    lower.includes("autoplay") ||
    lower.includes("play()")
  );
}
