"use client";

import { useEffect, useState } from "react";

import {
  SESSION_NOTES_POLL_INTERVAL_MS,
  type SessionParticipantNotesSnapshot,
} from "@/lib/participant-notes-types";

function toNotesMap(participants: SessionParticipantNotesSnapshot[]) {
  return new Map(
    participants.map((participant) => [participant.id, participant]),
  );
}

export function useSessionNotesPoll(
  sessionId: string,
  initialParticipants: SessionParticipantNotesSnapshot[],
) {
  const [notesByParticipantId, setNotesByParticipantId] = useState(() =>
    toNotesMap(initialParticipants),
  );

  useEffect(() => {
    let cancelled = false;

    const fetchNotes = async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/notes`);

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          participants: SessionParticipantNotesSnapshot[];
        };

        if (!cancelled) {
          setNotesByParticipantId(toNotesMap(payload.participants));
        }
      } catch {
        // Ignore transient network errors during polling.
      }
    };

    void fetchNotes();

    const intervalId = setInterval(() => {
      void fetchNotes();
    }, SESSION_NOTES_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [sessionId]);

  return notesByParticipantId;
}
