import type { ParticipantType } from "@/app/generated/prisma/enums";

export type LiveKitParticipantMetadata = {
  participantId: string | null;
  participantType: ParticipantType;
  caseRoleName: string | null;
};

export function buildLiveKitParticipantMetadata(
  participantId: string | null,
  participantType: ParticipantType,
  caseRoleName: string | null = null,
): string {
  return JSON.stringify({
    participantId,
    participantType,
    caseRoleName,
  } satisfies LiveKitParticipantMetadata);
}

export function parseLiveKitParticipantMetadata(
  metadata: string | undefined,
): LiveKitParticipantMetadata | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as Partial<LiveKitParticipantMetadata>;

    if (
      parsed.participantType !== "PARTICIPANT" &&
      parsed.participantType !== "OBSERVER" &&
      parsed.participantType !== "FACILITATOR"
    ) {
      return null;
    }

    return {
      participantId:
        typeof parsed.participantId === "string" ? parsed.participantId : null,
      participantType: parsed.participantType,
      caseRoleName:
        typeof parsed.caseRoleName === "string" ? parsed.caseRoleName : null,
    };
  } catch {
    return null;
  }
}
