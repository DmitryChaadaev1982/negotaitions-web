"use client";

import { useEffect } from "react";

import { LOBBY_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";
import { touchRecoveryContext } from "@/lib/rejoin/recovery-storage";

type EventLobbyPresenceProps = {
  eventId: string;
  participantToken?: string;
  hostToken?: string;
};

export function EventLobbyPresence({
  eventId,
  participantToken,
  hostToken,
}: EventLobbyPresenceProps) {
  useEffect(() => {
    let cancelled = false;

    const heartbeatUrl = `/api/events/${eventId}/heartbeat`;

    const sendHeartbeat = async () => {
      try {
        const response = await fetch(heartbeatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantToken: participantToken || undefined,
            hostToken: hostToken || undefined,
          }),
          keepalive: true,
        });

        if (response.ok) {
          touchRecoveryContext();
        }
      } catch {
        // Ignore transient network errors; the next heartbeat will retry.
      }
    };

    void sendHeartbeat();

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void sendHeartbeat();
      }
    }, LOBBY_HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void sendHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [eventId, hostToken, participantToken]);

  return null;
}
