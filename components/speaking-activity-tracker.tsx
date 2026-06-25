"use client";

import { useSpeakingParticipants } from "@livekit/components-react";
import { useEffect, useRef } from "react";

import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody } from "@/lib/room-auth";

type SpeakingActivityTrackerProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  /** Offset in seconds from negotiation start (for mic-activity overlap mapping). */
  negotiationStartedAt: Date | null;
};

/**
 * Invisible component that tracks LiveKit speaking events and reports
 * them to the audio-activity API for later speaker-participant overlap mapping.
 *
 * Only the local participant's identity is reported (we observe others via
 * useSpeakingParticipants but only log our own activity to avoid false attribution
 * from remote participants who may share a device).
 *
 * The component is mounted inside a LiveKitRoom context.
 */
export function SpeakingActivityTracker({
  sessionId,
  roomAuth,
  negotiationStartedAt,
}: SpeakingActivityTrackerProps) {
  const speakingParticipants = useSpeakingParticipants();
  const isSpeakingRef = useRef(false);

  function getOffsetSeconds(): number | undefined {
    if (!negotiationStartedAt) return undefined;
    return (Date.now() - negotiationStartedAt.getTime()) / 1000;
  }

  async function reportActivity(event: "SPEAKING_START" | "SPEAKING_END") {
    const offset = getOffsetSeconds();
    try {
      await fetch(`/api/sessions/${sessionId}/audio-activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...roomAuthBody(roomAuth),
          event,
          clientTimestamp: new Date().toISOString(),
          offsetSeconds: offset,
        }),
      });
    } catch {
      // Best-effort — do not surface errors to the user
    }
  }

  useEffect(() => {
    const amISpeaking = speakingParticipants.some((p) => p.isLocal);

    if (amISpeaking && !isSpeakingRef.current) {
      isSpeakingRef.current = true;
      void reportActivity("SPEAKING_START");
    } else if (!amISpeaking && isSpeakingRef.current) {
      isSpeakingRef.current = false;
      void reportActivity("SPEAKING_END");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakingParticipants]);

  // Report speaking end on unmount if still speaking
  useEffect(() => {
    return () => {
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false;
        void reportActivity("SPEAKING_END");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
