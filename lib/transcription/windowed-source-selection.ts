type SourceSelection = {
  selectedTelemetrySource:
    | "VOX_REMOTE_STREAM_ACTIVITY"
    | "VOXIMPLANT_MIC_ACTIVITY"
    | "NONE";
  fallbackReason: string | null;
  sourceDecisionSummary: string;
  targetRuntimeDecision:
    | "remote_selected"
    | "local_fallback_selected"
    | "manual_review";
};

type Candidate = {
  available: boolean;
  reason: string | null;
  globalAssignmentMargin: number | null;
  selectedCoverageBySpeaker: Record<string, number | null>;
};

type DecisionSide = {
  sourceSelection: SourceSelection;
  remoteCandidate: Candidate;
  localCandidate: Candidate;
  remoteMapping: Record<string, string | null>;
};

function meanCoverage(values: Record<string, number | null>): number {
  const nums = Object.values(values ?? {}).filter(
    (value): value is number => typeof value === "number",
  );
  if (nums.length === 0) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function mappingsEqual(
  left: Record<string, string | null>,
  right: Record<string, string | null>,
  speakerLabels: string[],
): boolean {
  return speakerLabels.every(
    (label) => (left?.[label] ?? null) === (right?.[label] ?? null),
  );
}

function isLowMarginReason(reason: string | null): boolean {
  return reason === "ambiguous_margin" || reason === "low_margin_review_required";
}

function shouldUseOrdered(input: {
  speakerLabels: string[];
  preferRemoteStreamTelemetry: boolean;
  remoteActivityRowCount: number;
  hasPathologicalOverlap: boolean;
  raw: DecisionSide;
  ordered: DecisionSide | null;
}): { useOrdered: boolean; rejectionReason: string | null } {
  if (input.raw.sourceSelection.selectedTelemetrySource !== "NONE") {
    return { useOrdered: false, rejectionReason: "raw_already_selected" };
  }
  if (!input.hasPathologicalOverlap) {
    return { useOrdered: false, rejectionReason: "pathology_not_detected" };
  }
  if (!input.preferRemoteStreamTelemetry) {
    return { useOrdered: false, rejectionReason: "remote_preference_disabled" };
  }
  if (input.remoteActivityRowCount <= 0) {
    return { useOrdered: false, rejectionReason: "remote_source_unavailable" };
  }
  if (!isLowMarginReason(input.raw.remoteCandidate.reason)) {
    return {
      useOrdered: false,
      rejectionReason: "raw_failure_not_low_margin",
    };
  }
  if (!input.ordered) {
    return { useOrdered: false, rejectionReason: "ordered_decision_missing" };
  }
  if (
    input.ordered.sourceSelection.selectedTelemetrySource !==
    "VOX_REMOTE_STREAM_ACTIVITY"
  ) {
    return {
      useOrdered: false,
      rejectionReason: "ordered_remote_not_selected",
    };
  }
  if (!input.ordered.remoteCandidate.available) {
    return { useOrdered: false, rejectionReason: "ordered_remote_not_usable" };
  }

  const orderedDiffersFromRaw = !mappingsEqual(
    input.ordered.remoteMapping,
    input.raw.remoteMapping,
    input.speakerLabels,
  );
  if (!orderedDiffersFromRaw) {
    return { useOrdered: true, rejectionReason: null };
  }

  const orderedMargin =
    input.ordered.remoteCandidate.globalAssignmentMargin ??
    Number.NEGATIVE_INFINITY;
  const rawMargin =
    input.raw.remoteCandidate.globalAssignmentMargin ?? Number.NEGATIVE_INFINITY;
  const orderedCoverage = meanCoverage(
    input.ordered.remoteCandidate.selectedCoverageBySpeaker,
  );
  const rawCoverage = meanCoverage(input.raw.remoteCandidate.selectedCoverageBySpeaker);
  const materiallyStronger =
    orderedMargin >= rawMargin + 0.08 || orderedCoverage >= rawCoverage + 0.08;
  return materiallyStronger
    ? { useOrdered: true, rejectionReason: null }
    : {
        useOrdered: false,
        rejectionReason: "ordered_not_materially_stronger",
      };
}

function selectedCandidate(
  input: { raw: DecisionSide; ordered: DecisionSide | null },
  useOrdered: boolean,
): Candidate | null {
  const active = useOrdered && input.ordered ? input.ordered : input.raw;
  const telemetrySource = active.sourceSelection.selectedTelemetrySource;
  if (telemetrySource === "VOX_REMOTE_STREAM_ACTIVITY") return active.remoteCandidate;
  if (telemetrySource === "VOXIMPLANT_MIC_ACTIVITY") return active.localCandidate;
  return null;
}

export function decideWindowedTelemetrySelection(input: {
  speakerLabels: string[];
  preferRemoteStreamTelemetry: boolean;
  remoteActivityRowCount: number;
  hasPathologicalOverlap: boolean;
  providerWindowPathology: unknown;
  raw: DecisionSide;
  ordered: DecisionSide | null;
}) {
  const orderedEval = shouldUseOrdered(input);
  const useOrdered = orderedEval.useOrdered;
  const active = useOrdered && input.ordered ? input.ordered : input.raw;
  const selected = selectedCandidate(input, useOrdered);
  const shouldApplyLike = Boolean(
    selected &&
      active.sourceSelection.selectedTelemetrySource !== "NONE" &&
      selected.available,
  );

  return {
    selectedTelemetrySource: active.sourceSelection.selectedTelemetrySource,
    selectedWindowStrategy: useOrdered
      ? "order_normalized_windows"
      : "provider_raw_windows",
    shouldApplyLike,
    reason:
      active.sourceSelection.selectedTelemetrySource === "NONE"
        ? active.sourceSelection.fallbackReason ?? "no_reliable_telemetry_source"
        : selected?.reason ?? "selected_source_usable",
    targetRuntimeDecision: active.sourceSelection.targetRuntimeDecision,
    fallbackReason: active.sourceSelection.fallbackReason,
    sourceDecisionSummary: active.sourceSelection.sourceDecisionSummary,
    orderedWindowRejectionReason: useOrdered ? null : orderedEval.rejectionReason,
    providerWindowPathology: input.providerWindowPathology,
    rawDecision: {
      selectedTelemetrySource: input.raw.sourceSelection.selectedTelemetrySource,
      targetRuntimeDecision: input.raw.sourceSelection.targetRuntimeDecision,
      fallbackReason: input.raw.sourceSelection.fallbackReason,
      sourceDecisionSummary: input.raw.sourceSelection.sourceDecisionSummary,
      shouldApplyLike:
        input.raw.sourceSelection.selectedTelemetrySource !== "NONE" &&
        selectedCandidate(input, false)?.available === true,
      selectedMapping: input.raw.remoteMapping,
    },
    orderedDecision: input.ordered
      ? {
          selectedTelemetrySource:
            input.ordered.sourceSelection.selectedTelemetrySource,
          targetRuntimeDecision: input.ordered.sourceSelection.targetRuntimeDecision,
          fallbackReason: input.ordered.sourceSelection.fallbackReason,
          sourceDecisionSummary: input.ordered.sourceSelection.sourceDecisionSummary,
          shouldApplyLike:
            input.ordered.sourceSelection.selectedTelemetrySource !== "NONE" &&
            selectedCandidate(input, true)?.available === true,
          selectedMapping: input.ordered.remoteMapping,
        }
      : null,
  };
}
