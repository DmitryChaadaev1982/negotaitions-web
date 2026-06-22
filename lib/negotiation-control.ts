import {
  NegotiationState,
  ParticipantType,
  type Session,
} from "@/app/generated/prisma/client";

export type ControlAction =
  | "START_PREPARATION"
  | "PAUSE_PREPARATION"
  | "RESUME_PREPARATION"
  | "STOP_PREPARATION"
  | "SKIP_PREPARATION"
  | "START"
  | "PAUSE"
  | "RESUME"
  | "FINISH";

export type SessionControlFields = Pick<
  Session,
  | "id"
  | "negotiationState"
  | "durationSeconds"
  | "preparationDurationSeconds"
  | "negotiationStartedAt"
  | "negotiationEndedAt"
  | "timerStartedAt"
  | "pausedAt"
  | "totalPausedSeconds"
  | "preparationStartedAt"
  | "preparationEndedAt"
  | "preparationTimerStartedAt"
  | "preparationPausedAt"
  | "preparationTotalPausedSeconds"
>;

export type ControlState = {
  sessionId: string;
  negotiationState: NegotiationState;
  durationSeconds: number;
  preparationDurationSeconds: number;
  remainingSeconds: number;
  preparationRemainingSeconds: number;
  preparationTimeOver: boolean;
  participantType: ParticipantType;
  canControl: boolean;
  micAllowed: boolean;
  cameraAllowed: boolean;
};

const PREPARATION_PHASE_STATES: NegotiationState[] = [
  NegotiationState.PREPARATION,
  NegotiationState.PREPARATION_RUNNING,
  NegotiationState.PREPARATION_PAUSED,
];

export function isPreparationPhaseState(negotiationState: NegotiationState) {
  return PREPARATION_PHASE_STATES.includes(negotiationState);
}

export function canEditSessionDurations(negotiationState: NegotiationState) {
  return (
    isPreparationPhaseState(negotiationState) ||
    negotiationState === NegotiationState.READY_TO_START
  );
}

export function isCameraAllowed() {
  return true;
}

export function isMicAllowed(
  negotiationState: NegotiationState,
  participantType: ParticipantType,
) {
  switch (negotiationState) {
    case NegotiationState.PREPARATION:
    case NegotiationState.PREPARATION_RUNNING:
    case NegotiationState.PREPARATION_PAUSED:
    case NegotiationState.READY_TO_START:
    case NegotiationState.PAUSED:
    case NegotiationState.FINISHED:
      return true;
    case NegotiationState.RUNNING:
      return participantType === ParticipantType.PARTICIPANT;
    default:
      return true;
  }
}

function closePreparationPause(
  session: SessionControlFields,
  now: Date,
): Pick<
  SessionControlFields,
  "preparationTotalPausedSeconds" | "preparationPausedAt"
> {
  if (!session.preparationPausedAt) {
    return {
      preparationTotalPausedSeconds: session.preparationTotalPausedSeconds,
      preparationPausedAt: null,
    };
  }

  const pauseDurationSeconds = Math.floor(
    (now.getTime() - session.preparationPausedAt.getTime()) / 1000,
  );

  return {
    preparationTotalPausedSeconds:
      session.preparationTotalPausedSeconds + pauseDurationSeconds,
    preparationPausedAt: null,
  };
}

export function computePreparationRemainingSeconds(
  session: SessionControlFields,
  now: Date = new Date(),
) {
  const {
    preparationDurationSeconds,
    negotiationState,
    preparationTimerStartedAt,
    preparationPausedAt,
    preparationTotalPausedSeconds,
  } = session;

  if (negotiationState === NegotiationState.PREPARATION) {
    return preparationDurationSeconds;
  }

  if (
    negotiationState === NegotiationState.READY_TO_START ||
    negotiationState === NegotiationState.RUNNING ||
    negotiationState === NegotiationState.PAUSED ||
    negotiationState === NegotiationState.FINISHED
  ) {
    return 0;
  }

  if (!preparationTimerStartedAt) {
    return preparationDurationSeconds;
  }

  const timerStartedMs = preparationTimerStartedAt.getTime();
  const totalPausedMs = preparationTotalPausedSeconds * 1000;

  if (negotiationState === NegotiationState.PREPARATION_RUNNING) {
    const elapsedSeconds = Math.floor(
      (now.getTime() - timerStartedMs - totalPausedMs) / 1000,
    );
    return Math.max(0, preparationDurationSeconds - elapsedSeconds);
  }

  if (negotiationState === NegotiationState.PREPARATION_PAUSED && preparationPausedAt) {
    const pausedMs = preparationPausedAt.getTime();
    const elapsedSeconds = Math.floor(
      (pausedMs - timerStartedMs - totalPausedMs) / 1000,
    );
    return Math.max(0, preparationDurationSeconds - elapsedSeconds);
  }

  return preparationDurationSeconds;
}

export function computeRemainingSeconds(
  session: SessionControlFields,
  now: Date = new Date(),
) {
  const {
    durationSeconds,
    negotiationState,
    timerStartedAt,
    pausedAt,
    totalPausedSeconds,
  } = session;

  if (
    isPreparationPhaseState(negotiationState) ||
    negotiationState === NegotiationState.READY_TO_START
  ) {
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
  const preparationRemainingSeconds = computePreparationRemainingSeconds(
    session,
    now,
  );
  const remainingSeconds = computeRemainingSeconds(session, now);
  const preparationTimeOver =
    session.negotiationState === NegotiationState.PREPARATION_RUNNING &&
    preparationRemainingSeconds <= 0;

  return {
    sessionId: session.id,
    negotiationState: session.negotiationState,
    durationSeconds: session.durationSeconds,
    preparationDurationSeconds: session.preparationDurationSeconds,
    remainingSeconds,
    preparationRemainingSeconds,
    preparationTimeOver,
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

function getStopPreparationUpdateData(
  session: SessionControlFields,
  now: Date,
) {
  const pauseClosed = closePreparationPause(session, now);

  return {
    negotiationState: NegotiationState.READY_TO_START,
    preparationEndedAt: now,
    ...pauseClosed,
  };
}

function getStartNegotiationUpdateData(
  session: SessionControlFields,
  now: Date,
) {
  return {
    negotiationState: NegotiationState.RUNNING,
    negotiationStartedAt: session.negotiationStartedAt ?? now,
    timerStartedAt: session.timerStartedAt ?? now,
    pausedAt: null,
  };
}

export function getControlUpdateData(
  session: SessionControlFields,
  action: ControlAction,
  now: Date = new Date(),
) {
  switch (action) {
    case "START_PREPARATION": {
      assertTransition(
        session.negotiationState,
        [NegotiationState.PREPARATION],
        action,
      );

      return {
        negotiationState: NegotiationState.PREPARATION_RUNNING,
        preparationStartedAt: session.preparationStartedAt ?? now,
        preparationTimerStartedAt: session.preparationTimerStartedAt ?? now,
        preparationPausedAt: null,
      };
    }
    case "PAUSE_PREPARATION": {
      assertTransition(
        session.negotiationState,
        [NegotiationState.PREPARATION_RUNNING],
        action,
      );

      return {
        negotiationState: NegotiationState.PREPARATION_PAUSED,
        preparationPausedAt: now,
      };
    }
    case "RESUME_PREPARATION": {
      assertTransition(
        session.negotiationState,
        [NegotiationState.PREPARATION_PAUSED],
        action,
      );

      if (!session.preparationPausedAt) {
        throw new Error("Cannot RESUME_PREPARATION without preparationPausedAt.");
      }

      const pauseDurationSeconds = Math.floor(
        (now.getTime() - session.preparationPausedAt.getTime()) / 1000,
      );

      return {
        negotiationState: NegotiationState.PREPARATION_RUNNING,
        preparationTotalPausedSeconds:
          session.preparationTotalPausedSeconds + pauseDurationSeconds,
        preparationPausedAt: null,
      };
    }
    case "STOP_PREPARATION":
    case "SKIP_PREPARATION": {
      assertTransition(
        session.negotiationState,
        [
          NegotiationState.PREPARATION,
          NegotiationState.PREPARATION_RUNNING,
          NegotiationState.PREPARATION_PAUSED,
        ],
        action,
      );

      return getStopPreparationUpdateData(session, now);
    }
    case "START": {
      if (session.negotiationState === NegotiationState.PREPARATION) {
        return {
          ...getStopPreparationUpdateData(session, now),
          ...getStartNegotiationUpdateData(session, now),
        };
      }

      assertTransition(
        session.negotiationState,
        [NegotiationState.READY_TO_START],
        action,
      );

      return getStartNegotiationUpdateData(session, now);
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
          NegotiationState.PREPARATION,
          NegotiationState.PREPARATION_RUNNING,
          NegotiationState.PREPARATION_PAUSED,
          NegotiationState.READY_TO_START,
          NegotiationState.RUNNING,
          NegotiationState.PAUSED,
        ],
        action,
      );

      let totalPausedSeconds = session.totalPausedSeconds;
      let preparationTotalPausedSeconds = session.preparationTotalPausedSeconds;

      if (session.pausedAt) {
        totalPausedSeconds += Math.floor(
          (now.getTime() - session.pausedAt.getTime()) / 1000,
        );
      }

      if (session.preparationPausedAt) {
        preparationTotalPausedSeconds += Math.floor(
          (now.getTime() - session.preparationPausedAt.getTime()) / 1000,
        );
      }

      return {
        negotiationState: NegotiationState.FINISHED,
        negotiationEndedAt: now,
        preparationEndedAt: session.preparationEndedAt ?? now,
        totalPausedSeconds,
        preparationTotalPausedSeconds,
        pausedAt: null,
        preparationPausedAt: null,
      };
    }
    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unknown action: ${exhaustiveCheck}`);
    }
  }
}

export function shouldAutoFinishPreparation(
  session: SessionControlFields,
  now: Date = new Date(),
) {
  if (session.negotiationState !== NegotiationState.PREPARATION_RUNNING) {
    return false;
  }

  return computePreparationRemainingSeconds(session, now) <= 0;
}

export function getAutoFinishPreparationUpdateData(
  session: SessionControlFields,
  now: Date = new Date(),
) {
  return {
    ...getStopPreparationUpdateData(session, now),
    preparationEndedAt: now,
  };
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

export const SESSION_CONTROL_SELECT = {
  id: true,
  negotiationState: true,
  durationSeconds: true,
  preparationDurationSeconds: true,
  negotiationStartedAt: true,
  negotiationEndedAt: true,
  timerStartedAt: true,
  pausedAt: true,
  totalPausedSeconds: true,
  preparationStartedAt: true,
  preparationEndedAt: true,
  preparationTimerStartedAt: true,
  preparationPausedAt: true,
  preparationTotalPausedSeconds: true,
} as const;
