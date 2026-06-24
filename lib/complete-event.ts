import {
  NegotiationState,
  SessionStatus,
  TrainingEventStatus,
  type Recording,
  type Session,
} from "@/app/generated/prisma/client";
import {
  findActiveRecordingForSession,
  stopRecording,
} from "@/lib/livekit-egress";
import { isSessionActiveForAssignment } from "@/lib/event-active-assignment";
import { getControlUpdateData } from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import { closeLatestPauseInterval } from "@/lib/session-pause-intervals";

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

type SessionWithRecording = Session & {
  recording: Recording | null;
};

function buildAlreadyCompletedResult(
  event: {
    status: TrainingEventStatus;
    completedAt: Date | null;
    completionReason: string | null;
  },
  sessions: SessionWithRecording[],
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

function buildSessionCloseUpdate(
  session: Session,
  eventId: string,
  now: Date,
) {
  if (session.negotiationState === NegotiationState.FINISHED) {
    return null;
  }

  return {
    ...getControlUpdateData(session, "FINISH", now),
    closedByEventAt: now,
    closedByEventId: eventId,
    closeReason: "EVENT_COMPLETED",
    status: SessionStatus.COMPLETED,
  };
}

async function stopSessionRecordingIfActive(
  sessionId: string,
): Promise<RecordingStopResult> {
  const activeRecording = await findActiveRecordingForSession(sessionId);

  if (!activeRecording) {
    return {
      sessionId,
      recordingId: null,
      ok: true,
      status: null,
    };
  }

  if (!activeRecording.egressId) {
    return {
      sessionId,
      recordingId: activeRecording.id,
      ok: true,
      status: activeRecording.status,
      warning: "recordingMissingEgressId",
    };
  }

  const result = await stopRecording(activeRecording);

  return {
    sessionId,
    recordingId: result.recording.id,
    ok: result.ok,
    status: result.recording.status,
    warning: result.warning,
  };
}

export async function completeTrainingEvent(
  eventId: string,
  hostToken: string,
  completionReason?: string,
): Promise<
  | { ok: true; result: CompleteEventResult }
  | { ok: false; error: string; status: number }
> {
  const event = await prisma.trainingEvent.findUnique({
    where: { id: eventId },
    include: {
      sessions: {
        where: { deletedAt: null },
        include: {
          recording: true,
        },
      },
    },
  });

  if (!event || event.deletedAt) {
    return { ok: false, error: "eventNotFound", status: 404 };
  }

  if (hostToken !== event.hostToken) {
    return { ok: false, error: "forbidden", status: 403 };
  }

  if (event.status === TrainingEventStatus.COMPLETED) {
    return {
      ok: true,
      result: buildAlreadyCompletedResult(event, event.sessions),
    };
  }

  if (event.status === TrainingEventStatus.CANCELLED) {
    return { ok: false, error: "eventUnavailable", status: 410 };
  }

  const now = new Date();
  const sessionsToClose = event.sessions.filter(isSessionActiveForAssignment);

  await prisma.$transaction(async (tx) => {
    await tx.trainingEvent.update({
      where: { id: eventId },
      data: {
        status: TrainingEventStatus.COMPLETED,
        completedAt: now,
        completedBy: hostToken,
        completionReason: completionReason?.trim() || null,
      },
    });

    for (const session of sessionsToClose) {
      const updateData = buildSessionCloseUpdate(session, eventId, now);

      if (!updateData) {
        continue;
      }

      await tx.session.update({
        where: { id: session.id },
        data: updateData,
      });
    }
  });

  for (const session of sessionsToClose) {
    if (session.negotiationState !== NegotiationState.FINISHED) {
      await closeLatestPauseInterval(session.id, now);
    }
  }

  const recordingStopResults: RecordingStopResult[] = [];
  const warnings: string[] = [];

  for (const session of event.sessions) {
    const stopResult = await stopSessionRecordingIfActive(session.id);

    if (!stopResult.recordingId && stopResult.ok) {
      continue;
    }

    recordingStopResults.push(stopResult);

    if (!stopResult.ok || stopResult.warning) {
      warnings.push(
        stopResult.warning ?? `recordingStopFailed:${session.id}`,
      );
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
