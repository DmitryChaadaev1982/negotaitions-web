import { ParticipantType } from "@/app/generated/prisma/client";

export type SpeakerMappingParticipantRow = {
  id: string;
  userId: string | null;
  displayName: string;
  type: ParticipantType;
  createdAt: Date;
  sessionRole: { name: string; sortOrder: number } | null;
};

export type SpeakerMappingConnectionRow = {
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  disconnectedAt: Date | null;
  supersededAt: Date | null;
  revokedAt: Date | null;
};

export type SpeakerMappingIntervalSource = {
  recordingStartedAt?: Date | null;
  recordingEndedAt?: Date | null;
  negotiationStartedAt?: Date | null;
  negotiationEndedAt?: Date | null;
  sessionStartedAt?: Date | null;
  sessionEndedAt?: Date | null;
  transcriptStartedAt?: Date | null;
  transcriptCompletedAt?: Date | null;
  transcriptCreatedAt?: Date | null;
  transcriptUpdatedAt?: Date | null;
};

export type SpeakerMappingParticipantCandidate = {
  sessionParticipantId: string;
  displayName: string;
  participantType: ParticipantType;
  roleName: string | null;
};

function firstDate(...values: Array<Date | null | undefined>) {
  return values.find((value): value is Date => value instanceof Date) ?? null;
}

export function resolveSpeakerMappingEvidenceInterval(
  source: SpeakerMappingIntervalSource,
): { start: Date; end: Date } | null {
  const start = firstDate(
    source.recordingStartedAt,
    source.negotiationStartedAt,
    source.sessionStartedAt,
    source.transcriptStartedAt,
    source.transcriptCreatedAt,
  );
  const end = firstDate(
    source.recordingEndedAt,
    source.negotiationEndedAt,
    source.sessionEndedAt,
    source.transcriptCompletedAt,
    source.transcriptUpdatedAt,
  );

  if (!start || !end || end <= start) {
    return null;
  }

  return { start, end };
}

function effectiveConnectionEnd(connection: SpeakerMappingConnectionRow) {
  return (
    connection.disconnectedAt ??
    connection.supersededAt ??
    connection.revokedAt ??
    connection.expiresAt
  );
}

export function connectionOverlapsInterval(
  connection: SpeakerMappingConnectionRow,
  interval: { start: Date; end: Date },
) {
  return connection.createdAt < interval.end && effectiveConnectionEnd(connection) > interval.start;
}

export function resolveSpeakerMappingCandidates({
  participants,
  connections,
  interval,
}: {
  participants: SpeakerMappingParticipantRow[];
  connections: SpeakerMappingConnectionRow[];
  interval: { start: Date; end: Date } | null;
}): SpeakerMappingParticipantCandidate[] {
  if (!interval) {
    return [];
  }

  const historicallyPresentUserIds = new Set(
    connections
      .filter((connection) => connectionOverlapsInterval(connection, interval))
      .map((connection) => connection.userId),
  );
  const candidatesByUserId = new Map<string, SpeakerMappingParticipantCandidate>();

  for (const participant of [...participants].sort((a, b) => {
    const roleA = a.sessionRole?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const roleB = b.sessionRole?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (roleA !== roleB) return roleA - roleB;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.createdAt.getTime() - b.createdAt.getTime();
  })) {
    if (!participant.userId || !historicallyPresentUserIds.has(participant.userId)) {
      continue;
    }
    if (candidatesByUserId.has(participant.userId)) {
      continue;
    }
    candidatesByUserId.set(participant.userId, {
      sessionParticipantId: participant.id,
      displayName: participant.displayName,
      participantType: participant.type,
      roleName: participant.sessionRole?.name ?? null,
    });
  }

  return Array.from(candidatesByUserId.values());
}

export function selectNegotiationSpeakerMappingCandidates(
  candidates: SpeakerMappingParticipantCandidate[],
): SpeakerMappingParticipantCandidate[] {
  return candidates.filter(
    (candidate) => candidate.participantType === ParticipantType.PARTICIPANT,
  );
}
