import {
  buildSessionMaterialsUrl,
  buildSessionRoomUrl,
  getEventLobbyUrl,
} from "@/lib/config";
import {
  isEventDeletedOrCancelled,
  isEventCompleted,
  resolveEventAccess,
} from "@/lib/event-auth";
import { getActiveSessionAssignment } from "@/lib/event-active-assignment";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import { buildSessionCloseState } from "@/lib/session-close-state";
import { isSessionActiveForRoom } from "@/lib/session-overview-shared";
import { prisma } from "@/lib/prisma";
import type { rejoinValidateSchema } from "@/lib/validations/rejoin";
import type { z } from "zod";

export type RejoinValidateInput = z.infer<typeof rejoinValidateSchema>;

export type RejoinPrimaryAction = "room" | "materials" | "lobby";

export type RejoinValidateResult = {
  valid: boolean;
  targetUrl?: string;
  primaryAction?: RejoinPrimaryAction;
  title?: string;
  subtitle?: string;
  participantType?: string;
  displayName?: string;
  reason?: string;
};

export async function validateRejoinContext(
  input: RejoinValidateInput,
): Promise<RejoinValidateResult> {
  if (input.type === "EVENT_LOBBY") {
    if (!input.eventId) {
      return { valid: false, reason: "missingEventId" };
    }

    if (!input.hostToken && !input.participantToken) {
      return { valid: false, reason: "missingToken" };
    }

    const access = await resolveEventAccess(input.eventId, {
      hostToken: input.hostToken,
      participantToken: input.participantToken,
    });

    if (!access) {
      return { valid: false, reason: "invalidToken" };
    }

    if (isEventDeletedOrCancelled(access.event)) {
      return { valid: false, reason: "eventUnavailable" };
    }

    if (isEventCompleted(access.event)) {
      return { valid: false, reason: "eventCompleted" };
    }

    const displayName = access.currentParticipant?.displayName;

    if (access.currentParticipant && input.participantToken) {
      const activeAssignment = await getActiveSessionAssignment(
        access.currentParticipant.id,
        input.eventId,
      );

      if (activeAssignment) {
        return {
          valid: true,
          primaryAction: "room",
          targetUrl: buildSessionRoomUrl(
            activeAssignment.sessionId,
            activeAssignment.joinToken,
          ),
          title:
            activeAssignment.session.roomLabel ??
            activeAssignment.session.title,
          subtitle: displayName,
          participantType: activeAssignment.type,
          displayName,
        };
      }

      const latestAssignment = await prisma.sessionParticipant.findFirst({
        where: {
          eventParticipantId: access.currentParticipant.id,
          session: {
            eventId: input.eventId,
            deletedAt: null,
          },
        },
        include: {
          session: {
            select: {
              title: true,
              roomLabel: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      if (latestAssignment) {
        return {
          valid: true,
          primaryAction: "materials",
          targetUrl: buildSessionMaterialsUrl(latestAssignment.joinToken),
          title:
            latestAssignment.session.roomLabel ??
            latestAssignment.session.title,
          subtitle: displayName,
          participantType: latestAssignment.type,
          displayName,
        };
      }
    }

    return {
      valid: true,
      primaryAction: "lobby",
      targetUrl: getEventLobbyUrl(input.eventId, {
        hostToken: input.hostToken,
        participantToken: input.participantToken,
      }),
      title: access.event.title,
      subtitle: displayName,
      displayName,
    };
  }

  if (input.type === "SESSION_JOIN" || input.type === "SESSION_ROOM") {
    if (!input.joinToken) {
      return { valid: false, reason: "missingJoinToken" };
    }

    const participant = await getSessionParticipantByJoinToken(
      input.joinToken,
      input.sessionId,
    );

    if (!participant) {
      return { valid: false, reason: "invalidJoinToken" };
    }

    const sessionRecord = await prisma.session.findUnique({
      where: { id: participant.sessionId },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        negotiationState: true,
        negotiationStartedAt: true,
        closedByEventAt: true,
        closeReason: true,
        event: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!sessionRecord) {
      return { valid: false, reason: "invalidJoinToken" };
    }

    if (sessionRecord.deletedAt) {
      return { valid: false, reason: "sessionDeleted" };
    }

    const closeState = buildSessionCloseState(sessionRecord);
    const materialsUrl = buildSessionMaterialsUrl(input.joinToken);
    const roomActive = isSessionActiveForRoom(sessionRecord);

    if (closeState.isClosed || !roomActive) {
      return {
        valid: true,
        primaryAction: "materials",
        targetUrl: materialsUrl,
        title: sessionRecord.title,
        subtitle: participant.displayName,
        participantType: participant.type,
        displayName: participant.displayName,
      };
    }

    return {
      valid: true,
      primaryAction: "room",
      targetUrl: buildSessionRoomUrl(sessionRecord.id, input.joinToken),
      title: sessionRecord.title,
      subtitle: participant.displayName,
      participantType: participant.type,
      displayName: participant.displayName,
    };
  }

  return { valid: false, reason: "unsupportedType" };
}

export async function validateEventParticipantToken(
  eventId: string,
  participantToken: string,
) {
  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
  });

  if (!event || isEventDeletedOrCancelled(event)) {
    return null;
  }

  if (isEventCompleted(event)) {
    return null;
  }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId,
      participantToken,
    },
  });

  if (!participant) {
    return null;
  }

  return participant;
}
