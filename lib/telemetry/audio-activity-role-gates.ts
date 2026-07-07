import type { ParticipantType } from "@/app/generated/prisma/enums";

export function shouldEnableLocalMicTelemetryForRole(
  participantType: ParticipantType | null | undefined,
): boolean {
  return participantType === "PARTICIPANT";
}

