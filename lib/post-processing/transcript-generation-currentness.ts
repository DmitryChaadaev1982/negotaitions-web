import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import {
  isActiveTranscriptGenerationStage,
  type PostProcessingSemanticState,
} from "@/lib/post-processing/projection";

export { isActiveTranscriptGenerationStage } from "@/lib/post-processing/projection";

export type TranscriptGenerationUiCurrentness = {
  transcriptionActive: boolean;
  authoritativeTranscriptionActive: boolean;
  localInitiationBusy: boolean;
  transcriptionSemantic: PostProcessingSemanticState;
  enhancementSemantic: PostProcessingSemanticState;
  mappingSemantic: PostProcessingSemanticState;
  aiSemantic: PostProcessingSemanticState;
  enhancementCurrent: boolean;
  mappingCurrent: boolean;
  mappingLocked: boolean;
  aiCurrent: boolean;
};

/**
 * Local `rerunBusy` / start-transcription busy is an optimistic lock for the
 * initiating tab only. Cross-tab and refresh currentness uses the
 * authoritative transcript-generation stage from materials/status.
 */
export function isTranscriptGenerationPresentationActive(input: {
  transcriptionStage: string | null | undefined;
  localInitiationBusy?: boolean;
}): boolean {
  return (
    Boolean(input.localInitiationBusy) ||
    isActiveTranscriptGenerationStage(input.transcriptionStage)
  );
}

export function isSpeakerMappingPresentedCurrent(input: {
  transcriptionActive: boolean;
  speakerMappingStatus: string | null | undefined;
  detailedPayloadCurrent?: boolean;
}): boolean {
  if (input.transcriptionActive || input.detailedPayloadCurrent === false) {
    return false;
  }
  return (
    input.speakerMappingStatus === "CONFIRMED" ||
    input.speakerMappingStatus === "AUTO_SUGGESTED"
  );
}

/**
 * Payload lifecycle is current unless the mounted `/recording` snapshot is
 * still an active generation (queued/downloading/compressing/transcribing)
 * after materials/status has already left those stages.
 */
export function isDetailedTranscriptPayloadLifecycleCurrent(input: {
  payloadStatus?: string | null;
  authoritativeTranscriptionStage?: string | null;
}): boolean {
  const payloadActive = isActiveTranscriptGenerationStage(input.payloadStatus);
  const authoritativeActive = isActiveTranscriptGenerationStage(
    input.authoritativeTranscriptionStage,
  );
  return !(payloadActive && !authoritativeActive);
}

/**
 * Detailed `/recording` payload is current only when BOTH are true:
 * A. payload `retranscribeCount` matches materials/status generation;
 * B. payload lifecycle is current for the authoritative transcript state.
 * Generation equality alone is not enough: a same-generation QUEUED/
 * TRANSCRIBING snapshot is stale once materials/status reports complete.
 * Transcript ID and equal text are not generation identity. Omitting both
 * counts preserves ordinary same-generation helper calls.
 */
export function isDetailedTranscriptPayloadCurrent(input: {
  payloadRetranscribeCount?: number | null;
  authoritativeRetranscribeCount?: number | null;
  payloadStatus?: string | null;
  authoritativeTranscriptionStage?: string | null;
}): boolean {
  const generationCurrent =
    input.payloadRetranscribeCount == null &&
    input.authoritativeRetranscribeCount == null
      ? true
      : Number.isInteger(input.payloadRetranscribeCount) &&
        Number.isInteger(input.authoritativeRetranscribeCount) &&
        input.payloadRetranscribeCount === input.authoritativeRetranscribeCount;
  return (
    generationCurrent && isDetailedTranscriptPayloadLifecycleCurrent(input)
  );
}

/**
 * Presentation-local attempt identity. Authoritative active vs terminal
 * must be distinct so a same-generation completion can hydrate after the
 * in-flight N+1 snapshot was already loaded. Combined child
 * `transcriptionActive` (which stays true while the stale payload is
 * QUEUED) must not be used as this key.
 */
export function detailedTranscriptHydrationAttemptKey(input: {
  authoritativeRetranscribeCount?: number | null;
  authoritativeTranscriptionActive: boolean;
}): string {
  return `${input.authoritativeRetranscribeCount}:${
    input.authoritativeTranscriptionActive ? "active" : "terminal"
  }`;
}

export function shouldHydrateDetailedTranscriptPayload(input: {
  authoritativeRetranscribeCount?: number | null;
  payloadRetranscribeCount?: number | null;
  payloadLoaded?: boolean;
  payloadStatus?: string | null;
  authoritativeTranscriptionStage?: string | null;
}): boolean {
  if (input.payloadLoaded === false) {
    return false;
  }
  if (!Number.isInteger(input.authoritativeRetranscribeCount)) {
    return false;
  }
  if (input.payloadRetranscribeCount !== input.authoritativeRetranscribeCount) {
    return true;
  }
  return (
    isActiveTranscriptGenerationStage(input.payloadStatus) &&
    !isActiveTranscriptGenerationStage(input.authoritativeTranscriptionStage)
  );
}

export type DetailedTranscriptGenerationPresentation = {
  presentMappedParticipantNames: boolean;
  presentSegmentProvenanceDecoration: boolean;
  detailedPayloadCurrent: boolean;
};

/**
 * Detailed diarized-view generation-dependent decoration. Prior transcript
 * text may remain readable; mapped names and provenance icons must not look
 * current for an incoming transcript generation or a stale `/recording`
 * payload whose `retranscribeCount` does not match materials/status,
 * or whose lifecycle is still an active snapshot after that generation
 * has already completed.
 */
export function resolveDetailedTranscriptGenerationPresentation(input: {
  transcriptionActive: boolean;
  speakerMappingStatus: string | null | undefined;
  payloadRetranscribeCount?: number | null;
  authoritativeRetranscribeCount?: number | null;
  payloadStatus?: string | null;
  authoritativeTranscriptionStage?: string | null;
}): DetailedTranscriptGenerationPresentation {
  const detailedPayloadCurrent = isDetailedTranscriptPayloadCurrent(input);
  return {
    presentMappedParticipantNames: isSpeakerMappingPresentedCurrent({
      transcriptionActive: input.transcriptionActive,
      speakerMappingStatus: input.speakerMappingStatus,
      detailedPayloadCurrent,
    }),
    presentSegmentProvenanceDecoration:
      !input.transcriptionActive && detailedPayloadCurrent,
    detailedPayloadCurrent,
  };
}

export function isLocalTranscriptGenerationFenceActive(input: {
  requestBusy?: boolean;
  awaitingAuthoritativePostRetranscriptionStatus?: boolean;
}): boolean {
  return Boolean(
    input.requestBusy || input.awaitingAuthoritativePostRetranscriptionStatus,
  );
}

export function shouldReleasePostRetranscriptionFence(input: {
  appliedStatusRequestId: number | null | undefined;
  statusRequestSeqAtPostCompletion: number;
}): boolean {
  return (
    input.appliedStatusRequestId != null &&
    input.appliedStatusRequestId > input.statusRequestSeqAtPostCompletion
  );
}

/** Client observation timeout for materials/status GET. Not a server lifecycle. */
export const MATERIALS_STATUS_CLIENT_TIMEOUT_MS = 8_000;
export const MATERIALS_STATUS_EXCLUSIVE_ACQUIRE_TIMEOUT_MS = 1_000;
export const MATERIALS_STATUS_EXCLUSIVE_ABORT_GRACE_MS = 250;
export const MATERIALS_STATUS_ACQUIRE_POLL_MS = 25;

export function createMaterialsStatusRequestAbort(input?: {
  timeoutMs?: number;
}): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timeoutMs = input?.timeoutMs ?? MATERIALS_STATUS_CLIENT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    controller,
    dispose() {
      clearTimeout(timeoutId);
    },
  };
}

export function shouldApplyMaterialsStatusResponse(input: {
  requestId: number;
  latestAppliedRequestId: number;
  aborted?: boolean;
}): boolean {
  if (input.aborted) {
    return false;
  }
  return input.requestId >= input.latestAppliedRequestId;
}

export function shouldReleaseMaterialsStatusInFlightOwnership(input: {
  ownerController: AbortController | null;
  requestController: AbortController;
}): boolean {
  return input.ownerController === input.requestController;
}

export async function acquireMaterialsStatusFetchTurn(input: {
  isInFlight: () => boolean;
  setInFlight: (value: boolean) => void;
  exclusive: boolean;
  isCancelled?: () => boolean;
  waitMs?: number;
  maxWaitMs?: number;
  abortGraceMs?: number;
  abortInFlight?: () => void;
}): Promise<boolean> {
  const waitMs = input.waitMs ?? MATERIALS_STATUS_ACQUIRE_POLL_MS;
  const exclusiveWaitMs = input.exclusive
    ? (input.maxWaitMs ?? MATERIALS_STATUS_EXCLUSIVE_ACQUIRE_TIMEOUT_MS)
    : 0;
  const abortGraceMs =
    input.abortGraceMs ?? MATERIALS_STATUS_EXCLUSIVE_ABORT_GRACE_MS;
  const startedAt = Date.now();
  let abortRequested = false;
  while (true) {
    if (input.isCancelled?.()) {
      return false;
    }
    if (!input.isInFlight()) {
      input.setInFlight(true);
      return true;
    }
    if (!input.exclusive) {
      return false;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= exclusiveWaitMs) {
      if (!abortRequested) {
        abortRequested = true;
        input.abortInFlight?.();
      }
      if (elapsed >= exclusiveWaitMs + abortGraceMs) {
        return false;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * One presentation projection for rail, main cards, detailed mapping, and AI.
 * After transcription leaves an active stage, generation fences still apply:
 * leftover enhancement/AI are not restored merely because transcriptionActive
 * became false.
 */
export function projectTranscriptGenerationUiCurrentness(input: {
  transcriptionStage: string | null | undefined;
  localInitiationBusy?: boolean;
  enhancementSemantic: PostProcessingSemanticState;
  mappingSemantic: PostProcessingSemanticState;
  aiSemantic: PostProcessingSemanticState;
  enhancementCurrentForGeneration?: boolean;
  speakerMappingStatus?: string | null;
  analysisCurrent?: boolean | null;
  publishedReportCurrent?: boolean | null;
  analysisCurrentness?: Parameters<typeof evaluateAiAnalysisCurrentness>[0];
}): TranscriptGenerationUiCurrentness {
  const localInitiationBusy = Boolean(input.localInitiationBusy);
  const authoritativeTranscriptionActive = isActiveTranscriptGenerationStage(
    input.transcriptionStage,
  );
  const transcriptionActive =
    localInitiationBusy || authoritativeTranscriptionActive;
  const enhancementCurrentForGeneration =
    input.enhancementCurrentForGeneration !== false;
  const analysisCurrent =
    input.analysisCurrentness != null
      ? evaluateAiAnalysisCurrentness(input.analysisCurrentness).current
      : input.analysisCurrent === true || input.publishedReportCurrent === true;

  if (transcriptionActive) {
    return {
      transcriptionActive: true,
      authoritativeTranscriptionActive,
      localInitiationBusy,
      transcriptionSemantic: "running",
      enhancementSemantic: "pending",
      mappingSemantic: "pending",
      aiSemantic: "pending",
      enhancementCurrent: false,
      mappingCurrent: false,
      mappingLocked: true,
      aiCurrent: false,
    };
  }

  const mappingCurrent =
    isSpeakerMappingPresentedCurrent({
      transcriptionActive: false,
      speakerMappingStatus: input.speakerMappingStatus,
    }) &&
    (input.mappingSemantic === "ready" ||
      input.mappingSemantic === "informational");

  const enhancementCurrent =
    enhancementCurrentForGeneration &&
    (input.enhancementSemantic === "ready" ||
      input.enhancementSemantic === "informational");

  return {
    transcriptionActive: false,
    authoritativeTranscriptionActive: false,
    localInitiationBusy: false,
    transcriptionSemantic:
      (input.transcriptionStage ?? "").toLowerCase() === "ready"
        ? "ready"
        : input.transcriptionStage === "failed"
          ? "failed"
          : "pending",
    enhancementSemantic: enhancementCurrentForGeneration
      ? input.enhancementSemantic
      : "pending",
    mappingSemantic: input.mappingSemantic,
    aiSemantic: analysisCurrent
      ? input.aiSemantic
      : input.aiSemantic === "ready"
        ? "pending"
        : input.aiSemantic,
    enhancementCurrent,
    mappingCurrent,
    mappingLocked: false,
    aiCurrent: analysisCurrent,
  };
}

export function beginMaterialsStatusObservation(input: {
  forceStatusPolling: () => void;
  fetchStatus: () => void | Promise<unknown>;
}): void {
  input.forceStatusPolling();
  void input.fetchStatus();
}

export function shouldObserveMaterialsStatus(input: {
  serverShouldPoll?: boolean;
  forcePollingActive?: boolean;
  localTranscriptGenerationBusy?: boolean;
  publishedTranscriptRefreshPending?: boolean;
}): boolean {
  return Boolean(
    input.serverShouldPoll ||
      input.forcePollingActive ||
      input.localTranscriptGenerationBusy ||
      input.publishedTranscriptRefreshPending,
  );
}

/**
 * Observation starts before the long-running retranscription POST.
 * Callers must not emit a second retranscribe request from this helper.
 */
export function observeThenRetranscribe<T>(input: {
  observe: () => void;
  retranscribe: () => Promise<T>;
}): Promise<T> {
  input.observe();
  return input.retranscribe();
}

export type AuthoritativeStatusApplyResult = {
  appliedStatusRequestId: number | null;
};

/**
 * After the retranscription POST resolves, callers must apply a status
 * fetch that started after that POST. Local initiation fence may clear
 * only when that apply succeeds.
 */
export async function applyAuthoritativeStatusAfterRetranscribe(input: {
  applyAuthoritativeStatus: () => Promise<AuthoritativeStatusApplyResult>;
  statusRequestSeqAtPostCompletion: number;
}): Promise<{
  authoritativeStatusApplied: boolean;
  appliedStatusRequestId: number | null;
}> {
  const applied = await input.applyAuthoritativeStatus();
  return {
    appliedStatusRequestId: applied.appliedStatusRequestId,
    authoritativeStatusApplied: shouldReleasePostRetranscriptionFence({
      appliedStatusRequestId: applied.appliedStatusRequestId,
      statusRequestSeqAtPostCompletion: input.statusRequestSeqAtPostCompletion,
    }),
  };
}
