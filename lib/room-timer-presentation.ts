import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";

import { deriveLiveSessionPresentationState } from "@/lib/live-session-presentation";
import type { ControlState } from "@/lib/negotiation-control";

export type TimerStateTone = "default" | "warning" | "critical" | "finished";

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
    | null;
  icon: "i" | ">" | "!" | "!!" | "||" | "[]";
  tone: TimerStateTone;
};

export function buildRoomTimerPresentation(
  controlState: Pick<ControlState, "negotiationState" | "remainingSeconds" | "participantType">,
): TimerPresentation {
  const presentationState = deriveLiveSessionPresentationState({
    negotiationState: controlState.negotiationState,
    remainingSeconds: controlState.remainingSeconds,
    finishLineActive: controlState.negotiationState === "FINISHED",
  });

  switch (presentationState) {
    case "ROOM_READY":
      return {
        presentationState,
        titleKey: "room.waitingForPreparation",
        subtitleKey:
          controlState.participantType === ParticipantType.FACILITATOR
            ? "room.checkParticipantsAndConnection"
            : "room.facilitatorWillStartShortly",
        icon: "i",
        tone: "default",
      };
    case "PREPARATION_RUNNING":
      return {
        presentationState,
        titleKey: "room.preparationRunning",
        subtitleKey: null,
        icon: "i",
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
        icon: "||",
        tone: "default",
      };
    case "WAITING_FOR_NEGOTIATION_START":
      return {
        presentationState,
        titleKey: "room.preparationComplete",
        subtitleKey: "room.waitingForFacilitatorStart",
        icon: "i",
        tone: "default",
      };
    case "NEGOTIATION_RUNNING":
      return {
        presentationState,
        titleKey: "room.negotiationInProgress",
        subtitleKey: null,
        icon: ">",
        tone: "default",
      };
    case "FINAL_MINUTE":
      return {
        presentationState,
        titleKey: "room.oneMinuteRemaining",
        subtitleKey: null,
        icon: "!",
        tone: "warning",
      };
    case "FINAL_10_SECONDS":
      return {
        presentationState,
        titleKey: "room.finalTenSeconds",
        subtitleKey: null,
        icon: "!!",
        tone: "critical",
      };
    case "NEGOTIATION_PAUSED":
      return {
        presentationState,
        titleKey: "room.negotiationPaused",
        subtitleKey: null,
        icon: "||",
        tone: "default",
      };
    case "FINISH_LINE_TIMER_EXPIRED":
      return {
        presentationState,
        titleKey: "room.timeIsUp",
        subtitleKey: "room.negotiationsComplete",
        icon: "[]",
        tone: "finished",
      };
    case "FINISH_LINE_MANUAL_FINISH":
      return {
        presentationState,
        titleKey: "room.negotiationsComplete",
        subtitleKey: "room.debriefIsNext",
        icon: "[]",
        tone: "finished",
      };
    case "DEBRIEF":
      return {
        presentationState,
        titleKey: "room.debriefTitle",
        subtitleKey: null,
        icon: "i",
        tone: "default",
      };
    default:
      return {
        presentationState: "DEBRIEF",
        titleKey: "room.debriefTitle",
        subtitleKey: null,
        icon: "i",
        tone: "default",
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
