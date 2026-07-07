import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";
import type {
  TelemetrySourceCandidate,
  TelemetrySourceSelectionResult,
} from "@/lib/transcription/speaker-mapping-telemetry-source-selection";

function meanCoverageBySpeaker(values: Record<string, number | null>): number {
  const nums = Object.values(values).filter(
    (value): value is number => typeof value === "number",
  );
  if (nums.length === 0) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function mappingEquals(
  left: SpeakerMapping,
  right: SpeakerMapping,
  speakerLabels: string[],
): boolean {
  return speakerLabels.every((label) => (left[label] ?? null) === (right[label] ?? null));
}

export function shouldApplyOrderNormalizedWindowStrategy(input: {
  rawSourceSelection: TelemetrySourceSelectionResult;
  orderedSourceSelection: TelemetrySourceSelectionResult;
  rawRemoteCandidate: TelemetrySourceCandidate;
  orderedRemoteCandidate: TelemetrySourceCandidate;
  rawRemoteMapping: SpeakerMapping;
  orderedRemoteMapping: SpeakerMapping;
  speakerLabels: string[];
  preferRemoteStreamTelemetry: boolean;
  remoteActivityRowCount: number;
  hasPathologicalOverlap: boolean;
}): boolean {
  if (input.rawSourceSelection.selectedTelemetrySource !== "NONE") return false;
  if (!input.hasPathologicalOverlap) return false;
  if (!input.preferRemoteStreamTelemetry) return false;
  if (input.remoteActivityRowCount <= 0) return false;
  if (input.rawRemoteCandidate.reason !== "ambiguous_margin") return false;
  if (input.orderedSourceSelection.selectedTelemetrySource !== "VOX_REMOTE_STREAM_ACTIVITY") {
    return false;
  }
  if (!input.orderedRemoteCandidate.available) return false;

  const orderedDiffersFromRaw = !mappingEquals(
    input.orderedRemoteMapping,
    input.rawRemoteMapping,
    input.speakerLabels,
  );
  if (!orderedDiffersFromRaw) return true;

  const orderedMargin =
    input.orderedRemoteCandidate.globalAssignmentMargin ?? Number.NEGATIVE_INFINITY;
  const rawMargin =
    input.rawRemoteCandidate.globalAssignmentMargin ?? Number.NEGATIVE_INFINITY;
  const orderedCoverage = meanCoverageBySpeaker(
    input.orderedRemoteCandidate.selectedCoverageBySpeaker,
  );
  const rawCoverage = meanCoverageBySpeaker(
    input.rawRemoteCandidate.selectedCoverageBySpeaker,
  );
  return orderedMargin >= rawMargin + 0.08 || orderedCoverage >= rawCoverage + 0.08;
}
