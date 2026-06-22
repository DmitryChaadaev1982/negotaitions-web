import {
  NegotiationState,
  ParticipantType,
  type Session,
} from "@/app/generated/prisma/client";

export type ControlAction = "START" | "PAUSE" | "RESUME" | "FINISH";

export type SessionControlFields = Pick<
  Session,
  | "id"
  | "negotiationState"
  | "durationSeconds"
  | "negotiationStartedAt"
  | "negotiationEndedAt"
  | "timerStartedAt"
  | "pausedAt"
  | "totalPausedSeconds"
>;

export type ControlState = {
  sessionId: string;
  negotiationState: NegotiationState;
  durationSeconds: number;
  remainingSeconds: number;
  participantType: ParticipantType;
  canControl: boolean;
  micAllowed: boolean;
  cameraAllowed: boolean;
};

export function isCameraAllowed() {
  return true;
}

export function isMicAllowed(
  negotiationState: NegotiationState,
  participantType: ParticipantType,
) {
  switch (negotiationState) {
    case NegotiationState.LOBBY:
    case NegotiationState.PAUSED:
    case NegotiationState.FINISHED:
      return true;
    case NegotiationState.RUNNING:
      return participantType === ParticipantType.PARTICIPANT;
    default:
      return true;
  }
}

export function computeRemainingSeconds(
  session: SessionControlFields,
  now: Date = new Date(),
) {
  const { durationSeconds, negotiationState, timerStartedAt, pausedAt, totalPausedSeconds } =
    session;

  if (negotiationState === NegotiationState.LOBBY) {
    return durationSeconds;
  }

  if (!timerStartedAt) {
    return durationSeconds;
  }

  const nowMs = now.getTime();
  const timerStartedMs = timerStartedAt.getTime();
  const totalPausedMs = totalPausedSeconds * 1000;

  if (negotiationState === NegotiationState.RUNNING) {
    const elapsedSeconds = Math.floor(
      (nowMs - timerStartedMs - totalPausedMs) / 1000,
    );
    return Math.max(0, durationSeconds - elapsedSeconds);
  }

  if (negotiationState === NegotiationState.PAUSED && pausedAt) {
    const pausedMs = pausedAt.getTime();
    const elapsedSeconds = Math.floor(
      (pausedMs - timerStartedMs - totalPausedMs) / 1000,
    );
    return Math.max(0, durationSeconds - elapsedSeconds);
  }

  if (negotiationState === NegotiationState.FINISHED) {
    if (pausedAt) {
      const pausedMs = pausedAt.getTime();
      const elapsedSeconds = Math.floor(
        (pausedMs - timerStartedMs - totalPausedMs) / 1000,
      );
      return Math.max(0, durationSeconds - elapsedSeconds);
    }

    if (session.negotiationEndedAt && timerStartedAt) {
      const endedMs = session.negotiationEndedAt.getTime();
      const elapsedSeconds = Math.floor(
        (endedMs - timerStartedMs - totalPausedMs) / 1000,
      );
      return Math.max(0, durationSeconds - elapsedSeconds);
    }

    return 0;
  }

  return durationSeconds;
}

export function buildControlState(
  session: SessionControlFields,
  participantType: ParticipantType,
  now: Date = new Date(),
): ControlState {
  const remainingSeconds = computeRemainingSeconds(session, now);

  return {
    sessionId: session.id,
    negotiationState: session.negotiationState,
    durationSeconds: session.durationSeconds,
    remainingSeconds,
    participantType,
    canControl: participantType === ParticipantType.FACILITATOR,
    micAllowed: isMicAllowed(session.negotiationState, participantType),
    cameraAllowed: isCameraAllowed(),
  };
}

function assertTransition(
  currentState: NegotiationState,
  allowedStates: NegotiationState[],
  action: ControlAction,
) {
  if (!allowedStates.includes(currentState)) {
    throw new Error(`Cannot ${action} from ${currentState}.`);
  }
}

export function getControlUpdateData(
  session: SessionControlFields,
  action: ControlAction,
  now: Date = new Date(),
) {
  switch (action) {
    case "START": {
      assertTransition(session.negotiationState, [NegotiationState.LOBBY], action);

      return {
        negotiationState: NegotiationState.RUNNING,
        negotiationStartedAt: session.negotiationStartedAt ?? now,
        timerStartedAt: session.timerStartedAt ?? now,
        pausedAt: null,
      };
    }
    case "PAUSE": {
      assertTransition(session.negotiationState, [NegotiationState.RUNNING], action);

      return {
        negotiationState: NegotiationState.PAUSED,
        pausedAt: now,
      };
    }
    case "RESUME": {
      assertTransition(session.negotiationState, [NegotiationState.PAUSED], action);

      if (!session.pausedAt) {
        throw new Error("Cannot RESUME without pausedAt.");
      }

      const pauseDurationSeconds = Math.floor(
        (now.getTime() - session.pausedAt.getTime()) / 1000,
      );

      return {
        negotiationState: NegotiationState.RUNNING,
        totalPausedSeconds: session.totalPausedSeconds + pauseDurationSeconds,
        pausedAt: null,
      };
    }
    case "FINISH": {
      assertTransition(
        session.negotiationState,
        [
          NegotiationState.LOBBY,
          NegotiationState.RUNNING,
          NegotiationState.PAUSED,
        ],
        action,
      );

      let totalPausedSeconds = session.totalPausedSeconds;

      if (session.pausedAt) {
        totalPausedSeconds += Math.floor(
          (now.getTime() - session.pausedAt.getTime()) / 1000,
        );
      }

      return {
        negotiationState: NegotiationState.FINISHED,
        negotiationEndedAt: now,
        totalPausedSeconds,
        pausedAt: null,
      };
    }
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${exhaustiveCheck}`);
    }
  }
}

export function shouldAutoFinish(
  session: SessionControlFields,
  now: Date = new Date(),
) {
  if (session.negotiationState !== NegotiationState.RUNNING) {
    return false;
  }

  return computeRemainingSeconds(session, now) <= 0;
}
