import type { TelemetryQuality } from "@/lib/transcription/mapping-safety";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export const AUTO_MAPPING_HIGH_CONFIDENCE = 0.6;
export const AUTO_MAPPING_MIN_MARGIN = 0.12;
export const AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD = 0.2;
export const AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE = 0.12;

const GLOBAL_OVERRIDE_BLOCKING_WARNINGS = new Set([
  "missing_participant_coverage",
  "participant_low_activity",
  "telemetry_imbalanced",
  "alignment_unreliable",
  "no_activity_for_participant",
  "low_activity_for_participant",
  "row_imbalance",
  "duration_imbalance",
]);

type GlobalAssignmentCandidate = {
  assignment: SpeakerMapping;
  totalScore: number;
};

export function computeGlobalAssignmentCandidates(params: {
  speakerLabels: string[];
  participantIds: string[];
  scoreMatrix: Record<string, Record<string, unknown>>;
}): GlobalAssignmentCandidate[] {
  const { speakerLabels, participantIds, scoreMatrix } = params;
  const candidates: GlobalAssignmentCandidate[] = [];
  if (speakerLabels.length === 0 || participantIds.length === 0) {
    return candidates;
  }
  if (speakerLabels.length > participantIds.length) {
    return candidates;
  }

  const recurse = (
    index: number,
    usedParticipants: Set<string>,
    currentAssignment: SpeakerMapping,
    currentScore: number,
  ) => {
    if (index >= speakerLabels.length) {
      candidates.push({
        assignment: { ...currentAssignment },
        totalScore: Math.round(currentScore * 1000) / 1000,
      });
      return;
    }

    const speakerLabel = speakerLabels[index]!;
    for (const participantId of participantIds) {
      if (usedParticipants.has(participantId)) continue;
      const rawScore = (scoreMatrix[speakerLabel]?.[participantId] as {
        coverage?: number;
      } | null)?.coverage;
      const score = typeof rawScore === "number" ? rawScore : 0;
      currentAssignment[speakerLabel] = participantId;
      usedParticipants.add(participantId);
      recurse(index + 1, usedParticipants, currentAssignment, currentScore + score);
      usedParticipants.delete(participantId);
      delete currentAssignment[speakerLabel];
    }
  };

  recurse(0, new Set<string>(), {}, 0);
  return candidates.sort((a, b) => b.totalScore - a.totalScore);
}

export function computeGlobalAssignmentMargin(params: {
  speakerLabels: string[];
  participantIds: string[];
  scoreMatrix: Record<string, Record<string, unknown>>;
}): {
  best: GlobalAssignmentCandidate | null;
  secondBest: GlobalAssignmentCandidate | null;
  margin: number | null;
} {
  const candidates = computeGlobalAssignmentCandidates(params);
  const best = candidates[0] ?? null;
  const secondBest = candidates[1] ?? null;
  const margin =
    best && secondBest
      ? Math.round((best.totalScore - secondBest.totalScore) * 1000) / 1000
      : null;

  return { best, secondBest, margin };
}

export function shouldAllowGlobalMarginOverride(params: {
  weakMargin: boolean;
  speakerLabelCount: number;
  participantCandidateCount: number;
  allSpeakersCovered: boolean;
  mappingSafetySafe: boolean;
  globalAssignmentMargin: number | null;
  selectedCoverageBySpeaker: Record<string, number | null>;
  telemetryQuality: TelemetryQuality;
}): boolean {
  if (!params.weakMargin) return false;
  if (params.speakerLabelCount !== 2) return false;
  if (params.participantCandidateCount !== 2) return false;
  if (!params.allSpeakersCovered) return false;
  if (!params.mappingSafetySafe) return false;
  if (
    params.globalAssignmentMargin == null ||
    params.globalAssignmentMargin < AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD
  ) {
    return false;
  }

  const hasLowOrMissingSelectedCoverage = Object.values(
    params.selectedCoverageBySpeaker,
  ).some(
    (coverage) =>
      coverage == null ||
      coverage < AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
  );
  if (hasLowOrMissingSelectedCoverage) return false;

  if (params.telemetryQuality.participantCoverage < 2) return false;
  if (params.telemetryQuality.activeParticipantsDuringRecording < 2) return false;
  if (params.telemetryQuality.shortIntervalCount > 0) return false;

  const blockedByWarning = params.telemetryQuality.warnings.some((warning) =>
    GLOBAL_OVERRIDE_BLOCKING_WARNINGS.has(warning),
  );
  if (blockedByWarning) return false;

  return true;
}
