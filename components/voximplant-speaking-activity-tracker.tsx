"use client";

import { useCallback, useEffect, useRef } from "react";

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
};

// Speaking hysteresis (level 0..100). ON must be exceeded to start; the flag is
// only released below OFF, and only after END_DEBOUNCE_MS of sustained silence
// so a short pause does not split one utterance into many DB rows.
const SPEAKING_ON = 10;
const SPEAKING_OFF = 6;
const END_DEBOUNCE_MS = 800;

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
        }),
      }).catch(() => {
        // Best-effort — never surface telemetry errors to the user.
      });
    },
    [sessionId, roomAuth, connectionId],
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

    if (level > SPEAKING_ON) {
      clearEndTimer();
      if (!speakingRef.current) {
        speakingRef.current = true;
        reportActivity("SPEAKING_START");
      }
      return;
    }

    if (level < SPEAKING_OFF && speakingRef.current && endTimerRef.current === null) {
      endTimerRef.current = window.setTimeout(() => {
        endTimerRef.current = null;
        if (speakingRef.current) {
          speakingRef.current = false;
          reportActivity("SPEAKING_END");
        }
      }, END_DEBOUNCE_MS);
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
