import {
  AUTO_MAPPING_MIN_MARGIN,
  AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
} from "@/lib/transcription/auto-trigger-mapping-core";

export type SpeakerMappingTelemetrySource =
  | "VOX_REMOTE_STREAM_ACTIVITY"
  | "VOXIMPLANT_MIC_ACTIVITY"
  | "NONE";

export type TelemetrySourceCandidate = {
  source: Exclude<SpeakerMappingTelemetrySource, "NONE">;
  available: boolean;
  reason: string | null;
  mapping: Record<string, string | null>;
  selectedCoverageBySpeaker: Record<string, number | null>;
  selectedMargins: Record<string, number | null>;
  globalAssignmentMargin: number | null;
  blockingWarnings: string[];
  hasBlockingWarnings: boolean;
};

export type TelemetrySourceSelectionResult = {
  selectedTelemetrySource: SpeakerMappingTelemetrySource;
  fallbackReason: string | null;
  sourceDecisionSummary: string;
  targetRuntimeDecision: "remote_selected" | "local_fallback_selected" | "manual_review";
};

function meanCoverage(values: Record<string, number | null>): number {
  const nums = Object.values(values).filter(
    (value): value is number => typeof value === "number",
  );
  if (nums.length === 0) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function hasStrictlyPositiveMargin(
  margins: Record<string, number | null>,
  speakerLabels: string[],
): boolean {
  return speakerLabels.every((label) => (margins[label] ?? 0) > 0);
}

function allSpeakersCovered(
  mapping: Record<string, string | null>,
  speakerLabels: string[],
): boolean {
  return (
    speakerLabels.length > 0 &&
    speakerLabels.every((label) => Boolean(mapping[label]))
  );
}

function hasSafeOneToOne(
  mapping: Record<string, string | null>,
  speakerLabels: string[],
): boolean {
  const mapped = speakerLabels
    .map((label) => mapping[label])
    .filter((value): value is string => Boolean(value));
  return mapped.length === speakerLabels.length && new Set(mapped).size === mapped.length;
}

function meetsCoverageThreshold(
  selectedCoverageBySpeaker: Record<string, number | null>,
  speakerLabels: string[],
): boolean {
  return speakerLabels.every((label) => {
    const coverage = selectedCoverageBySpeaker[label];
    return (
      typeof coverage === "number" &&
      coverage >= AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE
    );
  });
}

function candidateIsUsable(
  candidate: TelemetrySourceCandidate,
  speakerLabels: string[],
): boolean {
  if (!candidate.available) return false;
  if (!allSpeakersCovered(candidate.mapping, speakerLabels)) return false;
  if (!meetsCoverageThreshold(candidate.selectedCoverageBySpeaker, speakerLabels)) return false;
  if (!hasStrictlyPositiveMargin(candidate.selectedMargins, speakerLabels)) return false;
  if (speakerLabels.length > 1 && !hasSafeOneToOne(candidate.mapping, speakerLabels)) return false;
  if (candidate.hasBlockingWarnings) return false;
  return true;
}

function mappingsEqual(
  left: Record<string, string | null>,
  right: Record<string, string | null>,
  speakerLabels: string[],
): boolean {
  return speakerLabels.every((label) => (left[label] ?? null) === (right[label] ?? null));
}

function remoteClearlyBetter(
  remote: TelemetrySourceCandidate,
  local: TelemetrySourceCandidate,
): boolean {
  if (remote.hasBlockingWarnings) return false;
  const remoteCoverage = meanCoverage(remote.selectedCoverageBySpeaker);
  const localCoverage = meanCoverage(local.selectedCoverageBySpeaker);
  const remoteMargin = remote.globalAssignmentMargin ?? Number.NEGATIVE_INFINITY;
  const localMargin = local.globalAssignmentMargin ?? Number.NEGATIVE_INFINITY;
  return remoteCoverage >= localCoverage + 0.05 && remoteMargin >= localMargin + 0.05;
}

export function selectTelemetrySourceForSpeakerMapping(input: {
  speakerLabels: string[];
  preferRemoteStreamTelemetry: boolean;
  remote: TelemetrySourceCandidate;
  local: TelemetrySourceCandidate;
}): TelemetrySourceSelectionResult {
  const { speakerLabels, preferRemoteStreamTelemetry, remote, local } = input;
  if (!preferRemoteStreamTelemetry) {
    if (candidateIsUsable(local, speakerLabels)) {
      return {
        selectedTelemetrySource: "VOXIMPLANT_MIC_ACTIVITY",
        fallbackReason: "remote_preference_disabled",
        sourceDecisionSummary: "Remote preference disabled; using local telemetry.",
        targetRuntimeDecision: "local_fallback_selected",
      };
    }
    return {
      selectedTelemetrySource: "NONE",
      fallbackReason: "remote_preference_disabled_local_unusable",
      sourceDecisionSummary:
        "Remote preference disabled and local telemetry was not safe for auto mapping.",
      targetRuntimeDecision: "manual_review",
    };
  }

  const remoteUsable = candidateIsUsable(remote, speakerLabels);
  const localUsable = candidateIsUsable(local, speakerLabels);

  if (remoteUsable && !localUsable) {
    return {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      sourceDecisionSummary: "Remote telemetry produced a complete safe mapping.",
      targetRuntimeDecision: "remote_selected",
    };
  }
  if (!remoteUsable && localUsable) {
    return {
      selectedTelemetrySource: "VOXIMPLANT_MIC_ACTIVITY",
      fallbackReason: remote.reason ?? "remote_unusable",
      sourceDecisionSummary:
        "Remote telemetry was unavailable/unhealthy; local telemetry fallback selected.",
      targetRuntimeDecision: "local_fallback_selected",
    };
  }
  if (!remoteUsable && !localUsable) {
    return {
      selectedTelemetrySource: "NONE",
      fallbackReason: "no_reliable_telemetry_source",
      sourceDecisionSummary:
        "Neither remote nor local telemetry produced a safe unambiguous mapping.",
      targetRuntimeDecision: "manual_review",
    };
  }

  if (mappingsEqual(remote.mapping, local.mapping, speakerLabels)) {
    return {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      sourceDecisionSummary:
        "Both telemetry sources agreed; remote telemetry preferred.",
      targetRuntimeDecision: "remote_selected",
    };
  }

  if (remoteClearlyBetter(remote, local)) {
    return {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      sourceDecisionSummary:
        "Both sources were valid but remote quality was clearly better.",
      targetRuntimeDecision: "remote_selected",
    };
  }

  return {
    selectedTelemetrySource: "NONE",
    fallbackReason: "sources_disagree_without_clear_winner",
    sourceDecisionSummary:
      "Remote and local sources disagreed without a clear quality winner.",
    targetRuntimeDecision: "manual_review",
  };
}

export function sourceBlockingWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) =>
    [
      "missing_participant_coverage",
      "participant_low_activity",
      "telemetry_imbalanced",
      "alignment_unreliable",
      "no_activity_for_participant",
      "low_activity_for_participant",
      "row_imbalance",
      "duration_imbalance",
    ].includes(warning),
  );
}

export function hasWeakMargins(
  selectedMargins: Record<string, number | null>,
  speakerLabels: string[],
): boolean {
  return speakerLabels.some(
    (label) =>
      selectedMargins[label] != null &&
      (selectedMargins[label] as number) < AUTO_MAPPING_MIN_MARGIN,
  );
}
