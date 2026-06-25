"use client";

import { useEffect } from "react";

import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody } from "@/lib/room-auth";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

type SessionRoomPresenceHeartbeatProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  onInvalidToken?: () => void;
};

export function SessionRoomPresenceHeartbeat({
  sessionId,
  roomAuth,
  onInvalidToken,
}: SessionRoomPresenceHeartbeatProps) {
  useEffect(() => {
    let cancelled = false;

    const heartbeatUrl = `/api/sessions/${sessionId}/heartbeat`;

    const sendHeartbeat = async () => {
      try {
        const response = await fetch(heartbeatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomAuthBody(roomAuth)),
          keepalive: true,
        });

        if (response.status === 403 && !cancelled) {
          onInvalidToken?.();
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
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

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
  }, [roomAuth, onInvalidToken, sessionId]);

  return null;
}
