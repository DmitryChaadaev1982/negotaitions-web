"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  VOX_END_DEBOUNCE_MS,
  VOX_SPEAKING_OFF_LEVEL,
  VOX_SPEAKING_ON_LEVEL,
} from "@/lib/telemetry/speaking-activity-config";
import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody } from "@/lib/room-auth";

type VoximplantSpeakingActivityTrackerProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  /** Live local microphone level 0–100 (from the Voximplant AnalyserNode). */
  micLevel: number | undefined;
  /** True when the local mic is muted (by user or by policy). No events emitted. */
  muted: boolean;
  /** Only track while connected to the conference. */
  enabled: boolean;
  connectionId?: string;
  audioProcessingEnabled?: boolean;
  recordingStatus?: string | null;
  recordingStartedAt?: string | null;
};

/**
 * Phase 3 — Voximplant speaking telemetry.
 *
 * The Voximplant room previously passed `speakingTracker={null}`, so no
 * `SessionParticipantAudioActivity` rows were ever written in the active
 * provider path (breaking auto speaker-mapping). This invisible component
 * derives the LOCAL participant's speaking transitions from the local mic
 * level and reports them to the existing audio-activity endpoint with
 * `source="VOXIMPLANT_MIC_ACTIVITY"`.
 *
 * Design notes:
 *   - Only the local participant's own activity is reported (each client runs
 *     its own tracker), which avoids false attribution and needs no audio.
 *   - Absolute `clientTimestamp` is sent; the auto-mapper computes the offset
 *     against `recording.startedAt` (same fallback the LiveKit path relies on).
 *   - Failures are swallowed — telemetry must never block the room UI.
 */
export function VoximplantSpeakingActivityTracker({
  sessionId,
  roomAuth,
  micLevel,
  muted,
  enabled,
  connectionId,
  audioProcessingEnabled,
  recordingStatus,
  recordingStartedAt,
}: VoximplantSpeakingActivityTrackerProps) {
  const speakingRef = useRef(false);
  const startTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const recordingStartMsRef = useRef<number | null>(null);

  const recordingActive =
    recordingStatus === "STARTING" ||
    recordingStatus === "RECORDING" ||
    recordingStatus === "PAUSED";

  useEffect(() => {
    if (!recordingStartedAt) {
      recordingStartMsRef.current = null;
      return;
    }
    const ts = Date.parse(recordingStartedAt);
    recordingStartMsRef.current = Number.isNaN(ts) ? null : ts;
  }, [recordingStartedAt]);

  const reportActivity = useCallback(
    (event: "SPEAKING_START" | "SPEAKING_END", eventTimeMs: number) => {
      const recordingStartMs = recordingStartMsRef.current;
      const offsetSeconds =
        recordingStartMs == null
          ? undefined
          : Math.max(
              0,
              Math.round(((eventTimeMs - recordingStartMs) / 1000) * 1000) / 1000,
            );
      void fetch(`/api/sessions/${sessionId}/audio-activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: event === "SPEAKING_END",
        body: JSON.stringify({
          ...roomAuthBody(roomAuth, { connectionId }),
          event,
          source: "VOXIMPLANT_MIC_ACTIVITY",
          clientTimestamp: new Date(eventTimeMs).toISOString(),
          offsetSeconds,
          audioLevel: Math.max(0, Math.min(100, Math.round(micLevel ?? 0))),
          telemetryCalibration: {
            speakingOnLevel: VOX_SPEAKING_ON_LEVEL,
            speakingOffLevel: VOX_SPEAKING_OFF_LEVEL,
            endDebounceMs: VOX_END_DEBOUNCE_MS,
            recordingActive,
            audioProcessingEnabled: audioProcessingEnabled ?? null,
          },
        }),
      }).catch(() => {
        // Best-effort — never surface telemetry errors to the user.
      });
    },
    [sessionId, roomAuth, connectionId, micLevel, audioProcessingEnabled, recordingActive],
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

  useEffect(() => {
    if (!enabled || !recordingActive) {
      clearStartTimer();
      clearEndTimer();
      if (speakingRef.current) {
        speakingRef.current = false;
        reportActivity("SPEAKING_END", Date.now());
      }
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
              reportActivity("SPEAKING_START", Date.now());
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
          speakingRef.current = false;
          reportActivity("SPEAKING_END", Date.now());
        }
      }, VOX_END_DEBOUNCE_MS);
    }
  }, [micLevel, muted, enabled, recordingActive, reportActivity, clearStartTimer, clearEndTimer]);

  // Flush an open SPEAKING_END on unmount so intervals are always closed.
  useEffect(() => {
    return () => {
      clearStartTimer();
      clearEndTimer();
      if (speakingRef.current) {
        speakingRef.current = false;
        reportActivity("SPEAKING_END", Date.now());
      }
    };
  }, [clearStartTimer, clearEndTimer, reportActivity]);

  return null;
}
