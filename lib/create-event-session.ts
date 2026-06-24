import {
  ParticipantType,
  SessionStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import { isAssignableCaseRole } from "@/lib/case-roles";
import {
  ACTIVE_SESSION_ASSIGNMENT_SESSION_WHERE,
} from "@/lib/event-active-assignment";
import { getDemoFacilitator } from "@/lib/demo-user";
import type { EventAssignmentDraft } from "@/lib/event-assignment";
import { generateJoinToken } from "@/lib/join-token";
import { minutesToSeconds } from "@/lib/negotiation-duration";
import { prisma } from "@/lib/prisma";
import { resolvePrepStatus } from "@/lib/session-display-status";
import { mapCaseRolesToSessionRoleCreate } from "@/lib/session-role";
import { activeCaseWhere } from "@/lib/soft-delete";

export type CreateEventSessionResult =
  | {
      ok: true;
      sessionId: string;
      sessionTitle: string;
      roomLabel: string;
      participants: Array<{
        eventParticipantId: string;
        sessionParticipantId: string;
        joinToken: string;
        type: ParticipantType;
        displayName: string;
      }>;
    }
  | {
      ok: false;
      error: string;
      participantName?: string;
    };

export type CreateEventSessionInput = {
  caseId?: string;
  roomLabel?: string;
  preparationDurationSeconds?: number;
  negotiationDurationSeconds?: number;
  facilitatorEventParticipantId: string | null;
  roleAssignments: Array<{
    caseRoleId: string;
    eventParticipantId: string;
  }>;
  observerEventParticipantIds: string[];
};

function inputFromDraft(
  eventSelectedCaseId: string | null,
  assignmentDraft: EventAssignmentDraft,
): CreateEventSessionInput {
  return {
    caseId: eventSelectedCaseId ?? undefined,
    roomLabel: assignmentDraft.roomLabel,
    preparationDurationSeconds: minutesToSeconds(
      assignmentDraft.preparationDurationMinutes,
    ),
    negotiationDurationSeconds: minutesToSeconds(
      assignmentDraft.negotiationDurationMinutes,
    ),
    facilitatorEventParticipantId: assignmentDraft.facilitatorEventParticipantId,
    roleAssignments: Object.entries(assignmentDraft.roleAssignments).map(
      ([caseRoleId, eventParticipantId]) => ({
        caseRoleId,
        eventParticipantId,
      }),
    ),
    observerEventParticipantIds: assignmentDraft.observerEventParticipantIds,
  };
}

function isCreateEventSessionInput(
  input: CreateEventSessionInput | EventAssignmentDraft,
): input is CreateEventSessionInput {
  return Array.isArray(input.roleAssignments);
}

export async function createSessionFromEvent(
  eventId: string,
  inputOrDraft: CreateEventSessionInput | EventAssignmentDraft,
): Promise<CreateEventSessionResult> {
  const facilitator = await getDemoFacilitator();

  const event = await prisma.trainingEvent.findFirst({
    where: {
      id: eventId,
      deletedAt: null,
      status: { in: [TrainingEventStatus.LOBBY_OPEN, TrainingEventStatus.DRAFT, TrainingEventStatus.SESSION_CREATED] },
    },
    include: {
      participants: true,
    },
  });

  if (!event) {
    return { ok: false, error: "eventNotFound" };
  }

  const input = isCreateEventSessionInput(inputOrDraft)
    ? inputOrDraft
    : inputFromDraft(event.selectedCaseId, inputOrDraft);

  const caseId = input.caseId ?? event.selectedCaseId;

  if (!caseId) {
    return { ok: false, error: "caseNotSelected" };
  }

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id: caseId,
      facilitatorId: facilitator.id,
      ...activeCaseWhere,
    },
    include: {
      roles: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!negotiationCase) {
    return { ok: false, error: "caseNotFound" };
  }

  const assignableRoles = negotiationCase.roles.filter((role) =>
    isAssignableCaseRole(role.name),
  );

  if (!input.facilitatorEventParticipantId) {
    return { ok: false, error: "facilitatorRequired" };
  }

  const facilitatorParticipant = event.participants.find(
    (participant) =>
      participant.id === input.facilitatorEventParticipantId,
  );

  if (!facilitatorParticipant) {
    return { ok: false, error: "facilitatorInvalid" };
  }

  const assignedRolePlayerIds = new Set<string>();
  const roleAssignments: Array<{
    caseRoleId: string;
    caseRoleName: string;
    eventParticipantId: string;
  }> = [];
  const inputRoleAssignments = new Map(
    input.roleAssignments.map((assignment) => [
      assignment.caseRoleId,
      assignment.eventParticipantId,
    ]),
  );

  for (const caseRole of assignableRoles) {
    const eventParticipantId = inputRoleAssignments.get(caseRole.id);

    if (!eventParticipantId) {
      return { ok: false, error: "rolesIncomplete" };
    }

    if (assignedRolePlayerIds.has(eventParticipantId)) {
      return { ok: false, error: "duplicateRoleAssignment" };
    }

    const eventParticipant = event.participants.find(
      (participant) => participant.id === eventParticipantId,
    );

    if (!eventParticipant) {
      return { ok: false, error: "roleAssignmentInvalid" };
    }

    assignedRolePlayerIds.add(eventParticipantId);
    roleAssignments.push({
      caseRoleId: caseRole.id,
      caseRoleName: caseRole.name,
      eventParticipantId,
    });
  }

  const eventParticipantIds = new Set(
    event.participants.map((participant) => participant.id),
  );
  const observerIds: string[] = [];

  for (const observerId of input.observerEventParticipantIds) {
    if (!eventParticipantIds.has(observerId)) {
      return { ok: false, error: "observerInvalid" };
    }

    if (assignedRolePlayerIds.has(observerId)) {
      return { ok: false, error: "participantObserverConflict" };
    }

    if (observerId === input.facilitatorEventParticipantId) {
      return { ok: false, error: "facilitatorObserverConflict" };
    }

    if (!observerIds.includes(observerId)) {
      observerIds.push(observerId);
    }
  }

  const activeAssignmentIds = [
    input.facilitatorEventParticipantId,
    ...roleAssignments.map((assignment) => assignment.eventParticipantId),
    ...observerIds,
  ].filter((id): id is string => typeof id === "string");
  const activeAssignments = await prisma.sessionParticipant.findMany({
    where: {
      eventParticipantId: { in: activeAssignmentIds },
      session: {
        eventId: event.id,
        ...ACTIVE_SESSION_ASSIGNMENT_SESSION_WHERE,
      },
    },
    include: {
      eventParticipant: {
        select: { displayName: true },
      },
    },
  });

  if (activeAssignments.length > 0) {
    return {
      ok: false,
      error: "participantAlreadyAssigned",
      participantName:
        activeAssignments[0]?.eventParticipant?.displayName ??
        activeAssignments[0]?.displayName,
    };
  }

  const sessionTitle = `${event.title} — ${negotiationCase.title}`;

  const session = await prisma.$transaction(async (tx) => {
    const sequence = await tx.session.aggregate({
      where: { eventId: event.id },
      _max: { sequenceNumber: true },
    });
    const sequenceNumber = (sequence._max.sequenceNumber ?? 0) + 1;
    const roomLabel = input.roomLabel?.trim() || `Room ${sequenceNumber}`;
    const createdFromEventAt = new Date();
    const createdSessionParticipants: Array<{
      eventParticipantId: string;
      sessionParticipantId: string;
      joinToken: string;
      type: ParticipantType;
      displayName: string;
    }> = [];

    const createdSession = await tx.session.create({
      data: {
        title: sessionTitle,
        roomLabel,
        sequenceNumber,
        createdFromEventAt,
        negotiationCaseId: negotiationCase.id,
        facilitatorId: facilitator.id,
        eventId: event.id,
        status: SessionStatus.DRAFT,
        preparationDurationSeconds:
          input.preparationDurationSeconds ??
          negotiationCase.defaultPreparationDurationSeconds,
        durationSeconds:
          input.negotiationDurationSeconds ??
          negotiationCase.defaultDurationSeconds,
        snapshotCaseTitle: negotiationCase.title,
        snapshotBusinessContext: negotiationCase.businessContext,
        snapshotPublicInstructions: negotiationCase.publicInstructions,
        snapshotCaseLanguage: negotiationCase.caseLanguage,
        sessionRoles: {
          create: mapCaseRolesToSessionRoleCreate(negotiationCase.roles),
        },
      },
      include: {
        sessionRoles: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const sessionRoleByName = new Map(
      createdSession.sessionRoles.map((role) => [role.name, role]),
    );

    const facilitatorSessionParticipant = await tx.sessionParticipant.create({
      data: {
        sessionId: createdSession.id,
        displayName: facilitatorParticipant.displayName,
        type: ParticipantType.FACILITATOR,
        joinToken: generateJoinToken(),
        eventParticipantId: facilitatorParticipant.id,
      },
    });
    createdSessionParticipants.push({
      eventParticipantId: facilitatorParticipant.id,
      sessionParticipantId: facilitatorSessionParticipant.id,
      joinToken: facilitatorSessionParticipant.joinToken,
      type: facilitatorSessionParticipant.type,
      displayName: facilitatorSessionParticipant.displayName,
    });

    await tx.eventParticipant.update({
      where: { id: facilitatorParticipant.id },
      data: {
        assignedSessionId: createdSession.id,
        assignedSessionParticipantId: facilitatorSessionParticipant.id,
      },
    });

    for (const assignment of roleAssignments) {
      const sessionRole = sessionRoleByName.get(assignment.caseRoleName);

      if (!sessionRole) {
        throw new Error("Session role snapshot missing.");
      }

      const eventParticipant = event.participants.find(
        (participant) => participant.id === assignment.eventParticipantId,
      );

      if (!eventParticipant) {
        throw new Error("Event participant missing.");
      }

      const sessionParticipant = await tx.sessionParticipant.create({
        data: {
          sessionId: createdSession.id,
          displayName: eventParticipant.displayName,
          type: ParticipantType.PARTICIPANT,
          sessionRoleId: sessionRole.id,
          joinToken: generateJoinToken(),
          eventParticipantId: eventParticipant.id,
        },
      });
      createdSessionParticipants.push({
        eventParticipantId: eventParticipant.id,
        sessionParticipantId: sessionParticipant.id,
        joinToken: sessionParticipant.joinToken,
        type: sessionParticipant.type,
        displayName: sessionParticipant.displayName,
      });

      await tx.eventParticipant.update({
        where: { id: eventParticipant.id },
        data: {
          assignedSessionId: createdSession.id,
          assignedSessionParticipantId: sessionParticipant.id,
        },
      });
    }

    for (const observerId of observerIds) {
      const eventParticipant = event.participants.find(
        (participant) => participant.id === observerId,
      );

      if (!eventParticipant) {
        continue;
      }

      const sessionParticipant = await tx.sessionParticipant.create({
        data: {
          sessionId: createdSession.id,
          displayName: eventParticipant.displayName,
          type: ParticipantType.OBSERVER,
          joinToken: generateJoinToken(),
          eventParticipantId: eventParticipant.id,
        },
      });
      createdSessionParticipants.push({
        eventParticipantId: eventParticipant.id,
        sessionParticipantId: sessionParticipant.id,
        joinToken: sessionParticipant.joinToken,
        type: sessionParticipant.type,
        displayName: sessionParticipant.displayName,
      });

      await tx.eventParticipant.update({
        where: { id: eventParticipant.id },
        data: {
          assignedSessionId: createdSession.id,
          assignedSessionParticipantId: sessionParticipant.id,
        },
      });
    }

    const allParticipants = await tx.sessionParticipant.findMany({
      where: { sessionId: createdSession.id },
      select: { type: true },
    });

    await tx.session.update({
      where: { id: createdSession.id },
      data: { status: resolvePrepStatus(allParticipants) },
    });

    await tx.trainingEvent.update({
      where: { id: event.id },
      data: { status: TrainingEventStatus.SESSION_CREATED },
    });

    return {
      ...createdSession,
      roomLabel,
      createdSessionParticipants,
    };
  });

  return {
    ok: true,
    sessionId: session.id,
    sessionTitle: session.title,
    roomLabel: session.roomLabel,
    participants: session.createdSessionParticipants,
  };
}
