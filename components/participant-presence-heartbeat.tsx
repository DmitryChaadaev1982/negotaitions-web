"use client";

import { useEffect } from "react";

import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/presence";

type ParticipantPresenceHeartbeatProps = {
  joinToken: string;
};

export function ParticipantPresenceHeartbeat({
  joinToken,
}: ParticipantPresenceHeartbeatProps) {
  useEffect(() => {
    let cancelled = false;

    const sendHeartbeat = async () => {
      try {
        await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ joinToken }),
          keepalive: true,
        });
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
  }, [joinToken]);

  return null;
}
