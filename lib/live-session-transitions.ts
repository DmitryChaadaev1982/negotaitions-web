import { NegotiationState } from "@/app/generated/prisma/enums";

import type { ControlState } from "@/lib/negotiation-control";
import type { RoomAudioCue } from "@/lib/semantic-room-audio";

const THRESHOLD_JITTER_SECONDS = 2;

export type LiveSessionTransitionEvent =
  | "PREPARATION_STARTED"
  | "PREPARATION_PAUSED"
  | "PREPARATION_RESUMED"
  | "NEGOTIATION_STARTED"
  | "NEGOTIATION_PAUSED"
  | "NEGOTIATION_RESUMED"
  | "FINAL_MINUTE"
  | "FINAL_10_SECONDS"
  | "TIME_EXPIRED"
  | "MANUAL_COMPLETION";

export type LiveSessionAnnouncementKey =
  | "room.a11yPreparationStarted"
  | "room.a11yPreparationPaused"
  | "room.a11yPreparationResumed"
  | "room.a11yNegotiationStarted"
  | "room.a11yNegotiationPaused"
  | "room.a11yNegotiationResumed"
  | "room.a11yOneMinuteRemaining"
  | "room.a11yTenSecondsRemaining"
  | "room.a11yTimeExpired"
  | "room.a11yManualCompletion";

export type LiveSessionSnapshot = {
  negotiationState: NegotiationState;
  remainingSeconds: number;
  timerStartedAt: string | null;
};

export type LiveSessionTransitionMachineState = {
  previousSnapshot: LiveSessionSnapshot | null;
  wasVisible: boolean;
};

export function createLiveSessionTransitionMachineState(): LiveSessionTransitionMachineState {
  return {
    previousSnapshot: null,
    wasVisible: true,
  };
}

export function buildLiveSessionSnapshot(
  controlState: Pick<ControlState, "negotiationState" | "remainingSeconds" | "timerStartedAt">,
): LiveSessionSnapshot {
  return {
    negotiationState: controlState.negotiationState,
    remainingSeconds: controlState.remainingSeconds,
    timerStartedAt: controlState.timerStartedAt ?? null,
  };
}

function isSameRunningEpoch(previous: LiveSessionSnapshot, current: LiveSessionSnapshot) {
  if (!previous.timerStartedAt || !current.timerStartedAt) {
    return false;
  }
  return previous.timerStartedAt === current.timerStartedAt;
}

function crossesWithinJitterThreshold(params: {
  previousRemainingSeconds: number;
  currentRemainingSeconds: number;
  threshold: number;
}) {
  const { previousRemainingSeconds, currentRemainingSeconds, threshold } = params;
  if (previousRemainingSeconds <= threshold || currentRemainingSeconds > threshold) {
    return false;
  }
  const minAllowedRemaining = threshold - THRESHOLD_JITTER_SECONDS;
  return currentRemainingSeconds >= minAllowedRemaining;
}

export function detectLiveSessionTransitionEvent(params: {
  previous: LiveSessionSnapshot | null;
  current: LiveSessionSnapshot;
  finishLineActive: boolean;
}) {
  const { previous, current, finishLineActive } = params;

  if (!previous) {
    return null;
  }

  if (
    previous.negotiationState === NegotiationState.PREPARATION &&
    current.negotiationState === NegotiationState.PREPARATION_RUNNING
  ) {
    return "PREPARATION_STARTED";
  }
  if (
    previous.negotiationState === NegotiationState.PREPARATION_RUNNING &&
    current.negotiationState === NegotiationState.PREPARATION_PAUSED
  ) {
    return "PREPARATION_PAUSED";
  }
  if (
    previous.negotiationState === NegotiationState.PREPARATION_PAUSED &&
    current.negotiationState === NegotiationState.PREPARATION_RUNNING
  ) {
    return "PREPARATION_RESUMED";
  }

  if (
    previous.negotiationState === NegotiationState.READY_TO_START &&
    current.negotiationState === NegotiationState.RUNNING
  ) {
    return "NEGOTIATION_STARTED";
  }
  if (
    previous.negotiationState === NegotiationState.RUNNING &&
    current.negotiationState === NegotiationState.PAUSED
  ) {
    return "NEGOTIATION_PAUSED";
  }
  if (
    previous.negotiationState === NegotiationState.PAUSED &&
    current.negotiationState === NegotiationState.RUNNING
  ) {
    return "NEGOTIATION_RESUMED";
  }

  if (
    (previous.negotiationState === NegotiationState.RUNNING ||
      previous.negotiationState === NegotiationState.PAUSED) &&
    current.negotiationState === NegotiationState.FINISHED &&
    finishLineActive
  ) {
    return current.remainingSeconds === 0 ? "TIME_EXPIRED" : "MANUAL_COMPLETION";
  }

  if (
    previous.negotiationState === NegotiationState.RUNNING &&
    current.negotiationState === NegotiationState.RUNNING &&
    isSameRunningEpoch(previous, current)
  ) {
    const crossedFinalTen =
      current.remainingSeconds > 0 &&
      crossesWithinJitterThreshold({
        previousRemainingSeconds: previous.remainingSeconds,
        currentRemainingSeconds: current.remainingSeconds,
        threshold: 10,
      });
    if (crossedFinalTen) {
      return "FINAL_10_SECONDS";
    }

    const crossedFinalMinute = crossesWithinJitterThreshold({
      previousRemainingSeconds: previous.remainingSeconds,
      currentRemainingSeconds: current.remainingSeconds,
      threshold: 60,
    });
    if (crossedFinalMinute) {
      return "FINAL_MINUTE";
    }
  }

  return null;
}

export function mapTransitionEventToAudioCue(
  event: LiveSessionTransitionEvent | null,
): RoomAudioCue | null {
  if (!event) {
    return null;
  }
  switch (event) {
    case "NEGOTIATION_STARTED":
      return "START";
    case "NEGOTIATION_PAUSED":
      return "PAUSE";
    case "NEGOTIATION_RESUMED":
      return "RESUME";
    case "FINAL_MINUTE":
      return "ONE_MINUTE";
    case "FINAL_10_SECONDS":
      return "TEN_SECONDS";
    case "TIME_EXPIRED":
    case "MANUAL_COMPLETION":
      return "END";
    default:
      return null;
  }
}

export function mapTransitionEventToAnnouncementKey(
  event: LiveSessionTransitionEvent | null,
): LiveSessionAnnouncementKey | null {
  if (!event) {
    return null;
  }
  switch (event) {
    case "PREPARATION_STARTED":
      return "room.a11yPreparationStarted";
    case "PREPARATION_PAUSED":
      return "room.a11yPreparationPaused";
    case "PREPARATION_RESUMED":
      return "room.a11yPreparationResumed";
    case "NEGOTIATION_STARTED":
      return "room.a11yNegotiationStarted";
    case "NEGOTIATION_PAUSED":
      return "room.a11yNegotiationPaused";
    case "NEGOTIATION_RESUMED":
      return "room.a11yNegotiationResumed";
    case "FINAL_MINUTE":
      return "room.a11yOneMinuteRemaining";
    case "FINAL_10_SECONDS":
      return "room.a11yTenSecondsRemaining";
    case "TIME_EXPIRED":
      return "room.a11yTimeExpired";
    case "MANUAL_COMPLETION":
      return "room.a11yManualCompletion";
    default:
      return null;
  }
}

export function reduceLiveSessionTransition(params: {
  state: LiveSessionTransitionMachineState;
  currentSnapshot: LiveSessionSnapshot;
  isVisible: boolean;
  finishLineActive: boolean;
  allowAudio: boolean;
}) {
  const { state, currentSnapshot, isVisible, finishLineActive, allowAudio } = params;

  const nextState: LiveSessionTransitionMachineState = {
    previousSnapshot: currentSnapshot,
    wasVisible: isVisible,
  };

  if (!state.previousSnapshot) {
    return {
      nextState,
      event: null,
      cue: null,
      announcementKey: null,
    };
  }

  const becameVisible = !state.wasVisible && isVisible;
  if (!isVisible || becameVisible) {
    return {
      nextState,
      event: null,
      cue: null,
      announcementKey: null,
    };
  }

  const event = detectLiveSessionTransitionEvent({
    previous: state.previousSnapshot,
    current: currentSnapshot,
    finishLineActive,
  });

  return {
    nextState,
    event,
    cue: allowAudio ? mapTransitionEventToAudioCue(event) : null,
    announcementKey: mapTransitionEventToAnnouncementKey(event),
  };
}

