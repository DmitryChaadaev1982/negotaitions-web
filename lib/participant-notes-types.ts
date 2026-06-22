export type ParticipantNoteEntry = {
  text: string;
  createdAt: string;
  updatedAt: string;
  timestampSeconds: number | null;
  category: string | null;
};

export type SessionParticipantNotesSnapshot = {
  id: string;
  notesCount: number;
  notes: ParticipantNoteEntry[];
};

export const SESSION_NOTES_POLL_INTERVAL_MS = 1_000;

export function getParticipantNotesCount(notes: string): number {
  return notes.trim().length > 0 ? 1 : 0;
}

export function toParticipantNoteEntries(participant: {
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}): ParticipantNoteEntry[] {
  if (participant.notes.trim().length === 0) {
    return [];
  }

  return [
    {
      text: participant.notes,
      createdAt: participant.createdAt.toISOString(),
      updatedAt: participant.updatedAt.toISOString(),
      timestampSeconds: null,
      category: null,
    },
  ];
}
