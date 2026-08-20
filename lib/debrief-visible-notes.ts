import { ParticipantType, type RoomLifecycle } from "@/app/generated/prisma/client";

export type DebriefVisibleNoteRole =
  | "PARTICIPANT_A"
  | "PARTICIPANT_B"
  | "PARTICIPANT"
  | "OBSERVER"
  | "FACILITATOR";

export type DebriefVisibleNote = {
  participantId: string;
  ownerKey: string;
  displayName: string;
  participantType: ParticipantType;
  roleName: string | null;
  roleLabel: DebriefVisibleNoteRole;
  notes: string;
  updatedAt: string;
};

export type DebriefVisibleNotesParticipant = {
  id: string;
  userId: string | null;
  displayName: string;
  type: ParticipantType;
  notes: string;
  updatedAt: Date;
  sessionRole: {
    name: string;
    sortOrder: number;
  } | null;
};

export function isPostNegotiationParticipantNotesRevealState(input: {
  roomLifecycle?: RoomLifecycle | null;
  negotiationState?: string | null;
}): boolean {
  return (
    input.negotiationState === "FINISHED" ||
    input.roomLifecycle === "DEBRIEF_OPEN"
  );
}

export function resolveDebriefVisibleNotes({
  roomLifecycle,
  negotiationState,
  viewerParticipantId,
  viewerType,
  participants,
}: {
  roomLifecycle: RoomLifecycle | null;
  negotiationState?: string | null;
  viewerParticipantId: string;
  viewerType: ParticipantType;
  participants: DebriefVisibleNotesParticipant[];
}): DebriefVisibleNote[] {
  if (
    !isPostNegotiationParticipantNotesRevealState({
      roomLifecycle,
      negotiationState,
    })
  ) {
    return [];
  }

  const participantNotes = participants
    .filter((participant) => participant.type === ParticipantType.PARTICIPANT)
    .sort((a, b) => {
      const sortA = a.sessionRole?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const sortB = b.sessionRole?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (sortA !== sortB) return sortA - sortB;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
    });

  const viewer = participants.find((participant) => participant.id === viewerParticipantId) ?? null;
  const canSeeParticipantNotes =
    viewerType === ParticipantType.OBSERVER || viewerType === ParticipantType.FACILITATOR;
  const orderedCandidates = canSeeParticipantNotes
    ? [...participantNotes, ...(viewer ? [viewer] : [])]
    : viewer
      ? [viewer]
      : [];

  const seenOwners = new Set<string>();
  const result: DebriefVisibleNote[] = [];

  for (const participant of orderedCandidates) {
    const notes = participant.notes.trim();
    if (!notes) continue;

    const ownerKey = participant.userId
      ? `user:${participant.userId}`
      : `participant:${participant.id}`;
    if (seenOwners.has(ownerKey)) continue;
    seenOwners.add(ownerKey);

    const participantIndex = participantNotes.findIndex(
      (candidate) => candidate.id === participant.id,
    );
    const roleLabel: DebriefVisibleNoteRole =
      participant.type === ParticipantType.PARTICIPANT
        ? participantIndex === 0
          ? "PARTICIPANT_A"
          : participantIndex === 1
            ? "PARTICIPANT_B"
            : "PARTICIPANT"
        : participant.type;

    result.push({
      participantId: participant.id,
      ownerKey,
      displayName: participant.displayName,
      participantType: participant.type,
      roleName: participant.sessionRole?.name ?? null,
      roleLabel,
      notes,
      updatedAt: participant.updatedAt.toISOString(),
    });
  }

  return result;
}

export function projectPostNegotiationParticipantPreparationNotes(
  notes: DebriefVisibleNote[],
): Array<{
  participantId: string;
  displayName: string;
  roleName: string | null;
  notes: string;
}> {
  return notes
    .filter((note) => note.participantType === ParticipantType.PARTICIPANT)
    .map((note) => ({
      participantId: note.participantId,
      displayName: note.displayName,
      roleName: note.roleName,
      notes: note.notes,
    }));
}
