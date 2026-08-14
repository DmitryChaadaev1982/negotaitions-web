import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";
import {
  filterPersonalFeedbackForParticipant,
  sanitizeSharedAiAnalysisForParticipant,
} from "@/lib/privacy/serializers";

type ParticipantIdentity = {
  participantId: string;
  displayName: string;
};

type SessionParticipantIdentity = {
  id: string;
  displayName: string;
  type: string;
};

export function getAnalysisForFacilitator(
  fullAnalysis: NegotiationAnalysisOutput | null,
): NegotiationAnalysisOutput | null {
  return fullAnalysis;
}

export function getAnalysisForParticipant(
  sharedAnalysis: NegotiationAnalysisOutput | null,
  participant: ParticipantIdentity,
  participants: SessionParticipantIdentity[],
): NegotiationAnalysisOutput | null {
  if (!sharedAnalysis) {
    return null;
  }
  const sanitizedShared = sanitizeSharedAiAnalysisForParticipant(
    sharedAnalysis,
  ) as NegotiationAnalysisOutput;
  return filterPersonalFeedbackForParticipant(sanitizedShared, {
    participantId: participant.participantId,
    displayName: participant.displayName,
  }, participants);
}

export function getAnalysisForObserver(
  sharedAnalysis: NegotiationAnalysisOutput | null,
): NegotiationAnalysisOutput | null {
  if (!sharedAnalysis) {
    return null;
  }
  const sanitizedShared = sanitizeSharedAiAnalysisForParticipant(
    sharedAnalysis,
  ) as NegotiationAnalysisOutput;
  const observerSafe = {
    ...sanitizedShared,
  } as Record<string, unknown>;
  delete observerSafe.participantPersonalFeedback;
  return observerSafe as NegotiationAnalysisOutput;
}
