import { prisma } from "@/lib/prisma";
import {
  resolveSpeakerMappingCandidates,
  resolveSpeakerMappingEvidenceInterval,
  selectNegotiationSpeakerMappingCandidates,
  type SpeakerMappingParticipantCandidate,
} from "@/lib/transcription/speaker-mapping-candidates";

/**
 * Canonical speaker-mapping candidate population for both automatic mapping
 * and facilitator review. Presence uses resolveSpeakerMappingCandidates;
 * role eligibility then keeps negotiation PARTICIPANT rows only.
 */
export async function loadCanonicalSpeakerMappingCandidates(
  sessionId: string,
): Promise<SpeakerMappingParticipantCandidate[]> {
  const [session, transcript, sessionParticipants, connections] = await Promise.all([
    prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        startedAt: true,
        endedAt: true,
        negotiationStartedAt: true,
        negotiationEndedAt: true,
        recording: {
          select: {
            startedAt: true,
            endedAt: true,
          },
        },
      },
    }),
    prisma.transcript.findUnique({
      where: { sessionId },
      select: {
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.sessionParticipant.findMany({
      where: { sessionId },
      include: {
        sessionRole: { select: { name: true, sortOrder: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.sessionRoomConnection.findMany({
      where: { sessionId },
      select: {
        userId: true,
        createdAt: true,
        expiresAt: true,
        disconnectedAt: true,
        supersededAt: true,
        revokedAt: true,
      },
    }),
  ]);

  const interval = resolveSpeakerMappingEvidenceInterval({
    recordingStartedAt: session?.recording?.startedAt,
    recordingEndedAt: session?.recording?.endedAt,
    negotiationStartedAt: session?.negotiationStartedAt,
    negotiationEndedAt: session?.negotiationEndedAt,
    sessionStartedAt: session?.startedAt,
    sessionEndedAt: session?.endedAt,
    transcriptStartedAt: transcript?.startedAt,
    transcriptCompletedAt: transcript?.completedAt,
    transcriptCreatedAt: transcript?.createdAt,
    transcriptUpdatedAt: transcript?.updatedAt,
  });

  return selectNegotiationSpeakerMappingCandidates(
    resolveSpeakerMappingCandidates({
      participants: sessionParticipants,
      connections,
      interval,
    }),
  );
}
