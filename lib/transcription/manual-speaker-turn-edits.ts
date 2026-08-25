export type ManualSpeakerTurnEdit = {
  id: string;
  participantId: string;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  speakerLabel: string | null;
  displaySpeakerLabel: string | null;
  speakerSlot: string | null;
};

export type SubmittedManualSpeakerTurn = {
  participantId: string;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
};

export function createManualTurnId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyManualSpeakerTurn(): ManualSpeakerTurnEdit {
  return {
    id: createManualTurnId(),
    participantId: "",
    text: "",
    startSeconds: null,
    endSeconds: null,
    speakerLabel: null,
    displaySpeakerLabel: null,
    speakerSlot: null,
  };
}

export function insertManualSpeakerTurnAfter(
  turns: ManualSpeakerTurnEdit[],
  index: number,
): ManualSpeakerTurnEdit[] {
  const next = turns.slice();
  next.splice(index + 1, 0, createEmptyManualSpeakerTurn());
  return next;
}

export function toSubmittedManualSpeakerTurns(
  turns: ManualSpeakerTurnEdit[],
): SubmittedManualSpeakerTurn[] {
  return turns
    .map((turn) => ({
      participantId: turn.participantId.trim(),
      text: turn.text.trim(),
      startSeconds: turn.startSeconds,
      endSeconds: turn.endSeconds,
    }))
    .filter((turn) => turn.text.length > 0);
}
