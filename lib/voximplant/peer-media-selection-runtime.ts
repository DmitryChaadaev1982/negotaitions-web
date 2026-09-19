/**
 * Session-room owner for one authoritative selected endpoint per logical
 * participant. Video tiles consume this snapshot; remote-audio playback
 * consumes the same selected endpoint ids plus each selected remote's current
 * `audioStream.id`. Callers must not keep independent previous-selection maps.
 *
 * Candidate commit is synchronous. React setState is a publish step only and
 * is not required before selection or a playback attempt.
 */

import {
  projectSelectedPeerEndpoints,
  type ParticipantMediaSelectionOptions,
} from "@/lib/voximplant/participant-media-selection";

export type PeerMediaRemote = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  conferenceGeneration?: number | null;
  stream?: MediaStream | null;
  audioStream?: MediaStream | null;
};

export type PeerMediaUpsertInput = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  conferenceGeneration?: number | null;
  stream?: MediaStream | null;
  audioStream?: MediaStream | null;
};

export function upsertVoxRoomRemoteParticipant<T extends PeerMediaRemote>(
  current: readonly T[],
  next: PeerMediaUpsertInput,
): T[] {
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) {
    return [
      ...current,
      {
        id: next.id,
        displayName: next.displayName,
        endpointUsername: next.endpointUsername ?? null,
        conferenceGeneration: next.conferenceGeneration ?? undefined,
        stream: next.stream ?? null,
        audioStream: next.audioStream ?? null,
      } as T,
    ];
  }
  const copy = [...current];
  const existing = copy[index]!;
  copy[index] = {
    ...existing,
    displayName: next.displayName,
    endpointUsername:
      next.endpointUsername === undefined
        ? existing.endpointUsername ?? null
        : next.endpointUsername,
    conferenceGeneration: next.conferenceGeneration ?? existing.conferenceGeneration,
    stream: next.stream === undefined ? existing.stream : next.stream,
    audioStream:
      next.audioStream === undefined ? existing.audioStream ?? null : next.audioStream,
  };
  return copy;
}

export type PeerMediaSelectionCommit<T extends PeerMediaRemote> = {
  remotes: T[];
  projection: ReturnType<typeof projectSelectedPeerEndpoints<T>>;
  previouslySelectedEndpointIds: Set<string>;
};

export function createPeerMediaSelectionOwner<T extends PeerMediaRemote>(
  options?: ParticipantMediaSelectionOptions,
) {
  let remotes: T[] = [];
  let previouslySelectedByIdentity = new Map<string, string>(
    options?.previouslySelectedByIdentity ?? [],
  );

  const project = () =>
    projectSelectedPeerEndpoints(remotes, {
      previouslySelectedByIdentity,
    });

  return {
    get remotes(): readonly T[] {
      return remotes;
    },
    get previouslySelectedByIdentity(): ReadonlyMap<string, string> {
      return previouslySelectedByIdentity;
    },
    selectedEndpointIds(): Set<string> {
      return project().selectedIds;
    },
    commit(next: T[] | ((current: T[]) => T[])): PeerMediaSelectionCommit<T> {
      const previouslySelectedEndpointIds = new Set(previouslySelectedByIdentity.values());
      remotes = typeof next === "function" ? next(remotes) : next;
      const projection = project();
      previouslySelectedByIdentity = projection.nextPreviousByIdentity;
      return { remotes, projection, previouslySelectedEndpointIds };
    },
    reset(): PeerMediaSelectionCommit<T> {
      remotes = [];
      previouslySelectedByIdentity = new Map();
      return {
        remotes,
        projection: project(),
        previouslySelectedEndpointIds: new Set(),
      };
    },
  };
}

export type PeerMediaSelectionOwner<T extends PeerMediaRemote> = ReturnType<
  typeof createPeerMediaSelectionOwner<T>
>;
