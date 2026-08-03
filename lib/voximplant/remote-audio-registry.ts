/**
 * Bookkeeping rules for remote audio streams of a Voximplant endpoint.
 *
 * A remote tile renders its microphone state from the published session media
 * status, while the speaking analyser needs the actual remote audio MediaStream.
 * Those two sources drifted apart: an audio remove/re-add cycle (which the
 * RUNNING microphone policy triggers for observers and facilitators) could leave
 * the tracked audio stream permanently null while the tile still reported an
 * enabled microphone. No analyser was then attached, so the tile could never
 * show the active-speaker highlight.
 *
 * These helpers keep the tracked audio stream aligned with the endpoint's real
 * audio streams without ever downgrading a live stream to null.
 */

export function buildRemoteAudioElementKey(endpointId: string, streamId: string): string {
  return `${endpointId}-${streamId}`;
}

export function isRemoteAudioElementKeyForEndpoint(key: string, endpointId: string): boolean {
  return key.startsWith(`${endpointId}-`);
}

function hasEnabledAudioTrack(stream: MediaStream | null | undefined): boolean {
  return (stream?.getAudioTracks() ?? []).some((track) => track.enabled);
}

function hasAudioTrack(stream: MediaStream | null | undefined): boolean {
  return (stream?.getAudioTracks() ?? []).length > 0;
}

/**
 * Resolve the audio stream a remote tile should expose.
 *
 * Preference order:
 *   1. an endpoint stream with an enabled audio track;
 *   2. the already attached stream while it still carries an enabled track;
 *   3. any endpoint stream that still carries an audio track;
 *   4. the already attached stream while it still carries an audio track.
 *
 * A stream that the endpoint no longer reports and that has lost its tracks is
 * dropped, so removing audio still clears the speaking state immediately.
 */
export function resolveRemoteAudioStream(input: {
  endpointAudioStreams: readonly (MediaStream | null)[];
  attachedAudioStream: MediaStream | null;
}): MediaStream | null {
  const endpointStreams = input.endpointAudioStreams.filter(
    (stream): stream is MediaStream => stream !== null,
  );

  const enabledEndpointStream = endpointStreams.find(hasEnabledAudioTrack);
  if (enabledEndpointStream) return enabledEndpointStream;
  if (hasEnabledAudioTrack(input.attachedAudioStream)) return input.attachedAudioStream;

  const endpointStreamWithTrack = endpointStreams.find(hasAudioTrack);
  if (endpointStreamWithTrack) return endpointStreamWithTrack;
  if (hasAudioTrack(input.attachedAudioStream)) return input.attachedAudioStream;

  return null;
}

/**
 * The playback `<audio>` element is created once per endpoint/stream pair, but
 * the tracked audio stream must be published on every attach so a re-added
 * stream is not swallowed by playback idempotency.
 */
export function shouldCreateRemoteAudioElement(input: {
  attachedElementKeys: readonly string[];
  key: string;
}): boolean {
  return !input.attachedElementKeys.includes(input.key);
}
