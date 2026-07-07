import type { ParticipantType } from "@/app/generated/prisma/enums";
import {
  VOXIMPLANT_MIC_ACTIVITY_SOURCE,
  isRemoteStreamActivitySource,
} from "@/lib/telemetry/audio-activity-sources";

type SessionParticipantLookup = {
  id: string;
  sessionId: string;
  type: ParticipantType;
};

export type AudioActivityAuthorizationResult =
  | {
      accepted: true;
      targetSessionParticipantId: string;
    }
  | {
      accepted: false;
      httpStatus: number;
      reason: string;
    };

export async function authorizeAudioActivitySubmission(input: {
  source: string;
  callerSessionParticipantId: string;
  callerParticipantType: ParticipantType;
  sessionId: string;
  requestedSessionParticipantId?: string;
  findSessionParticipantById: (
    participantId: string,
  ) => Promise<SessionParticipantLookup | null>;
}): Promise<AudioActivityAuthorizationResult> {
  if (!isRemoteStreamActivitySource(input.source)) {
    if (
      input.source === VOXIMPLANT_MIC_ACTIVITY_SOURCE &&
      input.callerParticipantType !== "PARTICIPANT"
    ) {
      return {
        accepted: false,
        httpStatus: 403,
        reason: "local_source_target_must_be_participant",
      };
    }
    if (
      input.source === VOXIMPLANT_MIC_ACTIVITY_SOURCE &&
      input.requestedSessionParticipantId &&
      input.requestedSessionParticipantId !== input.callerSessionParticipantId
    ) {
      return {
        accepted: false,
        httpStatus: 403,
        reason: "invalid_session_participant_id",
      };
    }
    return {
      accepted: true,
      targetSessionParticipantId: input.callerSessionParticipantId,
    };
  }

  if (input.callerParticipantType !== "FACILITATOR") {
    return {
      accepted: false,
      httpStatus: 403,
      reason: "remote_source_requires_facilitator",
    };
  }
  if (!input.requestedSessionParticipantId) {
    return {
      accepted: false,
      httpStatus: 400,
      reason: "remote_source_requires_session_participant_id",
    };
  }

  const target = await input.findSessionParticipantById(input.requestedSessionParticipantId);
  if (!target || target.sessionId !== input.sessionId) {
    return {
      accepted: false,
      httpStatus: 403,
      reason: "remote_source_participant_outside_session",
    };
  }
  if (target.type !== "PARTICIPANT") {
    return {
      accepted: false,
      httpStatus: 403,
      reason: "remote_source_target_must_be_participant",
    };
  }
  if (target.id === input.callerSessionParticipantId) {
    return {
      accepted: false,
      httpStatus: 403,
      reason: "remote_source_target_must_not_be_reporter",
    };
  }

  return {
    accepted: true,
    targetSessionParticipantId: target.id,
  };
}
