import { getAppUrl } from "@/lib/config";
import { isEventUnavailable, resolveEventAccess } from "@/lib/event-auth";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import { prisma } from "@/lib/prisma";
import type { rejoinValidateSchema } from "@/lib/validations/rejoin";
import type { z } from "zod";

export type RejoinValidateInput = z.infer<typeof rejoinValidateSchema>;

export type RejoinValidateResult = {
  valid: boolean;
  targetUrl?: string;
  title?: string;
  subtitle?: string;
  participantType?: string;
  displayName?: string;
  reason?: string;
};

function buildEventLobbyTargetUrl(
  eventId: string,
  tokens: { hostToken?: string; participantToken?: string },
) {
  const params = new URLSearchParams();

  if (tokens.hostToken) {
    params.set("hostToken", tokens.hostToken);
  }

  if (tokens.participantToken) {
    params.set("participantToken", tokens.participantToken);
  }

  return `${getAppUrl()}/events/${eventId}/lobby?${params.toString()}`;
}

function buildSessionRoomTargetUrl(sessionId: string, joinToken: string) {
  const params = new URLSearchParams({ joinToken });
  return `${getAppUrl()}/room/${sessionId}?${params.toString()}`;
}

function buildSessionJoinTargetUrl(joinToken: string) {
  return `${getAppUrl()}/join/${joinToken}`;
}

function isSessionRoomAvailable(negotiationState: string, deletedAt: Date | null) {
  if (deletedAt) {
    return false;
  }

  return true;
}

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

    if (isEventUnavailable(access.event)) {
      return { valid: false, reason: "eventUnavailable" };
    }

    const displayName = access.currentParticipant?.displayName;

    return {
      valid: true,
      targetUrl: buildEventLobbyTargetUrl(input.eventId, {
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
      },
    });

    if (!sessionRecord) {
      return { valid: false, reason: "invalidJoinToken" };
    }

    if (sessionRecord.deletedAt) {
      return { valid: false, reason: "sessionDeleted" };
    }

    const roomAvailable = isSessionRoomAvailable(
      sessionRecord.negotiationState,
      sessionRecord.deletedAt,
    );

    const targetUrl = roomAvailable
      ? buildSessionRoomTargetUrl(sessionRecord.id, input.joinToken)
      : buildSessionJoinTargetUrl(input.joinToken);

    return {
      valid: true,
      targetUrl,
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

  if (!event || isEventUnavailable(event)) {
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
