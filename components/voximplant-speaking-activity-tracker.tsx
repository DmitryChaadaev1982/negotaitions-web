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
}: VoximplantSpeakingActivityTrackerProps) {
  const speakingRef = useRef(false);
  const endTimerRef = useRef<number | null>(null);

  const reportActivity = useCallback(
    (event: "SPEAKING_START" | "SPEAKING_END") => {
      void fetch(`/api/sessions/${sessionId}/audio-activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: event === "SPEAKING_END",
        body: JSON.stringify({
          ...roomAuthBody(roomAuth, { connectionId }),
          event,
          source: "VOXIMPLANT_MIC_ACTIVITY",
          clientTimestamp: new Date().toISOString(),
          audioLevel: Math.max(0, Math.min(100, Math.round(micLevel ?? 0))),
          telemetryCalibration: {
            speakingOnLevel: VOX_SPEAKING_ON_LEVEL,
            speakingOffLevel: VOX_SPEAKING_OFF_LEVEL,
            endDebounceMs: VOX_END_DEBOUNCE_MS,
            audioProcessingEnabled: audioProcessingEnabled ?? null,
          },
        }),
      }).catch(() => {
        // Best-effort — never surface telemetry errors to the user.
      });
    },
    [sessionId, roomAuth, connectionId, micLevel, audioProcessingEnabled],
  );

  const clearEndTimer = useCallback(() => {
    if (endTimerRef.current !== null) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearEndTimer();
      if (speakingRef.current) {
        speakingRef.current = false;
        reportActivity("SPEAKING_END");
      }
      return;
    }

    const level = muted ? 0 : micLevel ?? 0;

    if (level > VOX_SPEAKING_ON_LEVEL) {
      clearEndTimer();
      if (!speakingRef.current) {
        speakingRef.current = true;
        reportActivity("SPEAKING_START");
      }
      return;
    }

    if (
      level < VOX_SPEAKING_OFF_LEVEL &&
      speakingRef.current &&
      endTimerRef.current === null
    ) {
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        if (speakingRef.current) {
          speakingRef.current = false;
          reportActivity("SPEAKING_END");
        }
      }, VOX_END_DEBOUNCE_MS);
    }
  }, [micLevel, muted, enabled, reportActivity, clearEndTimer]);

  // Flush an open SPEAKING_END on unmount so intervals are always closed.
  useEffect(() => {
    return () => {
      clearEndTimer();
      if (speakingRef.current) {
        speakingRef.current = false;
        reportActivity("SPEAKING_END");
      }
    };
  }, [clearEndTimer, reportActivity]);

  return null;
}
