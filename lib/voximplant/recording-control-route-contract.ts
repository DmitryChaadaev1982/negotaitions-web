import { ParticipantType } from "@/app/generated/prisma/client";

export type RecordingControllerClaims = {
  participantId: string;
  controllerUserId: string;
  controllerRole: string;
  canControlRecording: boolean;
};

export function buildRecordingControllerClaims(input: {
  participantId: string;
  participantType: ParticipantType;
  userId?: string | null;
}): RecordingControllerClaims {
  const participantId = input.participantId.trim();
  if (!participantId) {
    throw new Error("participantId is required.");
  }

  if (input.participantType !== ParticipantType.FACILITATOR) {
    throw new Error("Only facilitators can issue direct recording control commands.");
  }

  return {
    participantId,
    controllerUserId: input.userId?.trim() || `session_participant:${participantId}`,
    controllerRole: "facilitator",
    canControlRecording: true,
  };
}
