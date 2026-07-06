export const REQUIRED_SOURCE_SCENARIOS = [
  "current_runtime",
  "local_mic_only",
  "remote_stream_only",
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
