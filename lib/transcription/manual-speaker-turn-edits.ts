export type ManualSpeakerTurnEdit = {
  id: string;
  sourceSegmentId: string | null;
  participantId: string;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  speakerLabel: string | null;
  displaySpeakerLabel: string | null;
  speakerSlot: string | null;
};

export type SubmittedManualSpeakerTurn = {
  id?: string;
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
    sourceSegmentId: null,
    participantId: "",
    text: "",
    startSeconds: null,
    endSeconds: null,
    speakerLabel: null,
    displaySpeakerLabel: null,
    speakerSlot: null,
  };
}

export function toManualSpeakerTurnFromPersistedSegment(segment: {
  id: string;
  mappedParticipantId?: string | null;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  speakerLabel: string | null;
  displaySpeakerLabel?: string | null;
}): ManualSpeakerTurnEdit {
  return {
    id: segment.id,
    sourceSegmentId: segment.id,
    participantId: segment.mappedParticipantId ?? "",
    text: segment.text,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    speakerLabel: segment.speakerLabel,
    displaySpeakerLabel: segment.displaySpeakerLabel ?? segment.speakerLabel,
    speakerSlot: segment.speakerLabel ?? null,
  };
}

export function buildInitialManualTurnsFromPersistedSegments(
  segments: ReadonlyArray<{
    id: string;
    mappedParticipantId?: string | null;
    text: string;
    startSeconds: number | null;
    endSeconds: number | null;
    speakerLabel: string | null;
    displaySpeakerLabel?: string | null;
    orderIndex?: number;
  }>,
): ManualSpeakerTurnEdit[] {
  const ordered = [...segments].sort((left, right) => {
    if (
      typeof left.orderIndex === "number" &&
      typeof right.orderIndex === "number" &&
      left.orderIndex !== right.orderIndex
    ) {
      return left.orderIndex - right.orderIndex;
    }
    return 0;
  });
  if (ordered.length === 0) {
    return [createEmptyManualSpeakerTurn()];
  }
  return ordered.map((segment) => toManualSpeakerTurnFromPersistedSegment(segment));
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
    .map((turn) => {
      const sourceSegmentId = turn.sourceSegmentId?.trim();
      return {
        ...(sourceSegmentId ? { id: sourceSegmentId } : {}),
        participantId: turn.participantId.trim(),
        text: turn.text,
        startSeconds: turn.startSeconds,
        endSeconds: turn.endSeconds,
      };
    })
    .filter((turn) => turn.text.trim().length > 0 || Boolean(turn.id));
}
