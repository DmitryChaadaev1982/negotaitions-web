"use client";

import { useEffect, useRef, useState } from "react";
import {
  REMOTE_SPEAKING_LEVEL_THRESHOLD,
  REMOTE_SPEAKING_RELEASE_MULTIPLIER,
} from "@/lib/telemetry/speaking-activity-config";

/**
 * Lightweight client-side speaking-state tracker for Voximplant remote streams.
 *
 * Bug 1 fix: in the Voximplant room layout remote tiles were hardcoded to
 * `isSpeaking=false`. This hook derives a real per-participant speaking boolean
 * from a Web Audio AnalyserNode on each remote MediaStream.
 *
 * Safety:
 *   - Only reads audio *levels* (RMS of the time-domain buffer). No audio is
 *     recorded, buffered, or transmitted.
 *   - AudioContext + AnalyserNode are torn down when a stream is removed or the
 *     component unmounts.
 *   - Muted/disconnected participants produce ~0 level → not speaking.
 */

/** Speaking detection threshold (level 0..100). Matches the lobby meter. */
export const SPEAKING_LEVEL_THRESHOLD = REMOTE_SPEAKING_LEVEL_THRESHOLD;
/** Hysteresis floor: only drop the speaking flag below this level. */
const SPEAKING_LEVEL_RELEASE =
  SPEAKING_LEVEL_THRESHOLD * REMOTE_SPEAKING_RELEASE_MULTIPLIER;

export function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/**
 * Attach a Web Audio meter to a MediaStream. Calls `onLevel` (~15fps) with a
 * 0..100 level. Returns a cleanup function that fully releases the AudioContext.
 */
export function createAudioLevelMeter(
  mediaStream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  try {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return () => {};
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const source = ctx.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;
    let stopped = false;
    let lastTickMs = 0;

    const tick = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(tick);
      const now = Date.now();
      if (now - lastTickMs < 66) return;
      lastTickMs = now;
      analyser.getByteTimeDomainData(dataArray);
      let sumSq = 0;
      for (const value of dataArray) {
        const normalized = (value - 128) / 128;
        sumSq += normalized * normalized;
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      onLevel(Math.min(100, Math.round(rms * 300)));
    };

    rafId = requestAnimationFrame(tick);
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      try {
        source.disconnect();
      } catch {}
      try {
        analyser.disconnect();
      } catch {}
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

export type RemoteSpeakingInput = {
  id: string;
  stream: MediaStream | null;
  microphoneEnabled?: boolean;
  generation?: string | number | null;
};

export type RemoteSpeakingState = {
  isSpeaking: boolean;
  generation: string | number | null;
};

export function shouldAttachRemoteSpeakingMeter(participant: RemoteSpeakingInput): boolean {
  if (participant.microphoneEnabled === false) return false;
  const tracks = participant.stream?.getAudioTracks() ?? [];
  return tracks.some((track) => track.enabled);
}

/**
 * The stream that actually carries the participant's audio.
 *
 * Remote endpoints publish audio and video as separate streams, and the audio
 * stream can be re-wrapped around the same live track. Resolving the source
 * explicitly keeps the analyser attached to real audio for every role instead of
 * silently falling back to a video-only stream.
 */
export function resolveSpeakingSourceStream(input: {
  audioStream?: MediaStream | null;
  videoStream?: MediaStream | null;
}): MediaStream | null {
  const candidates = [input.audioStream ?? null, input.videoStream ?? null].filter(
    (stream): stream is MediaStream => stream !== null,
  );
  return (
    candidates.find((stream) => stream.getAudioTracks().some((track) => track.enabled)) ??
    candidates.find((stream) => stream.getAudioTracks().length > 0) ??
    null
  );
}

/**
 * Identity of the audio track a meter is bound to. Meters are keyed by track
 * identity rather than MediaStream identity so re-wrapping the same live track
 * does not tear down a working analyser (which would reset speaking to false),
 * while a genuinely replaced track always gets a new analyser.
 */
export function resolveSpeakingAudioTrackId(
  stream: MediaStream | null | undefined,
): string | null {
  const tracks = stream?.getAudioTracks() ?? [];
  const enabled = tracks.find((track) => track.enabled);
  return enabled?.id ?? null;
}

export function isRemoteSpeaking(
  speakingById: Record<string, RemoteSpeakingState>,
  participantId: string,
): boolean {
  return speakingById[participantId]?.isSpeaking === true;
}

export function resolveRemoteSpeakingGeneration(
  speakingById: Record<string, RemoteSpeakingState>,
  participantId: string,
): string | number | null | undefined {
  return speakingById[participantId]?.generation;
}

export function shouldAcceptRemoteSpeakingLevel(input: {
  currentGeneration: string | number | null | undefined;
  updateGeneration: string | number | null | undefined;
  microphoneEnabled: boolean;
  level: number;
}): boolean {
  return (
    input.microphoneEnabled &&
    input.currentGeneration === input.updateGeneration &&
    Number.isFinite(input.level)
  );
}

/**
 * Track speaking state for a set of remote participants.
 * Returns a map of participantId → speaking state tagged with the generation the
 * signal was produced under, so a renderer can reject a stale connection.
 *
 * The input array should be memoized by the caller so meters are only rebuilt
 * when the participant set or their streams actually change (not on every
 * unrelated re-render such as local mic-level updates).
 */
export function useRemoteSpeaking(
  participants: RemoteSpeakingInput[],
): Record<string, RemoteSpeakingState> {
  const [speakingById, setSpeakingById] = useState<Record<string, RemoteSpeakingState>>({});
  const metersRef = useRef(
    new Map<
      string,
      {
        stream: MediaStream;
        audioTrackId: string;
        generation: string | number | null;
        microphoneEnabled: boolean;
        cleanup: () => void;
      }
    >(),
  );

  useEffect(() => {
    const meters = metersRef.current;
    const wanted = new Map<string, MediaStream | null>();
    for (const participant of participants) {
      wanted.set(participant.id, participant.stream ?? null);
    }

    const clearSpeaking = (id: string, generation: string | number | null) => {
      setSpeakingById((prev) => {
        const current = prev[id];
        if (current && !current.isSpeaking && current.generation === generation) return prev;
        return { ...prev, [id]: { isSpeaking: false, generation } };
      });
    };

    // Tear down meters that are gone or whose audio track, generation, or
    // microphone state changed.
    for (const [id, meter] of [...meters]) {
      const participant = participants.find((item) => item.id === id);
      const stream = wanted.get(id) ?? null;
      const generation = participant?.generation ?? null;
      const microphoneEnabled = participant?.microphoneEnabled !== false;
      if (
        !wanted.has(id) ||
        resolveSpeakingAudioTrackId(stream) !== meter.audioTrackId ||
        generation !== meter.generation ||
        microphoneEnabled !== meter.microphoneEnabled ||
        !shouldAttachRemoteSpeakingMeter(participant ?? { id, stream })
      ) {
        meter.cleanup();
        meters.delete(id);
        clearSpeaking(id, generation);
      }
    }

    // Attach meters for participants whose current audio track has no meter yet.
    for (const participant of participants) {
      const stream = participant.stream;
      if (!stream) continue;
      const existing = meters.get(participant.id);
      const generation = participant.generation ?? null;
      const microphoneEnabled = participant.microphoneEnabled !== false;
      const audioTrackId = resolveSpeakingAudioTrackId(stream);
      if (
        existing &&
        audioTrackId !== null &&
        existing.audioTrackId === audioTrackId &&
        existing.generation === generation &&
        existing.microphoneEnabled === microphoneEnabled
      ) {
        continue;
      }
      if (audioTrackId === null) continue;
      if (!shouldAttachRemoteSpeakingMeter(participant)) continue;

      const cleanup = createAudioLevelMeter(stream, (level) => {
        const currentMeter = metersRef.current.get(participant.id);
        if (
          currentMeter?.audioTrackId !== audioTrackId ||
          !shouldAcceptRemoteSpeakingLevel({
            currentGeneration: currentMeter?.generation,
            updateGeneration: generation,
            microphoneEnabled: currentMeter?.microphoneEnabled === true,
            level,
          })
        ) {
          return;
        }
        setSpeakingById((prev) => {
          const current = prev[participant.id]?.isSpeaking ?? false;
          if (level > SPEAKING_LEVEL_THRESHOLD && !current) {
            return { ...prev, [participant.id]: { isSpeaking: true, generation } };
          }
          if (level < SPEAKING_LEVEL_RELEASE && current) {
            return { ...prev, [participant.id]: { isSpeaking: false, generation } };
          }
          if (prev[participant.id]?.generation !== generation) {
            return { ...prev, [participant.id]: { isSpeaking: current, generation } };
          }
          return prev;
        });
      });
      meters.set(participant.id, {
        stream,
        audioTrackId,
        generation,
        microphoneEnabled,
        cleanup,
      });
    }
  }, [participants]);

  useEffect(() => {
    const meters = metersRef.current;
    return () => {
      for (const meter of meters.values()) {
        meter.cleanup();
      }
      meters.clear();
    };
  }, []);

  return speakingById;
}
