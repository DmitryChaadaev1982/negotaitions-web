"use client";

import { useEffect, useRef } from "react";

import { startVisibleListPoll } from "@/lib/list-overview-polling";

export function useVisibleListPoll(
  refresh: (signal: AbortSignal) => Promise<void>,
) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const poll = startVisibleListPoll({
      refresh: (signal) => refreshRef.current(signal),
    });
    return poll.stop;
  }, []);
}
