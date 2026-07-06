import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export type SpeakerParticipantScore = {
  overlapMs: number;
  speakerDurationMs: number;
  coverage: number;
};

export type SpeakerScoreMatrix = Record<
  string,
  Record<string, SpeakerParticipantScore>
>;

type OneToOneSelection = {
  mapping: SpeakerMapping;
  confidence: Record<string, number>;
  margins: Record<string, number | null>;
};

export function selectOneToOneMappingFromScoreMatrix(
  speakerLabels: string[],
  participantIds: string[],
  scoreMatrix: SpeakerScoreMatrix,
): OneToOneSelection {
  if (speakerLabels.length === 0 || participantIds.length === 0) {
    return { mapping: {}, confidence: {}, margins: {} };
  }

  let bestScore = -1;
  let bestAssignment: Record<string, string> = {};

  const recurse = (
    index: number,
    usedParticipants: Set<string>,
    currentAssignment: Record<string, string>,
    currentScore: number,
  ) => {
    if (index >= speakerLabels.length) {
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestAssignment = { ...currentAssignment };
      }
      return;
    }

    const speakerLabel = speakerLabels[index]!;
    for (const participantId of participantIds) {
      if (usedParticipants.has(participantId)) continue;
      const score = scoreMatrix[speakerLabel]?.[participantId]?.coverage ?? 0;
      currentAssignment[speakerLabel] = participantId;
      usedParticipants.add(participantId);
      recurse(index + 1, usedParticipants, currentAssignment, currentScore + score);
      usedParticipants.delete(participantId);
      delete currentAssignment[speakerLabel];
    }
  };

  recurse(0, new Set<string>(), {}, 0);

  const mapping: SpeakerMapping = {};
  const confidence: Record<string, number> = {};
  const margins: Record<string, number | null> = {};

  for (const speakerLabel of speakerLabels) {
    const selectedParticipantId = bestAssignment[speakerLabel];
    if (!selectedParticipantId) {
      mapping[speakerLabel] = null;
      confidence[speakerLabel] = 0;
      margins[speakerLabel] = null;
      continue;
    }

    mapping[speakerLabel] = selectedParticipantId;
    const selectedCoverage =
      scoreMatrix[speakerLabel]?.[selectedParticipantId]?.coverage ?? 0;
    if (selectedCoverage <= 0) {
      mapping[speakerLabel] = null;
      confidence[speakerLabel] = 0;
      margins[speakerLabel] = null;
      continue;
    }
    confidence[speakerLabel] = Math.round(selectedCoverage * 100) / 100;

    const runnerUpCoverage = participantIds
      .filter((participantId) => participantId !== selectedParticipantId)
      .map((participantId) => scoreMatrix[speakerLabel]?.[participantId]?.coverage ?? 0)
      .sort((a, b) => b - a)[0];
    margins[speakerLabel] =
      runnerUpCoverage == null
        ? null
        : Math.round((selectedCoverage - runnerUpCoverage) * 100) / 100;
  }

  return { mapping, confidence, margins };
}
