/**
 * Deterministic remote peer-media selection for one logical participant.
 *
 * Logical participant identity is the normalized Vox username (trim, lowercase,
 * domain-stripped). Vox endpoint id is transport/media-instance identity only.
 *
 * Live-track-first quality beats a stale MediaStream object. The helper is
 * pure and synchronous: no I/O, timers, SDK-state wait, or peer ack.
 */

import { isLiveMediaTrack, liveTracksOfKind } from "@/lib/voximplant/media-liveness";
import { isUsableRemoteVideo } from "@/lib/voximplant/remote-media-receive-state";

export const PARTICIPANT_MEDIA_TIE_BREAK =
  "Equal-quality candidates keep the previously selected endpoint when it is still in the group; otherwise lexicographic endpoint id. Endpoint id order is a stable tie-break only, not a Vox recency signal.";

export type ParticipantMediaCandidateQuality =
  | "live_video"
  | "live_audio"
  | "media_absent"
  | "unusable";

export const PARTICIPANT_MEDIA_QUALITY_RANK: Record<
  ParticipantMediaCandidateQuality,
  number
> = {
  live_video: 40,
  live_audio: 30,
  media_absent: 20,
  unusable: 10,
};

const UNGROUPED_IDENTITY_PREFIX = "endpoint:";

export type ParticipantMediaCandidate = {
  endpointId: string;
  endpointUsername?: string | null;
  /** Observer/local conference generation when known. Missing is treated as 0. */
  generation?: number | null;
  videoStream?: MediaStream | null;
  audioStream?: MediaStream | null;
  /** Used when no MediaStream is present (recovery-runtime flags). */
  videoLive?: boolean;
  audioLive?: boolean;
  /**
   * SDK inbound video receive state. `false` is PAUSED and cannot rank as
   * live_video even when the native track remains live.
   */
  videoReceiving?: boolean;
};

export type ParticipantMediaSelectionResult = {
  logicalIdentity: string;
  selected: ParticipantMediaCandidate | null;
  quality: ParticipantMediaCandidateQuality | null;
  suppressedEndpointIds: string[];
};

export type ParticipantMediaSelectionOptions = {
  previouslySelectedEndpointId?: string | null;
  previouslySelectedByIdentity?: ReadonlyMap<string, string>;
};

/**
 * Same product identity as session-room layout matching and lobby username
 * compare: trim, lowercase, strip `@domain`.
 */
export function normalizeParticipantMediaIdentity(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.includes("@") ? (normalized.split("@")[0] ?? null) : normalized;
}

export function logicalParticipantIdentityForCandidate(
  candidate: Pick<ParticipantMediaCandidate, "endpointId" | "endpointUsername">,
): string {
  return (
    normalizeParticipantMediaIdentity(candidate.endpointUsername) ??
    `${UNGROUPED_IDENTITY_PREFIX}${candidate.endpointId}`
  );
}

export function isUngroupedParticipantMediaIdentity(identity: string): boolean {
  return identity.startsWith(UNGROUPED_IDENTITY_PREFIX);
}

export function participantMediaCandidateFromRemote(remote: {
  id: string;
  endpointUsername?: string | null;
  generation?: number | null;
  conferenceGeneration?: number | null;
  stream?: MediaStream | null;
  audioStream?: MediaStream | null;
  streamLive?: boolean;
  audioLive?: boolean;
  videoReceiving?: boolean;
}): ParticipantMediaCandidate {
  return {
    endpointId: remote.id,
    endpointUsername: remote.endpointUsername,
    generation: remote.generation ?? remote.conferenceGeneration,
    videoStream: remote.stream,
    audioStream: remote.audioStream,
    videoLive: remote.streamLive,
    audioLive: remote.audioLive,
    videoReceiving: remote.videoReceiving,
  };
}

function hasExplicitStreams(candidate: ParticipantMediaCandidate): boolean {
  return candidate.videoStream != null || candidate.audioStream != null;
}

export function candidateHasLiveVideo(candidate: ParticipantMediaCandidate): boolean {
  const trackLive = candidate.videoStream
    ? liveTracksOfKind(candidate.videoStream, "video").length > 0
    : candidate.videoLive === true;
  return isUsableRemoteVideo({
    currentGeneration: true,
    trackLive,
    isReceiving: candidate.videoReceiving,
  });
}

export function candidateHasLiveAudio(candidate: ParticipantMediaCandidate): boolean {
  if (candidate.audioStream) {
    if (liveTracksOfKind(candidate.audioStream, "audio").length > 0) return true;
  }
  if (candidate.videoStream) {
    if (liveTracksOfKind(candidate.videoStream, "audio").length > 0) return true;
  }
  if (hasExplicitStreams(candidate)) return false;
  return candidate.audioLive === true;
}

export function candidateHasUnusableMedia(candidate: ParticipantMediaCandidate): boolean {
  if (hasExplicitStreams(candidate)) {
    const tracks = [
      ...(candidate.videoStream?.getTracks() ?? []),
      ...(candidate.audioStream?.getTracks() ?? []),
    ];
    if (tracks.length === 0) return false;
    return !tracks.some((track) => isLiveMediaTrack(track));
  }
  return candidate.videoLive === false && candidate.audioLive === false;
}

export function inspectParticipantMediaCandidate(candidate: ParticipantMediaCandidate): {
  quality: ParticipantMediaCandidateQuality;
  rank: number;
  liveVideo: boolean;
  liveAudio: boolean;
} {
  const liveVideo = candidateHasLiveVideo(candidate);
  const liveAudio = candidateHasLiveAudio(candidate);
  if (liveVideo) {
    return {
      quality: "live_video",
      rank: PARTICIPANT_MEDIA_QUALITY_RANK.live_video + (liveAudio ? 1 : 0),
      liveVideo,
      liveAudio,
    };
  }
  if (liveAudio) {
    return {
      quality: "live_audio",
      rank: PARTICIPANT_MEDIA_QUALITY_RANK.live_audio,
      liveVideo,
      liveAudio,
    };
  }
  if (candidateHasUnusableMedia(candidate)) {
    return {
      quality: "unusable",
      rank: PARTICIPANT_MEDIA_QUALITY_RANK.unusable,
      liveVideo,
      liveAudio,
    };
  }
  return {
    quality: "media_absent",
    rank: PARTICIPANT_MEDIA_QUALITY_RANK.media_absent,
    liveVideo,
    liveAudio,
  };
}

function candidateHasAnyLiveMedia(candidate: ParticipantMediaCandidate): boolean {
  return candidateHasLiveVideo(candidate) || candidateHasLiveAudio(candidate);
}

function effectiveInspect(
  candidate: ParticipantMediaCandidate,
  currentGenerationHasLive: boolean,
  maxGeneration: number,
): ReturnType<typeof inspectParticipantMediaCandidate> {
  const inspected = inspectParticipantMediaCandidate(candidate);
  if (
    currentGenerationHasLive &&
    maxGeneration > 0 &&
    (candidate.generation ?? 0) < maxGeneration
  ) {
    return {
      quality: "unusable",
      rank: PARTICIPANT_MEDIA_QUALITY_RANK.unusable,
      liveVideo: false,
      liveAudio: false,
    };
  }
  return inspected;
}

function compareParticipantMediaCandidates(
  left: ParticipantMediaCandidate,
  right: ParticipantMediaCandidate,
  currentGenerationHasLive: boolean,
  maxGeneration: number,
  previouslySelectedEndpointId: string | null | undefined,
): number {
  const leftInspected = effectiveInspect(left, currentGenerationHasLive, maxGeneration);
  const rightInspected = effectiveInspect(right, currentGenerationHasLive, maxGeneration);
  if (leftInspected.rank !== rightInspected.rank) {
    return rightInspected.rank - leftInspected.rank;
  }
  const leftGeneration = left.generation ?? 0;
  const rightGeneration = right.generation ?? 0;
  if (leftGeneration !== rightGeneration) {
    return rightGeneration - leftGeneration;
  }
  if (previouslySelectedEndpointId) {
    if (left.endpointId === previouslySelectedEndpointId) return -1;
    if (right.endpointId === previouslySelectedEndpointId) return 1;
  }
  if (left.endpointId < right.endpointId) return -1;
  if (left.endpointId > right.endpointId) return 1;
  return 0;
}

export function selectParticipantMediaCandidate(
  candidates: readonly ParticipantMediaCandidate[],
  options?: ParticipantMediaSelectionOptions,
): ParticipantMediaSelectionResult {
  if (candidates.length === 0) {
    return {
      logicalIdentity: "",
      selected: null,
      quality: null,
      suppressedEndpointIds: [],
    };
  }

  const logicalIdentity = logicalParticipantIdentityForCandidate(candidates[0]!);
  const generations = candidates.map((candidate) => candidate.generation ?? 0);
  const maxGeneration = Math.max(0, ...generations);
  const currentGenerationHasLive = candidates.some(
    (candidate) =>
      (candidate.generation ?? 0) === maxGeneration && candidateHasAnyLiveMedia(candidate),
  );
  const previouslySelectedEndpointId =
    options?.previouslySelectedEndpointId ??
    options?.previouslySelectedByIdentity?.get(logicalIdentity) ??
    null;

  const ordered = [...candidates].sort((left, right) =>
    compareParticipantMediaCandidates(
      left,
      right,
      currentGenerationHasLive,
      maxGeneration,
      previouslySelectedEndpointId,
    ),
  );
  const selected = ordered[0] ?? null;
  const quality = selected
    ? effectiveInspect(selected, currentGenerationHasLive, maxGeneration).quality
    : null;
  return {
    logicalIdentity,
    selected,
    quality,
    suppressedEndpointIds: ordered.slice(1).map((candidate) => candidate.endpointId),
  };
}

export function selectParticipantMediaByLogicalIdentity(
  candidates: readonly ParticipantMediaCandidate[],
  options?: ParticipantMediaSelectionOptions,
): Map<string, ParticipantMediaSelectionResult> {
  const groups = new Map<string, ParticipantMediaCandidate[]>();
  for (const candidate of candidates) {
    const identity = logicalParticipantIdentityForCandidate(candidate);
    const group = groups.get(identity);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(identity, [candidate]);
    }
  }

  const selected = new Map<string, ParticipantMediaSelectionResult>();
  for (const [identity, group] of groups) {
    selected.set(
      identity,
      selectParticipantMediaCandidate(group, {
        previouslySelectedEndpointId: options?.previouslySelectedByIdentity?.get(identity),
        previouslySelectedByIdentity: options?.previouslySelectedByIdentity,
      }),
    );
  }
  return selected;
}

export function projectSelectedPeerEndpoints<
  T extends {
    id: string;
    endpointUsername?: string | null;
    generation?: number | null;
    conferenceGeneration?: number | null;
    stream?: MediaStream | null;
    audioStream?: MediaStream | null;
    streamLive?: boolean;
    audioLive?: boolean;
    videoReceiving?: boolean;
  },
>(
  remotes: readonly T[],
  options?: ParticipantMediaSelectionOptions,
): {
  selectedByIdentity: Map<string, T>;
  selectedIds: Set<string>;
  nextPreviousByIdentity: Map<string, string>;
  suppressedIds: string[];
} {
  const byId = new Map(remotes.map((remote) => [remote.id, remote]));
  const grouped = selectParticipantMediaByLogicalIdentity(
    remotes.map(participantMediaCandidateFromRemote),
    options,
  );
  const selectedByIdentity = new Map<string, T>();
  const selectedIds = new Set<string>();
  const nextPreviousByIdentity = new Map<string, string>();
  const suppressedIds: string[] = [];

  for (const [identity, result] of grouped) {
    suppressedIds.push(...result.suppressedEndpointIds);
    if (!result.selected) continue;
    const remote = byId.get(result.selected.endpointId);
    if (!remote) continue;
    selectedByIdentity.set(identity, remote);
    selectedIds.add(remote.id);
    nextPreviousByIdentity.set(identity, remote.id);
  }

  return {
    selectedByIdentity,
    selectedIds,
    nextPreviousByIdentity,
    suppressedIds,
  };
}

/**
 * Layout/speaking projection from an already-authoritative selected-id set.
 * Does not re-run candidate ranking; callers must pass the same selected
 * endpoint ids owned by session-room peer-media selection.
 */
export function selectedRemotesByLogicalIdentity<
  T extends { id: string; endpointUsername?: string | null },
>(remotes: readonly T[], selectedEndpointIds: ReadonlySet<string>): Map<string, T> {
  const map = new Map<string, T>();
  for (const remote of remotes) {
    if (!selectedEndpointIds.has(remote.id)) continue;
    const identity = logicalParticipantIdentityForCandidate({
      endpointId: remote.id,
      endpointUsername: remote.endpointUsername,
    });
    if (isUngroupedParticipantMediaIdentity(identity)) continue;
    map.set(identity, remote);
  }
  return map;
}
