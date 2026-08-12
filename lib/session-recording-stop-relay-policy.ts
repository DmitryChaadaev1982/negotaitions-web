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

export function buildAttemptFencedStopRelayDispatchContext(params: {
  sessionId: string;
  operationId: string;
  recordingAttemptId: string | null;
  participant: {
    id: string;
    type: ParticipantType;
    userId: string | null;
  };
}) {
  const controllerRole =
    params.participant.type === ParticipantType.FACILITATOR
      ? "facilitator"
      : params.participant.type === ParticipantType.OBSERVER
        ? "observer"
        : params.participant.type === ParticipantType.PARTICIPANT
          ? "participant"
          : "unknown";

  return {
    sessionId: params.sessionId,
    participantId: params.participant.id,
    controllerUserId:
      params.participant.userId ??
      `session_participant:${params.participant.id}`,
    controllerRole,
    canControlRecording: true,
    requestId: params.operationId,
    recordingAttemptId: params.recordingAttemptId ?? undefined,
  };
}

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
