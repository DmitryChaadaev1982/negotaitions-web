export type PostProcessingRailTileTone =
  | "completed"
  | "active"
  | "waiting"
  | "action_required"
  | "failed"
  | "partial"
  | "informational";

const ACTIVE_STAGES = new Set([
  "queued",
  "analyzing",
  "downloading",
  "compressing",
  "transcribing",
  "enhancing",
  "processing",
  "in_progress",
  "finalizing",
  "running",
]);

/**
 * Speaker-mapping rail chrome follows canonical mapping semantic, not the
 * step title. Structurally complete auto-applied mapping (`informational`)
 * and confirmed mapping (`ready`) share the completed/green success tile.
 * `action_required` stays non-completed. Backend AUTO_SUGGESTED / CONFIRMED
 * strings and AI gating are unchanged.
 */
export function resolveSpeakerMappingRailTileTone(
  semantic: string,
): PostProcessingRailTileTone {
  const normalized = semantic.toLowerCase();
  if (normalized === "informational" || normalized === "ready") {
    return "completed";
  }
  return resolvePostProcessingRailTileTone(semantic);
}

export function resolvePostProcessingRailTileTone(
  stage: string,
): PostProcessingRailTileTone {
  const normalized = stage.toLowerCase();
  if (
    normalized === "informational" ||
    normalized === "skipped" ||
    normalized === "historical_timeout" ||
    normalized === "running_ineligible"
  ) {
    return "informational";
  }
  if (normalized === "action_required" || normalized === "required") {
    return "action_required";
  }
  if (normalized === "ready" || normalized === "completed") {
    return "completed";
  }
  if (ACTIVE_STAGES.has(normalized)) {
    return "active";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "partial") {
    return "partial";
  }
  return "waiting";
}

export function postProcessingRailTileToneClassName(
  tone: PostProcessingRailTileTone,
): string {
  switch (tone) {
    case "informational":
      return "border-sky-500/30 bg-sky-950/20 text-sky-200";
    case "action_required":
      return "border-amber-500/30 bg-amber-950/20 text-amber-200";
    case "completed":
      return "border-emerald-500/30 bg-emerald-950/20 text-emerald-200";
    case "active":
      return "border-cyan-400/50 bg-cyan-500/15 text-cyan-100 ring-1 ring-inset ring-cyan-400/35";
    case "failed":
      return "border-rose-500/30 bg-rose-950/20 text-rose-200";
    case "partial":
      return "border-amber-500/30 bg-amber-950/20 text-amber-200";
    case "waiting":
      return "border-slate-700/50 bg-slate-900/40 text-slate-400";
  }
}
