import {
  NegotiationState,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { canManageEvent, getCurrentUserEventAccess } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import { completeSessionCanonical } from "@/lib/session-completion";

export type RecordingStopResult = {
  sessionId: string;
  recordingId: string | null;
  ok: boolean;
  status: string | null;
  warning?: string;
};

export type CompleteEventResult = {
  eventStatus: TrainingEventStatus;
  completedAt: string;
  completionReason: string | null;
  affectedSessions: Array<{
    id: string;
    negotiationState: NegotiationState;
    closeReason: string | null;
    closedByEventAt: string | null;
  }>;
  recordingStopResults: RecordingStopResult[];
  warnings: string[];
};

function buildAlreadyCompletedResult(
  event: {
    status: TrainingEventStatus;
    completedAt: Date | null;
    completionReason: string | null;
  },
  sessions: Array<{
    id: string;
    negotiationState: NegotiationState;
    closeReason: string | null;
    closedByEventAt: Date | null;
  }>,
): CompleteEventResult {
  return {
    eventStatus: event.status,
    completedAt: event.completedAt?.toISOString() ?? new Date().toISOString(),
    completionReason: event.completionReason,
    affectedSessions: sessions.map((session) => ({
      id: session.id,
      negotiationState: session.negotiationState,
      closeReason: session.closeReason,
      closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
    })),
    recordingStopResults: [],
    warnings: [],
  };
}

export async function completeTrainingEvent(
  eventId: string,
  access:
    | { hostToken: string; actorUser?: null }
    | { hostToken?: string; actorUser: AuthUser },
  completionReason?: string,
): Promise<
  | { ok: true; result: CompleteEventResult }
  | { ok: false; error: string; status: number }
> {
  const eventAccess = await getCurrentUserEventAccess(
    eventId,
    access.actorUser ?? null,
    { hostToken: access.hostToken },
  );

  if (!eventAccess || !canManageEvent(eventAccess)) {
    return { ok: false, error: "forbidden", status: 403 };
  }

  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      completedAt: true,
      completionReason: true,
    },
  });

  if (!event || event.deletedAt) {
    return { ok: false, error: "eventNotFound", status: 404 };
  }

  if (event.status === TrainingEventStatus.COMPLETED) {
    return {
      ok: true,
      result: buildAlreadyCompletedResult(
        event,
        await prisma.session.findMany({
          where: { eventId, deletedAt: null },
          select: {
            id: true,
            negotiationState: true,
            closeReason: true,
            closedByEventAt: true,
          },
        }),
      ),
    };
  }

  if (event.status === TrainingEventStatus.CANCELLED) {
    return { ok: false, error: "eventUnavailable", status: 410 };
  }

  const now = new Date();
  await prisma.trainingEvent.update({
    where: { id: eventId },
    data: {
      status: TrainingEventStatus.COMPLETED,
      completedAt: now,
      completedBy: access.actorUser?.id ?? access.hostToken ?? null,
      completionReason: completionReason?.trim() || null,
    },
  });

  const recordingStopResults: RecordingStopResult[] = [];
  const warnings: string[] = [];

  const sessions = await prisma.session.findMany({
    where: {
      eventId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  for (const session of sessions) {
    try {
      const finishResult = await completeSessionCanonical({
        sessionId: session.id,
        mode: "EVENT_COMPLETION",
        hardClose: true,
        closedByEventId: eventId,
        reason: completionReason?.trim() || "EVENT_COMPLETION",
      });
      recordingStopResults.push({
        sessionId: session.id,
        recordingId: finishResult.recording.recordingId,
        ok:
          finishResult.recording.stopOperationState !== "FAILED",
        status: finishResult.recording.status,
        warning: finishResult.recording.warning ?? undefined,
      });

      if (finishResult.recording.warning) {
        warnings.push(`${session.id}:${finishResult.recording.warning}`);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "sessionCompletionFailed";
      recordingStopResults.push({
        sessionId: session.id,
        recordingId: null,
        ok: false,
        status: null,
        warning: message,
      });
      warnings.push(`${session.id}:${message}`);
    }
  }

  const updatedEvent = await prisma.trainingEvent.findUniqueOrThrow({
    where: { id: eventId },
  });

  const updatedSessions = await prisma.session.findMany({
    where: {
      eventId,
      deletedAt: null,
    },
    select: {
      id: true,
      negotiationState: true,
      closeReason: true,
      closedByEventAt: true,
    },
  });

  return {
    ok: true,
    result: {
      eventStatus: updatedEvent.status,
      completedAt: updatedEvent.completedAt?.toISOString() ?? now.toISOString(),
      completionReason: updatedEvent.completionReason,
      affectedSessions: updatedSessions.map((session) => ({
        id: session.id,
        negotiationState: session.negotiationState,
        closeReason: session.closeReason,
        closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
      })),
      recordingStopResults,
      warnings,
    },
  };
}
