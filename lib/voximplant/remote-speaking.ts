"use client";

import { useEffect, useRef, useState } from "react";

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
export const SPEAKING_LEVEL_THRESHOLD = 8;
/** Hysteresis floor: only drop the speaking flag below this level. */
const SPEAKING_LEVEL_RELEASE = SPEAKING_LEVEL_THRESHOLD * 0.6;

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
};

/**
 * Track speaking state for a set of remote participants.
 * Returns a map of participantId → isSpeaking.
 *
 * The input array should be memoized by the caller so meters are only rebuilt
 * when the participant set or their streams actually change (not on every
 * unrelated re-render such as local mic-level updates).
 */
export function useRemoteSpeaking(
  participants: RemoteSpeakingInput[],
): Record<string, boolean> {
  const [speakingById, setSpeakingById] = useState<Record<string, boolean>>({});
  const metersRef = useRef(
    new Map<string, { stream: MediaStream; cleanup: () => void }>(),
  );

  useEffect(() => {
    const meters = metersRef.current;
    const wanted = new Map<string, MediaStream | null>();
    for (const participant of participants) {
      wanted.set(participant.id, participant.stream ?? null);
    }

    // Tear down meters that are gone or whose stream changed.
    for (const [id, meter] of [...meters]) {
      const stream = wanted.get(id);
      if (!wanted.has(id) || stream !== meter.stream) {
        meter.cleanup();
        meters.delete(id);
        setSpeakingById((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    // Attach meters for new streams with an audio track.
    for (const participant of participants) {
      const stream = participant.stream;
      if (!stream) continue;
      const existing = meters.get(participant.id);
      if (existing && existing.stream === stream) continue;
      if (stream.getAudioTracks().length === 0) continue;

      const cleanup = createAudioLevelMeter(stream, (level) => {
        setSpeakingById((prev) => {
          const current = prev[participant.id] ?? false;
          if (level > SPEAKING_LEVEL_THRESHOLD && !current) {
            return { ...prev, [participant.id]: true };
          }
          if (level < SPEAKING_LEVEL_RELEASE && current) {
            return { ...prev, [participant.id]: false };
          }
          return prev;
        });
      });
      meters.set(participant.id, { stream, cleanup });
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
