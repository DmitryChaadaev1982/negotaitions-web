import type {
  EventParticipant,
  SessionParticipant,
  TrainingEvent,
} from "@/app/generated/prisma/client";
import { getDemoFacilitator } from "@/lib/demo-user";
import {
  parseAssignmentDraft,
  type EventAssignmentDraft,
} from "@/lib/event-assignment";
import { toPublicCaseSummary, type PublicCaseSummary } from "@/lib/event-case-public";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { resolveConnectionStatus } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import { activeCaseWhere } from "@/lib/soft-delete";

export type EventStateParticipant = {
  id: string;
  displayName: string;
  email: string | null;
  isHost: boolean;
  preference: string;
  wantsToPlay: boolean;
  wantsToObserve: boolean;
  wantsToFacilitate: boolean;
  joinedAt: string | null;
  lastSeenAt: string | null;
  connectionStatus: "ONLINE" | "RECENTLY_DISCONNECTED" | "OFFLINE";
  assignedSessionId: string | null;
  assignedSessionParticipantId: string | null;
  assignedType: string | null;
  assignedRoleName: string | null;
  joinToken: string | null;
};

export type EventStateResponse = {
  event: {
    id: string;
    title: string;
    description: string | null;
    scheduledAt: string | null;
    status: string;
    estimatedEventDurationSeconds: number | null;
    estimatedEventDurationMinutes: number | null;
    lobbyRoomName: string | null;
    publicJoinCode: string;
  };
  currentParticipant: {
    id: string;
    displayName: string;
    preference: string;
  } | null;
  isHost: boolean;
  participants: EventStateParticipant[];
  selectedCase: PublicCaseSummary | null;
  availableCases: PublicCaseSummary[];
  assignmentDraft: EventAssignmentDraft;
  createdSession: {
    id: string;
    title: string;
  } | null;
};

type BuildEventStateInput = {
  event: TrainingEvent;
  isHost: boolean;
  currentParticipant: EventParticipant | null;
};

function getAssignmentDurationDefaults(
  selectedCase: {
    defaultPreparationDurationSeconds: number;
    defaultDurationSeconds: number;
  } | null,
) {
  if (selectedCase) {
    return {
      preparationDurationMinutes: secondsToDisplayMinutes(
        selectedCase.defaultPreparationDurationSeconds,
      ),
      negotiationDurationMinutes: secondsToDisplayMinutes(
        selectedCase.defaultDurationSeconds,
      ),
    };
  }

  return {
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };
}

export async function buildEventState(
  input: BuildEventStateInput,
): Promise<EventStateResponse> {
  const facilitator = await getDemoFacilitator();

  const [participants, cases, selectedCaseRecord, createdSession] =
    await Promise.all([
      prisma.eventParticipant.findMany({
        where: { eventId: input.event.id },
        orderBy: { createdAt: "asc" },
        include: {
          assignedSessionParticipant: {
            include: {
              sessionRole: { select: { name: true } },
            },
          },
        },
      }),
      prisma.negotiationCase.findMany({
        where: {
          facilitatorId: facilitator.id,
          ...activeCaseWhere,
        },
        include: {
          roles: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true, sortOrder: true },
          },
        },
        orderBy: { title: "asc" },
      }),
      input.event.selectedCaseId
        ? prisma.negotiationCase.findFirst({
            where: {
              id: input.event.selectedCaseId,
              facilitatorId: facilitator.id,
              ...activeCaseWhere,
            },
            include: {
              roles: {
                orderBy: { sortOrder: "asc" },
                select: { id: true, name: true, sortOrder: true },
              },
            },
          })
        : Promise.resolve(null),
      prisma.session.findFirst({
        where: { eventId: input.event.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true },
      }),
    ]);

  const assignmentDraft = parseAssignmentDraft(
    input.event.assignmentDraft,
    getAssignmentDurationDefaults(selectedCaseRecord),
  );

  return {
    event: {
      id: input.event.id,
      title: input.event.title,
      description: input.event.description,
      scheduledAt: input.event.scheduledAt?.toISOString() ?? null,
      status: input.event.status,
      estimatedEventDurationSeconds: input.event.estimatedEventDurationSeconds,
      estimatedEventDurationMinutes: input.event.estimatedEventDurationSeconds
        ? secondsToDisplayMinutes(input.event.estimatedEventDurationSeconds)
        : null,
      lobbyRoomName: input.event.lobbyRoomName,
      publicJoinCode: input.event.publicJoinCode,
    },
    currentParticipant: input.currentParticipant
      ? {
          id: input.currentParticipant.id,
          displayName: input.currentParticipant.displayName,
          preference: input.currentParticipant.preference,
        }
      : null,
    isHost: input.isHost,
    participants: participants.map(mapEventParticipant),
    selectedCase: selectedCaseRecord
      ? toPublicCaseSummary(selectedCaseRecord)
      : null,
    availableCases: cases.map(toPublicCaseSummary),
    assignmentDraft,
    createdSession: createdSession
      ? { id: createdSession.id, title: createdSession.title }
      : null,
  };
}

function mapEventParticipant(
  participant: EventParticipant & {
    assignedSessionParticipant:
      | (SessionParticipant & {
          sessionRole: { name: string } | null;
        })
      | null;
  },
): EventStateParticipant {
  const assigned = participant.assignedSessionParticipant;

  return {
    id: participant.id,
    displayName: participant.displayName,
    email: participant.email,
    isHost: participant.isHost,
    preference: participant.preference,
    wantsToPlay: participant.wantsToPlay,
    wantsToObserve: participant.wantsToObserve,
    wantsToFacilitate: participant.wantsToFacilitate,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    connectionStatus: resolveConnectionStatus(participant.lastSeenAt),
    assignedSessionId: participant.assignedSessionId,
    assignedSessionParticipantId: participant.assignedSessionParticipantId,
    assignedType: assigned?.type ?? null,
    assignedRoleName: assigned?.sessionRole?.name ?? null,
    joinToken: assigned?.joinToken ?? null,
  };
}
