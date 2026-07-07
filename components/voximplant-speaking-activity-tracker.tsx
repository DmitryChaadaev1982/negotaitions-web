"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  VOX_END_DEBOUNCE_MS,
  VOX_MIN_INTERVAL_MS,
  VOX_SPEAKING_OFF_LEVEL,
  VOX_SPEAKING_ON_LEVEL,
} from "@/lib/telemetry/speaking-activity-config";
import type {
  LifecycleCloseReason,
  TrackerDebugState,
} from "@/lib/telemetry/voximplant-speaking-tracker";
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
  /**
   * True when the app microphone is muted (user toggle or policy lock).
   * Browser tab/output mute is not equivalent and cannot be used for capture gating.
   */
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
  const intervalOpenRef = useRef(false);
  const intervalStartedAtRef = useRef<Date | null>(null);
  const postCountRef = useRef(0);
  const silenceTimerRef = useRef<number | null>(null);
  const skippedShortIntervalCountRef = useRef(0);
  const lastBlockReasonRef = useRef<ReturnType<typeof getTrackerBlockReason>>(null);
  const mountedRef = useRef(true);
  const latestRuntimeRef = useRef({
    sessionId,
    roomAuth,
    sessionParticipantId,
    participantIdentity,
    recordingActiveClientSide: false,
    audioProcessingEnabled,
    connectionId,
  });
  const [debugState, setDebugState] = useState<TrackerDebugState>({
    mounted: true,
    enabled: false,
    localAudioStreamPresent: false,
    sessionParticipantIdPresent: false,
    sessionParticipantId: null,
    participantIdentity: null,
    micLevel: null,
    muted: false,
    speaking: false,
    intervalOpen: false,
    recordingActiveClientSide: false,
    postCount: 0,
    lastPostStatus: null,
    lastPostResponse: null,
    lastOpenReason: null,
    lastCloseReason: null,
    openSince: null,
    skippedShortIntervalCount: 0,
    pendingSilenceClose: false,
    lastIntervalStartedAt: null,
    lastIntervalEndedAt: null,
    lastPostAttemptAt: null,
    lastPostResult: "idle",
    lastError: null,
    blockReason: null,
  });
  const debugStateRef = useRef<TrackerDebugState>(debugState);

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
      enabled,
      localAudioStreamPresent,
      sessionParticipantIdPresent: Boolean(sessionParticipantId),
      sessionParticipantId: sessionParticipantId ?? null,
      participantIdentity: participantIdentity ?? null,
      micLevel: typeof micLevel === "number" ? micLevel : null,
      muted,
      recordingActiveClientSide,
      blockReason,
    }),
    [
      enabled,
      blockReason,
      localAudioStreamPresent,
      micLevel,
      muted,
      participantIdentity,
      recordingActiveClientSide,
      sessionParticipantId,
    ],
  );

  const publishDebugState = useCallback(
    (patch: Partial<TrackerDebugState>) => {
      const prev = debugStateRef.current;
      const next = { ...prev, ...baseDebugState, ...patch };
      debugStateRef.current = next;
      window.__voxSpeakingTrackerDebug = next;
      if (mountedRef.current) {
        setDebugState(next);
      }
    },
    [baseDebugState],
  );

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const flushSpeakingInterval = useCallback(
    (endedAt: Date, reason: LifecycleCloseReason) => {
      const startedAt = intervalStartedAtRef.current;
      if (!startedAt) return;
      intervalStartedAtRef.current = null;
      intervalOpenRef.current = false;
      clearSilenceTimer();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      publishDebugState({
        speaking: false,
        intervalOpen: false,
        pendingSilenceClose: false,
        openSince: null,
        lastCloseReason: reason,
        lastIntervalStartedAt: startedAt.toISOString(),
        lastIntervalEndedAt: endedAt.toISOString(),
        lastPostAttemptAt: new Date().toISOString(),
        lastPostResult: "idle",
        lastError: null,
      });
      if (durationMs < VOX_MIN_INTERVAL_MS) {
        skippedShortIntervalCountRef.current += 1;
        publishDebugState({
          skippedShortIntervalCount: skippedShortIntervalCountRef.current,
        });
        return;
      }

      const runtime = latestRuntimeRef.current;
      if (!runtime.sessionParticipantId) {
        publishDebugState({
          lastPostResult: "failed",
          lastError: "participant-id-missing",
        });
        return;
      }

      const payload = buildSpeakingIntervalPayload({
        sessionParticipantId: runtime.sessionParticipantId,
        participantIdentity: runtime.participantIdentity,
        startedAt,
        endedAt,
        recordingActiveClientSide: runtime.recordingActiveClientSide,
        audioProcessingEnabled: runtime.audioProcessingEnabled,
      });

      void postSpeakingInterval({
        fetchImpl: window.fetch.bind(window),
        sessionId: runtime.sessionId,
        roomAuth: runtime.roomAuth,
        connectionId: runtime.connectionId,
        payload,
      })
        .then((result) => {
          postCountRef.current += 1;
          publishDebugState({
            postCount: postCountRef.current,
            lastPostStatus: result.status,
            lastPostResponse: result.ok ? "ok" : `status_${result.status}`,
            lastPostResult: result.ok ? "success" : "failed",
            lastError: result.ok ? null : `status_${result.status}`,
          });
        })
        .catch((error) => {
          postCountRef.current += 1;
          publishDebugState({
            postCount: postCountRef.current,
            lastPostStatus: null,
            lastPostResponse: null,
            lastPostResult: "failed",
            lastError: error instanceof Error ? error.message : "post-failed",
          });
        });
    },
    [
      clearSilenceTimer,
      publishDebugState,
    ],
  );
  const flushSpeakingIntervalRef = useRef(flushSpeakingInterval);

  const openSpeakingInterval = useCallback(
    (openedAt: Date, reason: string) => {
      if (intervalOpenRef.current) return;
      intervalOpenRef.current = true;
      intervalStartedAtRef.current = openedAt;
      clearSilenceTimer();
      publishDebugState({
        speaking: true,
        intervalOpen: true,
        pendingSilenceClose: false,
        openSince: openedAt.toISOString(),
        lastOpenReason: reason,
      });
    },
    [clearSilenceTimer, publishDebugState],
  );

  useEffect(() => {
    flushSpeakingIntervalRef.current = flushSpeakingInterval;
  }, [flushSpeakingInterval]);

  const scheduleSilenceClose = useCallback(
    (reason: LifecycleCloseReason) => {
      if (!intervalOpenRef.current || silenceTimerRef.current !== null) return;
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null;
        if (intervalOpenRef.current) {
          flushSpeakingInterval(new Date(), reason);
        }
      }, VOX_END_DEBOUNCE_MS);
      publishDebugState({
        pendingSilenceClose: true,
        lastCloseReason: reason,
      });
    },
    [flushSpeakingInterval, publishDebugState],
  );

  useEffect(() => {
    window.__voxSpeakingTrackerDebug = { ...baseDebugState, ...debugState };
    debugStateRef.current = { ...baseDebugState, ...debugState };
  }, [baseDebugState, debugState]);

  useEffect(() => {
    latestRuntimeRef.current = {
      sessionId,
      roomAuth,
      sessionParticipantId,
      participantIdentity,
      recordingActiveClientSide,
      audioProcessingEnabled,
      connectionId,
    };
  }, [
    audioProcessingEnabled,
    connectionId,
    participantIdentity,
    recordingActiveClientSide,
    roomAuth,
    sessionId,
    sessionParticipantId,
  ]);

  useEffect(() => {
    const previous = lastBlockReasonRef.current;
    const becameBlocked = previous === null && blockReason !== null;
    lastBlockReasonRef.current = blockReason;
    if (becameBlocked) {
      clearSilenceTimer();
      flushSpeakingInterval(new Date(), "block_transition");
    }
  }, [blockReason, clearSilenceTimer, flushSpeakingInterval]);

  useEffect(() => {
    const level = muted ? 0 : micLevel ?? 0;
    if (blockReason) {
      clearSilenceTimer();
      publishDebugState({
        micLevel: typeof micLevel === "number" ? micLevel : null,
        muted,
        speaking: intervalOpenRef.current,
        intervalOpen: intervalOpenRef.current,
        pendingSilenceClose: silenceTimerRef.current !== null,
      });
      return;
    }

    if (level > VOX_SPEAKING_ON_LEVEL) {
      openSpeakingInterval(new Date(), "level_above_on_threshold");
      return;
    }

    if (level < VOX_SPEAKING_OFF_LEVEL && intervalOpenRef.current) {
      scheduleSilenceClose(muted ? "muted" : "silence_debounce");
    }
  }, [
    blockReason,
    clearSilenceTimer,
    micLevel,
    muted,
    openSpeakingInterval,
    publishDebugState,
    scheduleSilenceClose,
  ]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (silenceTimerRef.current !== null) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      flushSpeakingIntervalRef.current(new Date(), "unmount");
      const finalState = {
        ...debugStateRef.current,
        mounted: false,
      };
      debugStateRef.current = finalState;
      window.__voxSpeakingTrackerDebug = finalState;
    };
  }, []);

  useEffect(() => {
    publishDebugState({
      speaking: intervalOpenRef.current,
      intervalOpen: intervalOpenRef.current,
      pendingSilenceClose: silenceTimerRef.current !== null,
      skippedShortIntervalCount: skippedShortIntervalCountRef.current,
      micLevel: typeof micLevel === "number" ? micLevel : null,
      muted,
    });
  }, [micLevel, muted, publishDebugState]);

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
