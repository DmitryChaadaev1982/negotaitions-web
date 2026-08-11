import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";

import { deriveLiveSessionPresentationState } from "@/lib/live-session-presentation";
import type { ControlState } from "@/lib/negotiation-control";

export type TimerStateTone = "default" | "warning" | "critical" | "finished";
export type StatusBadgePath =
  | "/status-badges/status-room-ready.png"
  | "/status-badges/status-preparation-running.png"
  | "/status-badges/status-preparation-paused.png"
  | "/status-badges/status-ready-to-start.png"
  | "/status-badges/status-negotiation-running.png"
  | "/status-badges/status-negotiation-paused.png"
  | "/status-badges/status-final-minute.png"
  | "/status-badges/status-final-10.png"
  | "/status-badges/status-time-expired.png"
  | "/status-badges/status-negotiation-complete.png"
  | "/status-badges/status-debrief.png";

export const STATUS_BADGE_BY_PRESENTATION_STATE = {
  ROOM_READY: "/status-badges/status-room-ready.png",
  PREPARATION_RUNNING: "/status-badges/status-preparation-running.png",
  PREPARATION_PAUSED: "/status-badges/status-preparation-paused.png",
  WAITING_FOR_NEGOTIATION_START: "/status-badges/status-ready-to-start.png",
  NEGOTIATION_RUNNING: "/status-badges/status-negotiation-running.png",
  NEGOTIATION_PAUSED: "/status-badges/status-negotiation-paused.png",
  FINAL_MINUTE: "/status-badges/status-final-minute.png",
  FINAL_10_SECONDS: "/status-badges/status-final-10.png",
  FINISH_LINE_TIMER_EXPIRED: "/status-badges/status-time-expired.png",
  FINISH_LINE_MANUAL_FINISH: "/status-badges/status-negotiation-complete.png",
  DEBRIEF: "/status-badges/status-debrief.png",
} as const satisfies Record<
  ReturnType<typeof deriveLiveSessionPresentationState>,
  StatusBadgePath
>;

export type TimerPresentation = {
  presentationState: ReturnType<typeof deriveLiveSessionPresentationState>;
  titleKey:
    | "room.waitingForPreparation"
    | "room.preparationRunning"
    | "room.preparationPaused"
    | "room.preparationComplete"
    | "room.negotiationInProgress"
    | "room.oneMinuteRemaining"
    | "room.finalTenSeconds"
    | "room.negotiationPaused"
    | "room.timeIsUp"
    | "room.negotiationsComplete"
    | "room.debriefTitle";
  subtitleKey:
    | "room.facilitatorWillStartShortly"
    | "room.checkParticipantsAndConnection"
    | "room.waitingForFacilitator"
    | "room.waitingForFacilitatorStart"
    | "room.negotiationsComplete"
    | "room.debriefIsNext"
    | "room.discussMeetingResults"
    | null;
  badgePath: StatusBadgePath;
  tone: TimerStateTone;
};

export function buildRoomTimerPresentation(
  controlState: Pick<
    ControlState,
    "negotiationState" | "remainingSeconds" | "participantType"
  > & {
    finishLineActive?: boolean;
  },
): TimerPresentation {
  const finishLineActive =
    controlState.finishLineActive ?? controlState.negotiationState === "FINISHED";
  const presentationState = deriveLiveSessionPresentationState({
    negotiationState: controlState.negotiationState,
    remainingSeconds: controlState.remainingSeconds,
    finishLineActive,
  });
  const pausedTone: TimerStateTone =
    controlState.remainingSeconds <= 10
      ? "critical"
      : controlState.remainingSeconds <= 60
        ? "warning"
        : "default";

  switch (presentationState) {
    case "ROOM_READY":
      return {
        presentationState,
        titleKey: "room.waitingForPreparation",
        subtitleKey:
          controlState.participantType === ParticipantType.FACILITATOR
            ? "room.checkParticipantsAndConnection"
            : "room.facilitatorWillStartShortly",
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.ROOM_READY,
        tone: "default",
      };
    case "PREPARATION_RUNNING":
      return {
        presentationState,
        titleKey: "room.preparationRunning",
        subtitleKey: null,
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.PREPARATION_RUNNING,
        tone: "default",
      };
    case "PREPARATION_PAUSED":
      return {
        presentationState,
        titleKey: "room.preparationPaused",
        subtitleKey:
          controlState.participantType === ParticipantType.PARTICIPANT
            ? "room.waitingForFacilitator"
            : null,
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.PREPARATION_PAUSED,
        tone: "default",
      };
    case "WAITING_FOR_NEGOTIATION_START":
      return {
        presentationState,
        titleKey: "room.preparationComplete",
        subtitleKey: "room.waitingForFacilitatorStart",
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.WAITING_FOR_NEGOTIATION_START,
        tone: "default",
      };
    case "NEGOTIATION_RUNNING":
      return {
        presentationState,
        titleKey: "room.negotiationInProgress",
        subtitleKey: null,
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.NEGOTIATION_RUNNING,
        tone: "default",
      };
    case "FINAL_MINUTE":
      return {
        presentationState,
        titleKey: "room.oneMinuteRemaining",
        subtitleKey: null,
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.FINAL_MINUTE,
        tone: "warning",
      };
    case "FINAL_10_SECONDS":
      return {
        presentationState,
        titleKey: "room.finalTenSeconds",
        subtitleKey: null,
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.FINAL_10_SECONDS,
        tone: "critical",
      };
    case "NEGOTIATION_PAUSED":
      return {
        presentationState,
        titleKey: "room.negotiationPaused",
        subtitleKey: null,
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.NEGOTIATION_PAUSED,
        tone: pausedTone,
      };
    case "FINISH_LINE_TIMER_EXPIRED":
      return {
        presentationState,
        titleKey: "room.timeIsUp",
        subtitleKey: "room.negotiationsComplete",
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.FINISH_LINE_TIMER_EXPIRED,
        tone: "finished",
      };
    case "FINISH_LINE_MANUAL_FINISH":
      return {
        presentationState,
        titleKey: "room.negotiationsComplete",
        subtitleKey: "room.debriefIsNext",
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.FINISH_LINE_MANUAL_FINISH,
        tone: "finished",
      };
    case "DEBRIEF":
      return {
        presentationState,
        titleKey: "room.debriefTitle",
        subtitleKey: "room.discussMeetingResults",
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.DEBRIEF,
        tone: "finished",
      };
    default:
      return {
        presentationState: "DEBRIEF",
        titleKey: "room.debriefTitle",
        subtitleKey: "room.discussMeetingResults",
        badgePath: STATUS_BADGE_BY_PRESENTATION_STATE.DEBRIEF,
        tone: "finished",
      };
  }
}

export function isNegotiationTimerVisible(negotiationState: NegotiationState) {
  return (
    negotiationState === "READY_TO_START" ||
    negotiationState === "RUNNING" ||
    negotiationState === "PAUSED" ||
    negotiationState === "FINISHED"
  );
}

export function isPreparationTimerVisible(negotiationState: NegotiationState) {
  return (
    negotiationState === "PREPARATION" ||
    negotiationState === "PREPARATION_RUNNING" ||
    negotiationState === "PREPARATION_PAUSED"
  );
}
