import {
  ParticipantType,
  SessionStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import { isAssignableCaseRole } from "@/lib/case-roles";
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
    }
  | {
      ok: false;
      error: string;
    };

export async function createSessionFromEvent(
  eventId: string,
  assignmentDraft: EventAssignmentDraft,
): Promise<CreateEventSessionResult> {
  const facilitator = await getDemoFacilitator();

  const event = await prisma.trainingEvent.findFirst({
    where: {
      id: eventId,
      deletedAt: null,
      status: { in: [TrainingEventStatus.LOBBY_OPEN, TrainingEventStatus.DRAFT] },
    },
    include: {
      participants: true,
    },
  });

  if (!event) {
    return { ok: false, error: "eventNotFound" };
  }

  if (!event.selectedCaseId) {
    return { ok: false, error: "caseNotSelected" };
  }

  const negotiationCase = await prisma.negotiationCase.findFirst({
    where: {
      id: event.selectedCaseId,
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

  if (!assignmentDraft.facilitatorEventParticipantId) {
    return { ok: false, error: "facilitatorRequired" };
  }

  const facilitatorParticipant = event.participants.find(
    (participant) =>
      participant.id === assignmentDraft.facilitatorEventParticipantId,
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

  for (const caseRole of assignableRoles) {
    const eventParticipantId = assignmentDraft.roleAssignments[caseRole.id];

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

  const observerIds = assignmentDraft.observerEventParticipantIds.filter(
    (id) => {
      if (id === assignmentDraft.facilitatorEventParticipantId) return false;
      if (assignedRolePlayerIds.has(id)) return false;
      return event.participants.some((participant) => participant.id === id);
    },
  );

  const sessionTitle = `${event.title} — ${negotiationCase.title}`;

  const session = await prisma.$transaction(async (tx) => {
    const createdSession = await tx.session.create({
      data: {
        title: sessionTitle,
        negotiationCaseId: negotiationCase.id,
        facilitatorId: facilitator.id,
        eventId: event.id,
        status: SessionStatus.DRAFT,
        preparationDurationSeconds: minutesToSeconds(
          assignmentDraft.preparationDurationMinutes,
        ),
        durationSeconds: minutesToSeconds(
          assignmentDraft.negotiationDurationMinutes,
        ),
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

    return createdSession;
  });

  return {
    ok: true,
    sessionId: session.id,
    sessionTitle: session.title,
  };
}
