"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  VOX_END_DEBOUNCE_MS,
  VOX_SPEAKING_OFF_LEVEL,
  VOX_SPEAKING_ON_LEVEL,
} from "@/lib/telemetry/speaking-activity-config";
import type { TrackerDebugState } from "@/lib/telemetry/voximplant-speaking-tracker";
import {
  buildSpeakingIntervalPayload,
  getTrackerBlockReason,
  postSpeakingInterval,
} from "@/lib/telemetry/voximplant-speaking-tracker";
import type { RoomAuthToken } from "@/lib/room-auth";

type VoximplantSpeakingActivityTrackerProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  sessionParticipantId?: string | null;
  participantIdentity?: string | null;
  localAudioStreamPresent: boolean;
  /** Live local microphone level 0–100 (from the Voximplant AnalyserNode). */
  micLevel: number | undefined;
  /** True when the local mic is muted (by user or by policy). No events emitted. */
  muted: boolean;
  /** Only track while connected to the conference. */
  enabled: boolean;
  connectionId?: string;
  audioProcessingEnabled?: boolean;
  recordingStatus?: string | null;
  debug?: boolean;
};

declare global {
  interface Window {
    __voxSpeakingTrackerDebug?: TrackerDebugState;
  }
}

export function VoximplantSpeakingActivityTracker({
  sessionId,
  roomAuth,
  sessionParticipantId,
  participantIdentity,
  localAudioStreamPresent,
  micLevel,
  muted,
  enabled,
  connectionId,
  audioProcessingEnabled,
  recordingStatus,
  debug = false,
}: VoximplantSpeakingActivityTrackerProps) {
  const speakingRef = useRef(false);
  const openIntervalStartedAtRef = useRef<Date | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const [debugState, setDebugState] = useState<TrackerDebugState>({
    mounted: true,
    localAudioStreamPresent: false,
    sessionParticipantIdPresent: false,
    participantIdentity: null,
    recordingActiveClientSide: false,
    lastIntervalStartedAt: null,
    lastIntervalEndedAt: null,
    lastPostAttemptAt: null,
    lastPostResult: "idle",
    lastError: null,
    blockReason: null,
  });

  const recordingActiveClientSide =
    recordingStatus === "STARTING" ||
    recordingStatus === "RECORDING" ||
    recordingStatus === "PAUSED";
  const blockReason = useMemo(
    () =>
      getTrackerBlockReason({
        enabled,
        localAudioStreamPresent,
        sessionParticipantId,
      }),
    [enabled, localAudioStreamPresent, sessionParticipantId],
  );
  const baseDebugState = useMemo(
    () => ({
      mounted: true,
      localAudioStreamPresent,
      sessionParticipantIdPresent: Boolean(sessionParticipantId),
      participantIdentity: participantIdentity ?? null,
      recordingActiveClientSide,
      blockReason,
    }),
    [
      blockReason,
      localAudioStreamPresent,
      participantIdentity,
      recordingActiveClientSide,
      sessionParticipantId,
    ],
  );

  const publishDebugState = useCallback(
    (patch: Partial<TrackerDebugState>) => {
      setDebugState((prev) => {
        const next = { ...baseDebugState, ...prev, ...patch };
        window.__voxSpeakingTrackerDebug = next;
        return next;
      });
    },
    [baseDebugState],
  );

  const clearStartTimer = useCallback(() => {
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  const clearEndTimer = useCallback(() => {
    if (endTimerRef.current !== null) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);

  const flushSpeakingInterval = useCallback(
    (endedAt: Date) => {
      const startedAt = openIntervalStartedAtRef.current;
      if (!startedAt) return;
      openIntervalStartedAtRef.current = null;
      speakingRef.current = false;
      publishDebugState({
        lastIntervalStartedAt: startedAt.toISOString(),
        lastIntervalEndedAt: endedAt.toISOString(),
        lastPostAttemptAt: new Date().toISOString(),
        lastPostResult: "idle",
        lastError: null,
      });

      if (!sessionParticipantId) {
        publishDebugState({
          lastPostResult: "failed",
          lastError: "participant-id-missing",
        });
        return;
      }

      const payload = buildSpeakingIntervalPayload({
        sessionParticipantId,
        participantIdentity,
        startedAt,
        endedAt,
        recordingActiveClientSide,
        audioProcessingEnabled,
      });

      void postSpeakingInterval({
        fetchImpl: fetch,
        sessionId,
        roomAuth,
        connectionId,
        payload,
      })
        .then((result) => {
          publishDebugState({
            lastPostResult: result.ok ? "success" : "failed",
            lastError: result.ok ? null : `status_${result.status}`,
          });
        })
        .catch((error) => {
          publishDebugState({
            lastPostResult: "failed",
            lastError: error instanceof Error ? error.message : "post-failed",
          });
        });
    },
    [
      audioProcessingEnabled,
      connectionId,
      participantIdentity,
      publishDebugState,
      recordingActiveClientSide,
      roomAuth,
      sessionId,
      sessionParticipantId,
    ],
  );

  useEffect(() => {
    window.__voxSpeakingTrackerDebug = { ...baseDebugState, ...debugState };
  }, [baseDebugState, debugState]);

  useEffect(() => {
    if (blockReason) {
      clearStartTimer();
      clearEndTimer();
      flushSpeakingInterval(new Date());
      return;
    }

    const level = muted ? 0 : micLevel ?? 0;

    if (level > VOX_SPEAKING_ON_LEVEL) {
      clearEndTimer();
      if (!speakingRef.current) {
        if (startTimerRef.current === null) {
          startTimerRef.current = window.setTimeout(() => {
            startTimerRef.current = null;
            if (!speakingRef.current) {
              speakingRef.current = true;
              openIntervalStartedAtRef.current = new Date();
            }
          }, 180);
        }
      }
      return;
    }

    clearStartTimer();

    if (
      level < VOX_SPEAKING_OFF_LEVEL &&
      speakingRef.current &&
      endTimerRef.current === null
    ) {
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        if (speakingRef.current) {
          flushSpeakingInterval(new Date());
        }
      }, VOX_END_DEBOUNCE_MS);
    }
  }, [blockReason, clearEndTimer, clearStartTimer, flushSpeakingInterval, micLevel, muted]);

  useEffect(() => {
    return () => {
      clearStartTimer();
      clearEndTimer();
      flushSpeakingInterval(new Date());
      const finalState = { ...debugState, mounted: false };
      window.__voxSpeakingTrackerDebug = finalState;
    };
  }, [clearEndTimer, clearStartTimer, debugState, flushSpeakingInterval]);

  if (!debug) {
    return null;
  }

  const visibleDebugState = { ...baseDebugState, ...debugState };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-[26rem] rounded-md border border-amber-500/40 bg-slate-950/90 px-3 py-2 text-xs text-amber-100 shadow-lg">
      <div className="font-semibold">Telemetry tracker</div>
      <div>mounted: yes</div>
      <div>local audio stream: {visibleDebugState.localAudioStreamPresent ? "yes" : "no"}</div>
      <div>sessionParticipantId: {visibleDebugState.sessionParticipantIdPresent ? "yes" : "no"}</div>
      <div>participantIdentity: {visibleDebugState.participantIdentity ?? "missing"}</div>
      <div>
        recordingActive client:{" "}
        {visibleDebugState.recordingActiveClientSide == null
          ? "unknown"
          : visibleDebugState.recordingActiveClientSide
            ? "true"
            : "false"}
      </div>
      <div>block reason: {visibleDebugState.blockReason ?? "none"}</div>
      <div>last interval startedAt: {visibleDebugState.lastIntervalStartedAt ?? "-"}</div>
      <div>last interval endedAt: {visibleDebugState.lastIntervalEndedAt ?? "-"}</div>
      <div>last POST attempt: {visibleDebugState.lastPostAttemptAt ?? "-"}</div>
      <div>last POST result: {visibleDebugState.lastPostResult}</div>
      <div>last error: {visibleDebugState.lastError ?? "-"}</div>
    </div>
  );
}
