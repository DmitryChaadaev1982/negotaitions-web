type VoxLikeStream = {
  track?: MediaStreamTrack;
  sourceStream?: MediaStream;
};

type AudioElementLike = {
  pause: () => void;
  srcObject: MediaProvider | null;
};

type MediaProvider = MediaStream | MediaSource | Blob | File;

export function stopVoxLikeStreamTracks(stream: VoxLikeStream | null): void {
  if (!stream) return;
  try {
    stream.track?.stop();
  } catch {
    // no-op
  }
  if (stream.sourceStream) {
    try {
      for (const track of stream.sourceStream.getTracks()) track.stop();
    } catch {
      // no-op
    }
  }
}

export function clearRemoteAudioElements(elements: Map<string, AudioElementLike>): void {
  for (const audio of elements.values()) {
    audio.pause();
    audio.srcObject = null;
  }
  elements.clear();
}
