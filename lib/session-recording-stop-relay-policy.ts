import {
  NegotiationState,
  ParticipantType,
  RecordingStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";

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
