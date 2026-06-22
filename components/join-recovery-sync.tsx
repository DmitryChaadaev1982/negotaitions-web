"use client";

import { useEffect } from "react";

import { saveRecoveryContext, touchRecoveryContext } from "@/lib/rejoin/recovery-storage";

type JoinRecoverySyncProps = {
  joinToken: string;
  sessionId: string;
  displayName: string;
  eventId?: string | null;
};

export function JoinRecoverySync({
  joinToken,
  sessionId,
  displayName,
  eventId,
}: JoinRecoverySyncProps) {
  useEffect(() => {
    saveRecoveryContext({
      type: "SESSION_JOIN",
      eventId: eventId ?? undefined,
      sessionId,
      joinToken,
      displayName,
    });

    const intervalId = window.setInterval(() => {
      touchRecoveryContext();
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, [displayName, eventId, joinToken, sessionId]);

  return null;
}
