import { ParticipantType } from "@/app/generated/prisma/client";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";
import {
  type ParticipantNoteEntry,
  type SessionParticipantNotesSnapshot,
  toParticipantNoteEntries,
} from "@/lib/participant-notes-types";

export type { ParticipantNoteEntry, SessionParticipantNotesSnapshot };
export {
  getParticipantNotesCount,
  SESSION_NOTES_POLL_INTERVAL_MS,
  toParticipantNoteEntries,
} from "@/lib/participant-notes-types";

export type ParticipantNotesPayload = {
  participant: {
    id: string;
    displayName: string;
    type: ParticipantType;
    roleName: string | null;
  };
  notes: ParticipantNoteEntry[];
  notesCount: number;
};

type ParticipantNotesAccessResult =
  | { ok: true; data: ParticipantNotesPayload }
  | { ok: false; status: 403 | 404 };

async function loadTargetParticipant(
  sessionId: string,
  participantId: string,
) {
  return prisma.sessionParticipant.findFirst({
    where: {
      id: participantId,
      sessionId,
    },
    select: {
      id: true,
      displayName: true,
      type: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      sessionRole: {
        select: {
          name: true,
        },
      },
    },
  });
}

function toPayload(
  participant: NonNullable<Awaited<ReturnType<typeof loadTargetParticipant>>>,
): ParticipantNotesPayload {
  const notes = toParticipantNoteEntries(participant);

  return {
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      type: participant.type,
      roleName: participant.sessionRole?.name ?? null,
    },
    notes,
    notesCount: notes.length,
  };
}

/**
 * Phase 1 auth-gated version for individual participant notes.
 * Caller must have already verified active user auth.
 * TODO: Add ownership check once Session.facilitatorId is user-bound (Phase C).
 */
export async function getParticipantNotesForActiveUser(
  sessionId: string,
  participantId: string,
): Promise<ParticipantNotesAccessResult> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    return { ok: false, status: 404 };
  }

  const participant = await loadTargetParticipant(sessionId, participantId);

  if (!participant) {
    return { ok: false, status: 404 };
  }

  return { ok: true, data: toPayload(participant) };
}

export async function getParticipantNotesForFacilitator(
  sessionId: string,
  participantId: string,
): Promise<ParticipantNotesAccessResult> {
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      facilitatorId: facilitator.id,
    },
    select: { id: true },
  });

  if (!session) {
    return { ok: false, status: 404 };
  }

  const participant = await loadTargetParticipant(sessionId, participantId);

  if (!participant) {
    return { ok: false, status: 404 };
  }

  return { ok: true, data: toPayload(participant) };
}

/**
 * Phase 1 auth-gated version: caller must have already verified active user
 * auth. Does not filter by facilitatorId until user binding is implemented (Phase C).
 * TODO: Add user binding once Session.facilitatorId is linked to real User.id.
 */
export async function getSessionParticipantsNotesForFacilitatorByUserId(
  sessionId: string,
): Promise<
  | { ok: true; data: SessionParticipantNotesSnapshot[] }
  | { ok: false; status: 404 }
> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    return { ok: false, status: 404 };
  }

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: {
      id: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    ok: true,
    data: participants.map((participant) => {
      const notes = toParticipantNoteEntries(participant);

      return {
        id: participant.id,
        notesCount: notes.length,
        notes,
      };
    }),
  };
}

export async function getSessionParticipantsNotesForFacilitator(
  sessionId: string,
): Promise<
  | { ok: true; data: SessionParticipantNotesSnapshot[] }
  | { ok: false; status: 404 }
> {
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      facilitatorId: facilitator.id,
    },
    select: { id: true },
  });

  if (!session) {
    return { ok: false, status: 404 };
  }

  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: {
      id: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    ok: true,
    data: participants.map((participant) => {
      const notes = toParticipantNoteEntries(participant);

      return {
        id: participant.id,
        notesCount: notes.length,
        notes,
      };
    }),
  };
}

export async function getParticipantNotesWithJoinToken(
  sessionId: string,
  participantId: string,
  joinToken: string,
): Promise<ParticipantNotesAccessResult> {
  const requester = await prisma.sessionParticipant.findUnique({
    where: { joinToken },
    select: {
      id: true,
      sessionId: true,
      type: true,
    },
  });

  if (!requester || requester.sessionId !== sessionId) {
    return { ok: false, status: 404 };
  }

  const isSelf = requester.id === participantId;
  const isFacilitator =
    requester.type === ParticipantType.FACILITATOR && !isSelf;

  if (!isSelf && !isFacilitator) {
    return { ok: false, status: 403 };
  }

  const participant = await loadTargetParticipant(sessionId, participantId);

  if (!participant) {
    return { ok: false, status: 404 };
  }

  return { ok: true, data: toPayload(participant) };
}
