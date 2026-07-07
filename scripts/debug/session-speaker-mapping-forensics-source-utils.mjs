export const REQUIRED_SOURCE_SCENARIOS = [
  "current_runtime",
  "local_mic_only",
  "remote_stream_only",
  "local_mic_order_normalized_windows",
  "remote_stream_order_normalized_windows",
  "target_order_normalized_runtime",
  "combined_naive",
  "combined_deduplicated",
];

function mappingCompleteOneToOne(mapping, speakerLabels) {
  const mapped = speakerLabels.map((label) => mapping?.[label]).filter((value) => Boolean(value));
  return mapped.length === speakerLabels.length && new Set(mapped).size === speakerLabels.length;
}

function coverageAverage(selectedCoverageBySpeaker) {
  const values = Object.values(selectedCoverageBySpeaker ?? {}).filter(
    (value) => typeof value === "number",
  );
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateRemoteSourceRecommendation(params) {
  const { currentRuntime, localMicOnly, remoteStreamOnly, speakerLabels } = params;
  const remoteCouldHelp =
    (!currentRuntime.shouldApply || !localMicOnly.shouldApply) &&
    mappingCompleteOneToOne(remoteStreamOnly.mapping, speakerLabels) &&
    ((remoteStreamOnly.globalMargin ?? Number.NEGATIVE_INFINITY) >=
      (localMicOnly.globalMargin ?? Number.NEGATIVE_INFINITY) + 0.1 ||
      coverageAverage(remoteStreamOnly.selectedCoverageBySpeaker) >=
        coverageAverage(localMicOnly.selectedCoverageBySpeaker) + 0.1);
  const keepLocalFallback =
    !remoteCouldHelp ||
    !mappingCompleteOneToOne(remoteStreamOnly.mapping, speakerLabels) ||
    remoteStreamOnly.activityRows === 0;

  const recommendations = [];
  if (remoteCouldHelp) recommendations.push("REMOTE_STREAM_SOURCE_WOULD_HELP");
  if (keepLocalFallback) recommendations.push("KEEP_LOCAL_FALLBACK");
  return recommendations;
}

function meanCoverage(selectedCoverageBySpeaker) {
  const values = Object.values(selectedCoverageBySpeaker ?? {}).filter(
    (value) => typeof value === "number",
  );
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateTargetRuntimeTelemetrySelection(params) {
  const { localMicOnly, remoteStreamOnly, speakerLabels } = params;
  const remoteComplete = mappingCompleteOneToOne(remoteStreamOnly.selectedMapping, speakerLabels);
  const localComplete = mappingCompleteOneToOne(localMicOnly.selectedMapping, speakerLabels);
  const remoteValid = remoteStreamOnly.shouldApplyLike && remoteComplete;
  const localValid = localMicOnly.shouldApplyLike && localComplete;

  if (remoteValid && !localValid) {
    return {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      targetRuntimeDecision: "remote_selected",
      wouldAutoApplyWithTargetLogic: true,
    };
  }
  if (!remoteValid && localValid) {
    return {
      selectedTelemetrySource: "VOXIMPLANT_MIC_ACTIVITY",
      fallbackReason: remoteStreamOnly.reason ?? "remote_unusable",
      targetRuntimeDecision: "local_fallback_selected",
      wouldAutoApplyWithTargetLogic: true,
    };
  }
  if (!remoteValid && !localValid) {
    return {
      selectedTelemetrySource: "NONE",
      fallbackReason: "no_reliable_telemetry_source",
      targetRuntimeDecision: "manual_review",
      wouldAutoApplyWithTargetLogic: false,
    };
  }

  const sameMapping = speakerLabels.every(
    (label) =>
      (remoteStreamOnly.selectedMapping?.[label] ?? null) ===
      (localMicOnly.selectedMapping?.[label] ?? null),
  );
  if (sameMapping) {
    return {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      targetRuntimeDecision: "remote_selected",
      wouldAutoApplyWithTargetLogic: true,
    };
  }

  const remoteCoverage = meanCoverage(remoteStreamOnly.selectedCoverageBySpeaker);
  const localCoverage = meanCoverage(localMicOnly.selectedCoverageBySpeaker);
  const remoteMargin = remoteStreamOnly.globalMargin ?? Number.NEGATIVE_INFINITY;
  const localMargin = localMicOnly.globalMargin ?? Number.NEGATIVE_INFINITY;
  const remoteClearlyBetter =
    remoteCoverage >= localCoverage + 0.05 && remoteMargin >= localMargin + 0.05;
  if (remoteClearlyBetter) {
    return {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      targetRuntimeDecision: "remote_selected",
      wouldAutoApplyWithTargetLogic: true,
    };
  }

  return {
    selectedTelemetrySource: "NONE",
    fallbackReason: "sources_disagree_without_clear_winner",
    targetRuntimeDecision: "manual_review",
    wouldAutoApplyWithTargetLogic: false,
  };
}
