function meanCoverage(values) {
  const nums = Object.values(values ?? {}).filter(
    (value) => typeof value === "number",
  );
  if (nums.length === 0) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function mappingsEqual(left, right, speakerLabels) {
  return speakerLabels.every(
    (label) => (left?.[label] ?? null) === (right?.[label] ?? null),
  );
}

function shouldUseOrdered(input) {
  if (input.raw.sourceSelection.selectedTelemetrySource !== "NONE") return false;
  if (!input.hasPathologicalOverlap) return false;
  if (!input.preferRemoteStreamTelemetry) return false;
  if (input.remoteActivityRowCount <= 0) return false;
  if (input.raw.remoteCandidate.reason !== "ambiguous_margin") return false;
  if (!input.ordered) return false;
  if (input.ordered.sourceSelection.selectedTelemetrySource !== "VOX_REMOTE_STREAM_ACTIVITY") {
    return false;
  }
  if (!input.ordered.remoteCandidate.available) return false;

  const orderedDiffersFromRaw = !mappingsEqual(
    input.ordered.remoteMapping,
    input.raw.remoteMapping,
    input.speakerLabels,
  );
  if (!orderedDiffersFromRaw) return true;

  const orderedMargin =
    input.ordered.remoteCandidate.globalAssignmentMargin ??
    Number.NEGATIVE_INFINITY;
  const rawMargin =
    input.raw.remoteCandidate.globalAssignmentMargin ?? Number.NEGATIVE_INFINITY;
  const orderedCoverage = meanCoverage(
    input.ordered.remoteCandidate.selectedCoverageBySpeaker,
  );
  const rawCoverage = meanCoverage(
    input.raw.remoteCandidate.selectedCoverageBySpeaker,
  );
  return orderedMargin >= rawMargin + 0.08 || orderedCoverage >= rawCoverage + 0.08;
}

function selectedCandidate(input, useOrdered) {
  const active = useOrdered && input.ordered ? input.ordered : input.raw;
  const telemetrySource = active.sourceSelection.selectedTelemetrySource;
  if (telemetrySource === "VOX_REMOTE_STREAM_ACTIVITY") return active.remoteCandidate;
  if (telemetrySource === "VOXIMPLANT_MIC_ACTIVITY") return active.localCandidate;
  return null;
}

export function decideWindowedTelemetrySelection(input) {
  const useOrdered = shouldUseOrdered(input);
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
