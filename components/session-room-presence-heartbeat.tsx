"use client";

import { useEffect } from "react";

import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody } from "@/lib/room-auth";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

type SessionRoomPresenceHeartbeatProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  connectionId?: string;
  enabled?: boolean;
  onInvalidToken?: () => void;
  onStaleConnection?: () => void;
};

export function createHeartbeatStaleGate(onStaleConnection?: () => void) {
  let stale = false;
  return {
    isStale() {
      return stale;
    },
    markStale() {
      if (stale) return false;
      stale = true;
      onStaleConnection?.();
      return true;
    },
  };
}

export function SessionRoomPresenceHeartbeat({
  sessionId,
  roomAuth,
  connectionId,
  enabled = true,
  onInvalidToken,
  onStaleConnection,
}: SessionRoomPresenceHeartbeatProps) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const staleGate = createHeartbeatStaleGate(onStaleConnection);
    let intervalId: number | null = null;
    let handleVisibilityChange: () => void = () => undefined;

    const stopLoop = () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };

    const heartbeatUrl = `/api/sessions/${sessionId}/heartbeat`;

    const sendHeartbeat = async () => {
      try {
        const response = await fetch(heartbeatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomAuthBody(roomAuth, { connectionId })),
          keepalive: true,
        });

        if (response.status === 403 && !cancelled) {
          onInvalidToken?.();
          return;
        }
        if (response.status === 409 && !cancelled) {
          if (staleGate.markStale()) {
            stopLoop();
          }
        }
      } catch {
        // Ignore transient network errors; the next heartbeat will retry.
      }
    };

    void sendHeartbeat();

    intervalId = window.setInterval(() => {
      if (!cancelled && !staleGate.isStale()) {
        void sendHeartbeat();
      }
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);

    handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelled && !staleGate.isStale()) {
        void sendHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopLoop();
    };
  }, [connectionId, enabled, roomAuth, onInvalidToken, onStaleConnection, sessionId]);

  return null;
}
