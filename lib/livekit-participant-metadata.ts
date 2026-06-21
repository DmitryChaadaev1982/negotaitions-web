import type { ParticipantType } from "@/app/generated/prisma/enums";

export type LiveKitParticipantMetadata = {
  participantType: ParticipantType;
  caseRoleName: string | null;
};

export function buildLiveKitParticipantMetadata(
  participantType: ParticipantType,
  caseRoleName: string | null = null,
): string {
  return JSON.stringify({
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
      participantType: parsed.participantType,
      caseRoleName:
        typeof parsed.caseRoleName === "string" ? parsed.caseRoleName : null,
    };
  } catch {
    return null;
  }
}
