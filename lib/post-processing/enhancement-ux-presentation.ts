import {
  isActiveTranscriptGenerationStage,
  isEnhancementStatusRunning,
} from "@/lib/post-processing/projection";
import {
  parseTranscriptEnhancementJob,
  projectTranscriptEnhancementStatus,
  type TranscriptEnhancementProgress,
} from "@/lib/services/transcript-enhancement-job";
import {
  digestPublishedSegmentText,
  parseTranscriptEnhancementPublication,
} from "@/lib/services/transcript-enhancement-publication";

export type EnhancementUxState =
  | "IDLE"
  | "TRANSCRIPTION_RUNNING"
  | "RAW_READY_ENHANCEMENT_STARTING"
  | "ENHANCEMENT_RUNNING"
  | "ENHANCEMENT_RETRYING"
  | "ENHANCEMENT_RUNNING_INELIGIBLE"
  | "ENHANCEMENT_TERMINAL_PARTIAL"
  | "ENHANCEMENT_COMPLETED"
  | "ENHANCEMENT_FAILED"
  | "ENHANCEMENT_CONTINUED"
  | "ENHANCEMENT_HISTORICAL_TIMEOUT"
  | "RETRANSCRIPTION_RUNNING";

export type EnhancementUxProgress = {
  completedChunks: number;
  totalChunks: number;
  runningChunks?: number;
  pendingChunks?: number;
  retryableFailedChunks?: number;
  permanentFailedChunks?: number;
};

export type EnhancementUxInput = {
  transcriptionStage?: string | null;
  retranscriptionLocked?: boolean;
  currentForGeneration?: boolean;
  uiStatus?: string | null;
  executionStatus?: string | null;
  publicationEligible?: boolean | null;
  terminalQuality?: string | null;
  cancelReason?: string | null;
  skipReason?: string | null;
  progress?: EnhancementUxProgress | null;
};

export function clampEnhancementProgress(
  progress: EnhancementUxProgress | null | undefined,
): { completed: number; total: number } | null {
  if (!progress || !Number.isFinite(progress.totalChunks) || progress.totalChunks <= 0) {
    return null;
  }
  const total = Math.floor(progress.totalChunks);
  const completed = Math.min(
    total,
    Math.max(0, Math.floor(progress.completedChunks ?? 0)),
  );
  return { completed, total };
}

export function shouldShowDurableEnhancementProgress(input: EnhancementUxInput): boolean {
  if (input.publicationEligible !== true) return false;
  if (!isEnhancementExecutionInFlight(input)) return false;
  return clampEnhancementProgress(input.progress) != null;
}

export function isEnhancementExecutionInFlight(input: EnhancementUxInput): boolean {
  const execution = input.executionStatus ?? input.uiStatus;
  return (
    execution === "QUEUED" ||
    execution === "RUNNING" ||
    execution === "IN_PROGRESS" ||
    isEnhancementStatusRunning(input.uiStatus)
  );
}

export function resolveEnhancementUxState(input: EnhancementUxInput): EnhancementUxState {
  if (input.retranscriptionLocked) {
    return "RETRANSCRIPTION_RUNNING";
  }
  if (isActiveTranscriptGenerationStage(input.transcriptionStage)) {
    return "TRANSCRIPTION_RUNNING";
  }
  if (input.currentForGeneration === false) {
    return "IDLE";
  }

  const skipReason = input.skipReason ?? "";
  const uiStatus = input.uiStatus ?? "";
  const execution = input.executionStatus ?? "";
  const publicationEligible = input.publicationEligible === true;
  const inFlight = isEnhancementExecutionInFlight(input);

  if (inFlight && publicationEligible) {
    if ((input.progress?.retryableFailedChunks ?? 0) > 0) {
      return "ENHANCEMENT_RETRYING";
    }
    if (execution === "QUEUED" || uiStatus === "QUEUED") {
      return "RAW_READY_ENHANCEMENT_STARTING";
    }
    return "ENHANCEMENT_RUNNING";
  }

  if (inFlight && input.publicationEligible === false) {
    return "ENHANCEMENT_RUNNING_INELIGIBLE";
  }

  if (
    execution === "CANCELLED_FOR_PUBLICATION" ||
    input.cancelReason === "continue_with_current"
  ) {
    return "ENHANCEMENT_CONTINUED";
  }

  if (input.terminalQuality === "PARTIAL" || uiStatus === "PARTIAL") {
    return "ENHANCEMENT_TERMINAL_PARTIAL";
  }

  if (uiStatus === "COMPLETED" || (execution === "COMPLETED" && input.terminalQuality === "COMPLETED")) {
    return "ENHANCEMENT_COMPLETED";
  }

  if (uiStatus === "FAILED" || execution === "FAILED" || input.terminalQuality === "FAILED") {
    return "ENHANCEMENT_FAILED";
  }

  if (
    uiStatus === "SKIPPED" ||
    skipReason === "timeout" ||
    skipReason === "historical_skipped"
  ) {
    return "ENHANCEMENT_HISTORICAL_TIMEOUT";
  }

  return "IDLE";
}

export function resolvePublishedTranscriptKind(input: EnhancementUxInput): "raw" | "enhanced" {
  return resolveEnhancementUxState(input) === "ENHANCEMENT_COMPLETED" ? "enhanced" : "raw";
}

export function enhancementUxInputFromMetadata(processingMetadata: unknown): EnhancementUxInput {
  const job = parseTranscriptEnhancementJob(processingMetadata);
  const projected = projectTranscriptEnhancementStatus(processingMetadata);
  return {
    uiStatus: projected.uiStatus,
    executionStatus: job.executionStatus,
    publicationEligible: job.publicationEligible,
    terminalQuality: job.terminalQuality,
    cancelReason: job.cancelReason,
    skipReason: job.skipReason,
  };
}

/**
 * Transcript-level published kind for latest-attempt presentation
 * (Step 2 completed vs raw). Per-segment green/raw/edited uses publication
 * identity via `resolveSegmentEnhancementProvenance`.
 */
export type TurnEnhancementProvenance = "applied" | "raw" | "edited";

export function resolveTurnEnhancementProvenance(
  input: EnhancementUxInput,
): Exclude<TurnEnhancementProvenance, "edited"> {
  return resolvePublishedTranscriptKind(input) === "enhanced" ? "applied" : "raw";
}

function currentTextMatchesRaw(currentText: string, rawText: string | null | undefined): boolean {
  return rawText != null && currentText === rawText;
}

/**
 * Per-segment current provenance is derived, not a persisted lifecycle.
 *
 * Classification order:
 * 1. Compare current text to the immutable SpeechKit backup independently.
 * 2. Decide whether published-enhanced evidence applies to this generation.
 * 3. If applicable, compare the orderIndex digest.
 * 4. Classify.
 *
 * `applied` (green): current text is not SpeechKit raw and still matches
 * the last applicable successful enhancement publication for this
 * orderIndex. No-raw manual segments (`rawText == null`) may be applied
 * when a digest exists, including AI copy-through of the manual input.
 * `raw` (gray): a non-null SpeechKit backup exists and current text equals
 * it. Null raw authority is never classified `raw`.
 * `edited` (manual): current text is not SpeechKit raw and either has no
 * applicable published-enhanced evidence (including generation mismatch)
 * or does not match the applicable digest.
 *
 * Generation mismatch removes the applied option only. It does not
 * mean the current text is raw.
 *
 * Latest attempt status is not the green prerequisite: Repeat Improve
 * RUNNING/Skip/FAILED must not erase Run A's published provenance.
 */
export function resolveSegmentEnhancementProvenance(params: {
  publication: {
    retranscribeCount: number;
    segmentDigestByOrderIndex: Record<string, string>;
  } | null;
  currentRetranscribeCount: number;
  orderIndex: number;
  publishedText: string;
  rawText?: string | null;
}): TurnEnhancementProvenance {
  const matchesRaw = currentTextMatchesRaw(params.publishedText, params.rawText);
  if (matchesRaw) {
    return "raw";
  }

  const publication = params.publication;
  if (
    publication != null &&
    publication.retranscribeCount === params.currentRetranscribeCount
  ) {
    const expected = publication.segmentDigestByOrderIndex[String(params.orderIndex)];
    if (expected && digestPublishedSegmentText(params.publishedText) === expected) {
      return "applied";
    }
  }

  return "edited";
}

export function countSegmentEnhancementProvenance(params: {
  publication: {
    retranscribeCount: number;
    segmentDigestByOrderIndex: Record<string, string>;
  } | null;
  currentRetranscribeCount: number;
  segments: ReadonlyArray<{ orderIndex: number; text: string; rawText?: string | null }>;
}): { total: number; applied: number; raw: number; edited: number } {
  let applied = 0;
  let raw = 0;
  let edited = 0;
  for (const segment of params.segments) {
    const provenance = resolveSegmentEnhancementProvenance({
      publication: params.publication,
      currentRetranscribeCount: params.currentRetranscribeCount,
      orderIndex: segment.orderIndex,
      publishedText: segment.text,
      rawText: segment.rawText,
    });
    if (provenance === "applied") applied += 1;
    else if (provenance === "edited") edited += 1;
    else raw += 1;
  }
  return { total: params.segments.length, applied, raw, edited };
}

/**
 * Presentation-only generation fence. A leftover COMPLETED enhancement job
 * from generation N is not current for generation N+1. Missing job
 * generation identity is not invented as stale.
 */
export function isEnhancementCurrentForTranscriptGeneration(params: {
  jobRetranscribeCount: number | null | undefined;
  currentRetranscribeCount: number | null | undefined;
}): boolean {
  if (params.jobRetranscribeCount == null || params.currentRetranscribeCount == null) {
    return true;
  }
  return params.jobRetranscribeCount === params.currentRetranscribeCount;
}

export function isLexicalEditLockedByEnhancement(input: EnhancementUxInput): boolean {
  if (typeof input.publicationEligible === "boolean") {
    return input.publicationEligible;
  }
  return isEnhancementExecutionInFlight(input);
}

export function isSpeakerMappingLockedByEnhancement(): boolean {
  return false;
}

export function isAiBlockedByEnhancementEligibility(input: EnhancementUxInput): boolean {
  return input.publicationEligible === true;
}

/**
 * Step 3 status copy follows the same publicationEligible fence as AI
 * admission. `processingStage=not_started` is not “can start” while
 * enhancement can still replace the published transcript.
 */
export type AiWorkflowStepCopyKind = "blocked_by_enhancement" | "stage";

export function resolveAiWorkflowStepCopyKind(
  input: EnhancementUxInput,
): AiWorkflowStepCopyKind {
  return isAiBlockedByEnhancementEligibility(input)
    ? "blocked_by_enhancement"
    : "stage";
}

/**
 * Presentation copy for Debrief/Materials Step 2 and the enhancement rail.
 * Continue/`CANCELLED_FOR_PUBLICATION` is skipped, not "not started".
 */
export type EnhancementStatusCopyKind =
  | "not_started"
  | "in_progress"
  | "completed"
  | "failed"
  | "partial"
  | "skipped"
  | "historical_timeout"
  | "running_ineligible";

/**
 * Copy-only: a skipped latest attempt vs an authoritative prior enhanced
 * publication already present on the client as `transcriptEnhancementPublication`.
 * Does not change execution, eligibility, or publishedKind.
 */
export type SkippedEnhancementCopyVariant = "default" | "retaining_prior_publication";

export function authoritativeEnhancedPublicationRunIdFromMetadata(
  processingMetadata: unknown,
): string | null {
  const runId = parseTranscriptEnhancementPublication(processingMetadata)?.runId?.trim();
  return runId ? runId : null;
}

export function resolveSkippedEnhancementCopyVariant(params: {
  copyKind: EnhancementStatusCopyKind;
  authoritativeEnhancedPublicationRunId?: string | null;
}): SkippedEnhancementCopyVariant {
  if (params.copyKind !== "skipped") return "default";
  return params.authoritativeEnhancedPublicationRunId?.trim()
    ? "retaining_prior_publication"
    : "default";
}

export function skippedEnhancementHeadlineKey(
  variant: SkippedEnhancementCopyVariant,
):
  | "sessionMaterials.enhancementStatusSkipped"
  | "sessionMaterials.enhancementStatusSkippedRetainingPrior" {
  return variant === "retaining_prior_publication"
    ? "sessionMaterials.enhancementStatusSkippedRetainingPrior"
    : "sessionMaterials.enhancementStatusSkipped";
}

export function skippedEnhancementBodyKey(
  variant: SkippedEnhancementCopyVariant,
):
  | "sessionMaterials.enhancementStatusSkippedBody"
  | "sessionMaterials.enhancementStatusSkippedRetainingPriorBody" {
  return variant === "retaining_prior_publication"
    ? "sessionMaterials.enhancementStatusSkippedRetainingPriorBody"
    : "sessionMaterials.enhancementStatusSkippedBody";
}

export function skippedEnhancementReadySentenceKey(
  variant: SkippedEnhancementCopyVariant,
):
  | "sessionMaterials.transcriptEnhancementSkipped"
  | "sessionMaterials.transcriptEnhancementSkippedRetainingPrior" {
  return variant === "retaining_prior_publication"
    ? "sessionMaterials.transcriptEnhancementSkippedRetainingPrior"
    : "sessionMaterials.transcriptEnhancementSkipped";
}

export function resolveEnhancementStatusCopyKind(
  input: EnhancementUxInput,
): EnhancementStatusCopyKind {
  switch (resolveEnhancementUxState(input)) {
    case "ENHANCEMENT_RUNNING":
    case "ENHANCEMENT_RETRYING":
    case "RAW_READY_ENHANCEMENT_STARTING":
      return "in_progress";
    case "ENHANCEMENT_COMPLETED":
      return "completed";
    case "ENHANCEMENT_FAILED":
      return "failed";
    case "ENHANCEMENT_TERMINAL_PARTIAL":
      return "partial";
    case "ENHANCEMENT_CONTINUED":
      return "skipped";
    case "ENHANCEMENT_RUNNING_INELIGIBLE":
      return "running_ineligible";
    case "ENHANCEMENT_HISTORICAL_TIMEOUT":
      return "historical_timeout";
    default:
      return "not_started";
  }
}

/**
 * Start vs retry label is history/state, not `improveAvailable`.
 * Availability of the action stays with Product `canRetry` / `improveAvailable`.
 */
export type EnhancementStartActionKind = "start" | "retry";

export function hasPriorEnhancementAttempt(input: EnhancementUxInput): boolean {
  const execution = input.executionStatus ?? "";
  const uiStatus = input.uiStatus ?? "";
  if (
    execution === "QUEUED" ||
    execution === "RUNNING" ||
    execution === "COMPLETED" ||
    execution === "FAILED" ||
    execution === "CANCELLED_FOR_PUBLICATION"
  ) {
    return true;
  }
  if (
    uiStatus === "IN_PROGRESS" ||
    uiStatus === "COMPLETED" ||
    uiStatus === "FAILED" ||
    uiStatus === "PARTIAL" ||
    uiStatus === "SKIPPED"
  ) {
    return true;
  }
  if (input.skipReason || input.cancelReason || input.terminalQuality) {
    return true;
  }
  if ((input.progress?.totalChunks ?? 0) > 0) {
    return true;
  }
  return false;
}

export function resolveEnhancementStartActionKind(
  input: EnhancementUxInput,
): EnhancementStartActionKind {
  return hasPriorEnhancementAttempt(input) ? "retry" : "start";
}

export function enhancementStartActionCopyKey(
  input: EnhancementUxInput,
): "sessionMaterials.runTranscriptEnhancement" | "sessionMaterials.retryTranscriptEnhancement" {
  return resolveEnhancementStartActionKind(input) === "retry"
    ? "sessionMaterials.retryTranscriptEnhancement"
    : "sessionMaterials.runTranscriptEnhancement";
}

export function shouldShowSkipEnhancementAction(input: EnhancementUxInput): boolean {
  return input.publicationEligible === true && isEnhancementExecutionInFlight(input);
}

export type AiAnalysisTranscriptQualityNoticeKind = "none" | "skipped" | "not_applied";

export function resolveAiAnalysisTranscriptQualityNotice(
  input: EnhancementUxInput,
): AiAnalysisTranscriptQualityNoticeKind {
  const kind = resolveEnhancementStatusCopyKind(input);
  if (kind === "completed") return "none";
  if (kind === "skipped") return "skipped";
  if (kind === "running_ineligible" && input.cancelReason === "continue_with_current") {
    return "skipped";
  }
  if (kind === "failed" || kind === "partial" || kind === "historical_timeout") {
    return "not_applied";
  }
  return "none";
}

export function shouldReloadPublishedTranscript(input: {
  previousPublishedText: string | null | undefined;
  nextPublishedText: string | null | undefined;
  lexicalEditAvailable: boolean;
  unsavedLegalLexicalEdit: boolean;
}): boolean {
  if (input.nextPublishedText == null) return false;
  if (input.nextPublishedText === input.previousPublishedText) return false;
  if (input.lexicalEditAvailable && input.unsavedLegalLexicalEdit) return false;
  return true;
}

/**
 * Successful atomic publication is the only event that must hydrate
 * mounted segment cards. Skip / PARTIAL / FAILED are not this event.
 */
export function isSuccessfulAtomicPublication(input: EnhancementUxInput): boolean {
  if (input.executionStatus === "CANCELLED_FOR_PUBLICATION") return false;
  if (input.cancelReason === "continue_with_current") return false;
  if (input.terminalQuality === "PARTIAL" || input.terminalQuality === "FAILED") {
    return false;
  }
  if (input.uiStatus === "PARTIAL" || input.uiStatus === "FAILED" || input.uiStatus === "SKIPPED") {
    return false;
  }
  return resolvePublishedTranscriptKind(input) === "enhanced";
}

export function transcriptPayloadIndicatesSuccessfulPublication(status: string | null | undefined): boolean {
  return status === "COMPLETED";
}

/**
 * True until the current `/recording` projection has been applied after a
 * successful atomic publication. Independent of Transcript.text inequality
 * so a swallowed one-shot refresh cannot leave RAW cards mounted.
 */
export function resolvePublishedTranscriptRefreshObligation(input: {
  enhancement: EnhancementUxInput;
  hydratedSuccessfulPublication: boolean;
  lexicalEditAvailable: boolean;
  unsavedLegalLexicalEdit: boolean;
}): boolean {
  if (input.lexicalEditAvailable && input.unsavedLegalLexicalEdit) return false;
  if (!isSuccessfulAtomicPublication(input.enhancement)) return false;
  return !input.hydratedSuccessfulPublication;
}

export function enhancementProgressIsNotPartial(state: EnhancementUxState): boolean {
  return (
    state === "ENHANCEMENT_RUNNING" ||
    state === "ENHANCEMENT_RETRYING" ||
    state === "RAW_READY_ENHANCEMENT_STARTING"
  );
}

export function toProgressTemplateParams(
  progress: EnhancementUxProgress | TranscriptEnhancementProgress | null | undefined,
): { completed: number; total: number } | null {
  return clampEnhancementProgress(
    progress
      ? {
          completedChunks: progress.completedChunks,
          totalChunks: progress.totalChunks,
        }
      : null,
  );
}
