import {
  NegotiationState,
  ParticipantType,
  RecordingStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import type { VoximplantServerStopMode } from "@/lib/env";

const RELAY_ELIGIBLE_PARTICIPANT_TYPES = new Set<ParticipantType>([
  ParticipantType.FACILITATOR,
  ParticipantType.PARTICIPANT,
  ParticipantType.OBSERVER,
]);

const RELAY_STOPPABLE_RECORDING_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.RECORDING,
  RecordingStatus.PAUSED,
  RecordingStatus.STARTING,
]);

const RELAY_TERMINAL_RECORDING_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.PROCESSING,
  RecordingStatus.STOPPED,
  RecordingStatus.COMPLETED,
  RecordingStatus.FAILED,
]);

export function isBrowserStopRelayEnabledForMode(
  mode: VoximplantServerStopMode,
): boolean {
  return (
    mode === "disabled" ||
    mode === "prefer_server_with_relay_fallback"
  );
}

export function isRelayEligibleParticipantType(participantType: ParticipantType) {
  return RELAY_ELIGIBLE_PARTICIPANT_TYPES.has(participantType);
}

export function isRelayStoppableRecordingStatus(status: RecordingStatus) {
  return RELAY_STOPPABLE_RECORDING_STATUSES.has(status);
}

export function isRelayTerminalRecordingStatus(status: RecordingStatus) {
  return RELAY_TERMINAL_RECORDING_STATUSES.has(status);
}

export function isRelayWindowOpenForSessionState(session: {
  negotiationState: NegotiationState;
  closedByEventAt: Date | null;
  closeReason: string | null;
  eventStatus: TrainingEventStatus | null;
}) {
  return (
    session.negotiationState === NegotiationState.FINISHED ||
    session.closedByEventAt != null ||
    session.closeReason === "EVENT_COMPLETED" ||
    session.eventStatus === TrainingEventStatus.COMPLETED
  );
}
