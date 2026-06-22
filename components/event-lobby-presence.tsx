"use client";

import { useEffect } from "react";

import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

type EventLobbyPresenceProps = {
  eventId: string;
  participantToken: string;
};

export function EventLobbyPresence({
  eventId,
  participantToken,
}: EventLobbyPresenceProps) {
  useEffect(() => {
    let cancelled = false;

    const heartbeatUrl = `/api/events/${eventId}/presence/heartbeat`;
    const leaveUrl = `/api/events/${eventId}/presence/leave`;

    const sendHeartbeat = async () => {
      try {
        await fetch(heartbeatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantToken }),
          keepalive: true,
        });
      } catch {
        // Ignore transient network errors; the next heartbeat will retry.
      }
    };

    const sendLeave = () => {
      const payload = JSON.stringify({ participantToken });

      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          leaveUrl,
          new Blob([payload], { type: "application/json" }),
        );
        return;
      }

      void fetch(leaveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    };

    void sendHeartbeat();

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void sendHeartbeat();
      }
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void sendHeartbeat();
      }
    };

    const handlePageHide = () => {
      sendLeave();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [eventId, participantToken]);

  return null;
}
