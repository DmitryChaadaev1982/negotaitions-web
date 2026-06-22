"use client";

import { useEffect, useState } from "react";

import { SessionStatusBadge } from "@/components/session-status-badge";
import type { SessionDisplayStatus } from "@/lib/session-display-status";

const STATUS_POLL_INTERVAL_MS = 1_000;

type SessionDisplayStatusBadgeProps = {
  sessionId: string;
  initialStatus: SessionDisplayStatus;
};

export function SessionDisplayStatusBadge({
  sessionId,
  initialStatus,
}: SessionDisplayStatusBadgeProps) {
  const [polledStatus, setPolledStatus] = useState<SessionDisplayStatus | null>(
    null,
  );
  const status = polledStatus ?? initialStatus;

  useEffect(() => {
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/display-status`,
          { cache: "no-store" },
        );

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as {
          status: SessionDisplayStatus;
        };

        if (!cancelled) {
          setPolledStatus(payload.status);
        }
      } catch {
        // Ignore transient polling errors.
      }
    };

    void pollStatus();

    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [sessionId]);

  return <SessionStatusBadge status={status} />;
}
