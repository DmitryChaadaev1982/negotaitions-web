import { decideWindowedTelemetrySelection } from "../../lib/transcription/windowed-source-selection.js";

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

export function evaluateTargetRuntimeTelemetrySelection(params) {
  const { localMicOnly, remoteStreamOnly, speakerLabels } = params;
  const remoteUsable = remoteStreamOnly.shouldApplyLike && mappingCompleteOneToOne(remoteStreamOnly.selectedMapping, speakerLabels);
  const localUsable = localMicOnly.shouldApplyLike && mappingCompleteOneToOne(localMicOnly.selectedMapping, speakerLabels);
  const rawLikeSelection = {
    selectedTelemetrySource: remoteUsable
      ? "VOX_REMOTE_STREAM_ACTIVITY"
      : localUsable
        ? "VOXIMPLANT_MIC_ACTIVITY"
        : "NONE",
    fallbackReason:
      remoteUsable || localUsable
        ? remoteUsable
          ? null
          : remoteStreamOnly.reason ?? "remote_unusable"
        : "no_reliable_telemetry_source",
    sourceDecisionSummary: remoteUsable
      ? "Remote telemetry produced a complete safe mapping."
      : localUsable
        ? "Remote telemetry was unavailable/unhealthy; local telemetry fallback selected."
        : "Neither remote nor local telemetry produced a safe unambiguous mapping.",
    targetRuntimeDecision: remoteUsable
      ? "remote_selected"
      : localUsable
        ? "local_fallback_selected"
        : "manual_review",
  };
  const rawCandidate = {
    available: remoteUsable,
    reason: remoteStreamOnly.reason ?? (remoteUsable ? null : "no_reliable_telemetry_source"),
    globalAssignmentMargin: remoteStreamOnly.globalMargin ?? null,
    selectedCoverageBySpeaker: remoteStreamOnly.selectedCoverageBySpeaker ?? {},
  };
  const localCandidate = {
    available: localUsable,
    reason: localMicOnly.reason ?? (localUsable ? null : "no_reliable_telemetry_source"),
    globalAssignmentMargin: localMicOnly.globalMargin ?? null,
    selectedCoverageBySpeaker: localMicOnly.selectedCoverageBySpeaker ?? {},
  };
  const decision = decideWindowedTelemetrySelection({
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: remoteStreamOnly.activityRows ?? 1,
    hasPathologicalOverlap: params.providerWindowPathology?.hasPathologicalOverlap ?? false,
    providerWindowPathology: params.providerWindowPathology ?? null,
    raw: {
      sourceSelection: rawLikeSelection,
      remoteCandidate: rawCandidate,
      localCandidate,
      remoteMapping: remoteStreamOnly.selectedMapping ?? {},
    },
    ordered: params.ordered
      ? {
          sourceSelection: params.ordered.sourceSelection,
          remoteCandidate: params.ordered.remoteCandidate,
          localCandidate: params.ordered.localCandidate,
          remoteMapping: params.ordered.remoteMapping,
        }
      : null,
  });
  return {
    selectedTelemetrySource: decision.selectedTelemetrySource,
    fallbackReason: decision.fallbackReason,
    targetRuntimeDecision: decision.targetRuntimeDecision,
    wouldAutoApplyWithTargetLogic: decision.shouldApplyLike,
    selectedWindowStrategy: decision.selectedWindowStrategy,
    sourceDecisionSummary: decision.sourceDecisionSummary,
    rawDecision: decision.rawDecision,
    orderedDecision: decision.orderedDecision,
  };
}
