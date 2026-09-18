"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  AiAnalysisPendingReport,
  AiAnalysisReport,
} from "@/components/session-materials-dashboard";
import { Card, CardContent, CardHeader } from "@/components/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RecordingTranscriptionSection } from "@/components/recording-transcription-section";
import { GradientButtonLink, SecondaryButton } from "@/components/ui/buttons";
import { buildSessionMaterialsPath } from "@/lib/config";
import { resolveRecordingTranscriptionPresentation } from "@/lib/transcription/recording-transcription-presentation";
import { isEnhancementStatusRunning } from "@/lib/post-processing/projection";
import {
  authoritativeEnhancedPublicationRunIdFromMetadata,
  enhancementStartActionCopyKey,
  isAiBlockedByEnhancementEligibility,
  isEnhancementCurrentForTranscriptGeneration,
  resolveAiAnalysisTranscriptQualityNotice,
  resolveAiWorkflowStepCopyKind,
  resolveEnhancementStatusCopyKind,
  resolveSkippedEnhancementCopyVariant,
  skippedEnhancementBodyKey,
  skippedEnhancementHeadlineKey,
  skippedEnhancementReadySentenceKey,
  shouldShowDurableEnhancementProgress,
  toProgressTemplateParams,
  type AiAnalysisTranscriptQualityNoticeKind,
  type EnhancementStatusCopyKind,
} from "@/lib/post-processing/enhancement-ux-presentation";
import {
  acquireMaterialsStatusFetchTurn,
  applyAuthoritativeStatusAfterRetranscribe,
  beginMaterialsStatusObservation,
  createMaterialsStatusRequestAbort,
  isLocalTranscriptGenerationFenceActive,
  observeThenRetranscribe,
  projectTranscriptGenerationUiCurrentness,
  shouldApplyMaterialsStatusResponse,
  shouldObserveMaterialsStatus,
  shouldReleaseMaterialsStatusInFlightOwnership,
  shouldReleasePostRetranscriptionFence,
} from "@/lib/post-processing/transcript-generation-currentness";
import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import {
  postProcessingRailTileToneClassName,
  resolvePostProcessingRailTileTone,
  resolveSpeakerMappingRailTileTone,
  type PostProcessingRailTileTone,
} from "@/lib/post-processing/rail-tile-tone";
import {
  materialsRetranscribePath,
  materialsTranscribePath,
} from "@/lib/transcription/transcription-routes";
import { getTranscriptionSectionRefreshKey } from "@/lib/transcription/transcription-section-key";
import type {
  ProcessingAiAnalysisStatus,
  ProcessingRecordingStatus,
  ProcessingTranscriptionStatus,
} from "@/lib/session-materials-processing";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
import {
  parseCanonicalAnalysisOutput,
  parsePublishedViewerAnalysis,
  resolveAiAnalysisRenderState,
  type PublishedViewerAnalysis,
} from "@/lib/materials-ai-analysis-view";
import { useI18n } from "@/lib/i18n/useI18n";
import type { TranslationKey } from "@/lib/i18n/translate";
import { resolveRetranscribeFailureMessage } from "@/lib/transcription/retranscribe-client-error";

// ── Types ──────────────────────────────────────────────────────────────────

type MaterialsStatusResponse = {
  recording: { id?: string; processingStage: string } | null;
  transcription: {
    id?: string | null;
    processingStage: string;
    canStart: boolean;
    canRetry: boolean;
    canStop?: boolean;
    canRerun?: boolean;
    retranscribeCount?: number | null;
    speakerMappingRequired?: boolean;
    speakerMappingStatus?: string | null;
    diarizationStatus?: string | null;
    text?: string | null;
    processingMetadata?: unknown;
    enhancement?: {
      status: string;
      available: boolean;
      suggested: boolean;
      reasons: string[];
      error: string | null;
      skipReason?: string | null;
      inProgress?: boolean;
      canRetry?: boolean;
      canContinueWithCurrentTranscript?: boolean;
      executionStatus?: string;
      publicationEligible?: boolean;
      terminalQuality?: string | null;
      progress?: {
        totalChunks: number;
        completedChunks: number;
        runningChunks?: number;
        pendingChunks?: number;
        retryableFailedChunks?: number;
        permanentFailedChunks?: number;
      } | null;
      mappingAvailable?: boolean;
      lexicalEditAvailable?: boolean;
      improveAvailable?: boolean;
      cancelReason?: string | null;
    } | null;
  };
  postProcessing?: {
    stages: {
      RECORDING: { semantic: string };
      TRANSCRIPTION: { semantic: string };
      TRANSCRIPT_ENHANCEMENT: { semantic: string };
      SPEAKER_MAPPING: { semantic: string };
      AI_ANALYSIS: { semantic: string };
    };
  };
  aiAnalysis: {
    processingStage: string;
    canStart: boolean;
    canRetry: boolean;
    canRerun?: boolean;
    canView: boolean;
    canShare: boolean;
    isSharedWithSession: boolean;
    visibility: string | null;
    participantPlaceholder: boolean;
    notSharedMessage: string | null;
    analysisFromOlderTranscript?: boolean;
    analysisCurrent?: boolean;
    publishedReportCurrent?: boolean;
    analysisJson: unknown;
    errorMessage: string | null;
  };
  permissions: {
    canRunTranscription: boolean;
    canRunAiAnalysis: boolean;
    canShareAiAnalysis: boolean;
    canOpenMaterials?: boolean;
  };
  processing: {
    shouldPoll: boolean;
    nextPollMs?: number | null;
    autoTranscribeEnabled: boolean;
  };
};

type SessionPostProcessingPanelProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  readOnly?: boolean;
  autoTranscribeEnabled?: boolean;
  /** Full-width session page vs narrow video-room sidebar */
  variant?: "page" | "sidebar";
  participantType?: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  /** Show navigation links (materials, event lobby) — used in debrief sidebar */
  showNavigation?: boolean;
  eventLobbyUrl?: string | null;
  fallbackContext?: Pick<RoomSidebarData, "participantType" | "publicContext" | "caseRole">;
  debriefNotesContent?: ReactNode;
};

const DEFAULT_POLL_INTERVAL_MS = 4000;

const recordingStageKeys: Record<string, TranslationKey> = {
  not_available: "sessionMaterials.recordingNotAvailable",
  in_progress: "sessionMaterials.recordingInProgress",
  finalizing: "sessionMaterials.recordingFinalizing",
  processing: "sessionMaterials.recordingProcessing",
  ready: "sessionMaterials.recordingReady",
  failed: "sessionMaterials.recordingFailed",
};

const transcriptionStageKeys: Record<string, TranslationKey> = {
  waiting_for_recording: "sessionMaterials.waitingForRecording",
  not_started: "sessionMaterials.transcriptNotAvailableYet",
  queued: "sessionMaterials.transcriptionQueued",
  downloading: "sessionMaterials.transcriptionDownloading",
  compressing: "sessionMaterials.transcriptionCompressing",
  transcribing: "sessionMaterials.transcriptionInProgress",
  enhancing: "sessionMaterials.transcriptEnhancementInProgress",
  ready: "sessionMaterials.transcriptReady",
  failed: "sessionMaterials.transcriptionFailed",
};

const aiStageKeys: Record<string, TranslationKey> = {
  waiting_for_transcript: "sessionMaterials.waitingForTranscript",
  not_started: "sessionMaterials.transcriptReadyForAnalysis",
  queued: "sessionMaterials.aiAnalysisQueued",
  analyzing: "sessionMaterials.aiAnalysisAnalyzing",
  ready: "sessionMaterials.aiAnalysisReady",
  failed: "sessionMaterials.aiAnalysisFailed",
};

const enhancementStageKeys: Record<string, TranslationKey> = {
  NOT_STARTED: "sessionMaterials.transcriptEnhancementNotStarted",
  QUEUED: "sessionMaterials.enhancementRailRunning",
  IN_PROGRESS: "sessionMaterials.enhancementRailRunning",
  COMPLETED: "sessionMaterials.transcriptEnhancementCompleted",
  PARTIAL: "sessionMaterials.transcriptEnhancementFailedUsingBase",
  FAILED: "sessionMaterials.transcriptEnhancementFailedUsingBase",
  SKIPPED: "sessionMaterials.transcriptEnhancementSkipped",
};

const semanticStageKeys: Record<string, TranslationKey> = {
  pending: "sessionMaterials.stagePending",
  running: "sessionMaterials.stageRunning",
  ready: "sessionMaterials.stageReady",
  action_required: "sessionMaterials.stageActionRequired",
  informational: "sessionMaterials.stageInformational",
  failed: "sessionMaterials.stageFailed",
  not_applicable: "sessionMaterials.stageNotApplicable",
};

const speakerMappingStageKeys: Record<string, TranslationKey> = {
  ...semanticStageKeys,
  ready: "sessionMaterials.stageReady",
  informational: "sessionMaterials.stageReady",
  action_required: "sessionMaterials.speakerMappingActionRequired",
  pending: "sessionMaterials.stagePending",
  not_applicable: "sessionMaterials.speakerMappingNotApplicable",
  required: "sessionMaterials.speakerMappingActionRequired",
  not_available: "sessionMaterials.stagePending",
};

const enhancementSemanticStageKeys: Record<string, TranslationKey> = {
  ...semanticStageKeys,
  ready: "sessionMaterials.transcriptEnhancementCompleted",
  running: "sessionMaterials.enhancementRailRunning",
  failed: "sessionMaterials.enhancementStatusFailed",
  informational: "sessionMaterials.transcriptEnhancementSkipped",
  pending: "sessionMaterials.transcriptEnhancementNotStarted",
  skipped: "sessionMaterials.enhancementStatusSkipped",
  historical_timeout: "sessionMaterials.enhancementHistoricalTimeout",
  running_ineligible: "sessionMaterials.enhancementRunningIneligible",
};

const enhancementStatusCopyKeys: Record<EnhancementStatusCopyKind, TranslationKey> = {
  not_started: "sessionMaterials.transcriptEnhancementNotStarted",
  in_progress: "sessionMaterials.enhancementStatusRunning",
  completed: "sessionMaterials.enhancementStatusCompleted",
  failed: "sessionMaterials.enhancementStatusFailed",
  partial: "sessionMaterials.enhancementStatusPartial",
  skipped: "sessionMaterials.enhancementStatusSkipped",
  historical_timeout: "sessionMaterials.enhancementHistoricalTimeout",
  running_ineligible: "sessionMaterials.enhancementRunningIneligible",
};

function enhancementStepStatusMessageKey(
  kind: EnhancementStatusCopyKind,
  suggested: boolean,
): TranslationKey {
  if (kind === "not_started" && suggested) {
    return "sessionMaterials.transcriptEnhancementRecommended";
  }
  return enhancementStatusCopyKeys[kind];
}

function EnhancementStepStatusCopy({
  copyKind,
  statusKey,
  skippedCopyVariant,
  showProgress,
  progressParams,
}: {
  copyKind: EnhancementStatusCopyKind;
  statusKey: TranslationKey;
  skippedCopyVariant: ReturnType<typeof resolveSkippedEnhancementCopyVariant>;
  showProgress: boolean;
  progressParams: { completed: number; total: number } | null;
}) {
  const { t } = useI18n();
  const showStatusSentence =
    copyKind !== "in_progress" || !showProgress || progressParams == null;
  return (
    <div
      data-testid="step-enhancement-status"
      data-copy-kind={copyKind}
      data-skipped-copy={skippedCopyVariant}
    >
      {showStatusSentence ? (
        <p className="text-xs text-slate-500">
          {copyKind === "in_progress"
            ? t("sessionMaterials.enhancementRailRunning")
            : t(statusKey)}
        </p>
      ) : null}
      {copyKind === "skipped" ? (
        <p className="mt-1 text-xs text-slate-500" data-testid="step-enhancement-status-detail">
          {t(skippedEnhancementBodyKey(skippedCopyVariant))}
        </p>
      ) : null}
      {showProgress && progressParams ? (
        <p
          className={`${showStatusSentence ? "mt-1 " : ""}text-xs text-violet-200`}
          data-testid="post-processing-enhancement-progress"
        >
          {t("sessionMaterials.enhancementProgressFragments", progressParams)}
        </p>
      ) : null}
    </div>
  );
}

function StatusPill({
  title,
  stage,
  stageKeys,
  testId,
  resolveTone = resolvePostProcessingRailTileTone,
}: {
  title: string;
  stage: string;
  stageKeys: Record<string, TranslationKey>;
  testId?: string;
  resolveTone?: (stage: string) => PostProcessingRailTileTone;
}) {
  const { t } = useI18n();
  const labelKey = stageKeys[stage];
  const tone = resolveTone(stage);
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-sm ${postProcessingRailTileToneClassName(tone)}`}
      data-testid={testId}
      data-stage={stage}
      data-tone={tone}
    >
      <p
        className={`text-xs font-medium uppercase tracking-wide ${
          tone === "active" ? "opacity-90" : "opacity-70"
        }`}
      >
        {title}
      </p>
      <p className={`mt-0.5 ${tone === "active" ? "font-semibold" : "font-medium"}`}>
        {labelKey ? t(labelKey) : stage}
      </p>
    </div>
  );
}

// ── Step badge ─────────────────────────────────────────────────────────────

function StepBadge({ step, done, active }: { step: number; done: boolean; active: boolean }) {
  if (done)
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-950/40 text-xs font-bold text-emerald-400">
        ✓
      </span>
    );
  if (active)
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-950/40 text-xs font-bold text-cyan-300">
        {step}
      </span>
    );
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-600/40 bg-slate-800/40 text-xs font-bold text-slate-500">
      {step}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function SessionPostProcessingPanel({
  sessionId,
  roomAuth,
  readOnly = false,
  autoTranscribeEnabled: autoTranscribeProp = false,
  variant = "page",
  participantType = "FACILITATOR",
  showNavigation = false,
  eventLobbyUrl,
  fallbackContext,
  debriefNotesContent,
}: SessionPostProcessingPanelProps) {
  const { t } = useI18n();
  const isFacilitator = participantType === "FACILITATOR";
  const isSidebar = variant === "sidebar";
  const recordingTranscriptionPresentation = resolveRecordingTranscriptionPresentation(
    isSidebar ? "roomSidebar" : "materialsPage",
  );
  const materialsPath =
    roomAuth.type === "joinToken"
      ? buildSessionMaterialsPath(roomAuth.value)
      : `/sessions/${sessionId}/materials`;

  const [statusData, setStatusData] = useState<MaterialsStatusResponse | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [stopTranscriptionBusy, setStopTranscriptionBusy] = useState(false);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [
    awaitingAuthoritativePostRetranscriptionStatus,
    setAwaitingAuthoritativePostRetranscriptionStatus,
  ] = useState(false);
  const [enhancementBusy, setEnhancementBusy] = useState(false);
  const [continueBusy, setContinueBusy] = useState(false);
  const [lexicalUnsaved, setLexicalUnsaved] = useState(false);
  const [aiUnsavedWarnOpen, setAiUnsavedWarnOpen] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [speakerMappingBlockingAi, setSpeakerMappingBlockingAi] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [unsharingBusy, setUnsharingBusy] = useState(false);
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(false);
  const [aiWarningOpen, setAiWarningOpen] = useState(false);
  const [shareWarningOpen, setShareWarningOpen] = useState(false);
  const [forcePollingActive, setForcePollingActive] = useState(false);
  const [publishedTranscriptRefreshPending, setPublishedTranscriptRefreshPending] =
    useState(false);

  const mountedRef = useRef(true);
  const autoTranscribeStartedRef = useRef(false);
  const autoCollapsedRef = useRef(false);
  const forcePollingTimerRef = useRef<number | null>(null);
  const statusPollInFlightRef = useRef(false);
  const statusRequestSeqRef = useRef(0);
  const latestAppliedStatusRequestRef = useRef(0);
  const postRetranscribeStatusSeqRef = useRef<number | null>(null);
  const statusRequestAbortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async (options?: { exclusive?: boolean }) => {
    const acquired = await acquireMaterialsStatusFetchTurn({
      isInFlight: () => statusPollInFlightRef.current,
      setInFlight: (value) => {
        statusPollInFlightRef.current = value;
      },
      exclusive: Boolean(options?.exclusive),
      isCancelled: () => !mountedRef.current,
      abortInFlight: () => {
        statusRequestAbortRef.current?.abort();
      },
    });
    if (!acquired) {
      return { appliedStatusRequestId: null };
    }
    const request = createMaterialsStatusRequestAbort();
    statusRequestAbortRef.current = request.controller;
    const requestId = ++statusRequestSeqRef.current;
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/status?${roomAuthQuery(roomAuth)}`,
        { cache: "no-store", signal: request.controller.signal },
      );
      if (!res.ok || !mountedRef.current || request.controller.signal.aborted) {
        return { appliedStatusRequestId: null };
      }
      const data = (await res.json()) as MaterialsStatusResponse;
      if (
        mountedRef.current &&
        shouldApplyMaterialsStatusResponse({
          requestId,
          latestAppliedRequestId: latestAppliedStatusRequestRef.current,
          aborted: request.controller.signal.aborted,
        })
      ) {
        latestAppliedStatusRequestRef.current = requestId;
        setStatusData(data);
        const awaitingSeq = postRetranscribeStatusSeqRef.current;
        if (
          awaitingSeq != null &&
          shouldReleasePostRetranscriptionFence({
            appliedStatusRequestId: requestId,
            statusRequestSeqAtPostCompletion: awaitingSeq,
          })
        ) {
          postRetranscribeStatusSeqRef.current = null;
          setAwaitingAuthoritativePostRetranscriptionStatus(false);
        }
        return { appliedStatusRequestId: requestId };
      }
      return { appliedStatusRequestId: null };
    } catch {
      return { appliedStatusRequestId: null };
    } finally {
      request.dispose();
      if (
        shouldReleaseMaterialsStatusInFlightOwnership({
          ownerController: statusRequestAbortRef.current,
          requestController: request.controller,
        })
      ) {
        statusRequestAbortRef.current = null;
        statusPollInFlightRef.current = false;
      }
    }
  }, [roomAuth, sessionId]);

  const forceStatusPolling = useCallback((windowMs = 45_000) => {
    setForcePollingActive(true);
    if (forcePollingTimerRef.current !== null) {
      window.clearTimeout(forcePollingTimerRef.current);
    }
    forcePollingTimerRef.current = window.setTimeout(() => {
      forcePollingTimerRef.current = null;
      setForcePollingActive(false);
    }, windowMs);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    autoTranscribeStartedRef.current = false;
    queueMicrotask(() => {
      if (mountedRef.current) setStopTranscriptionBusy(false);
      void fetchStatus();
    });
    return () => {
      if (forcePollingTimerRef.current !== null) {
        window.clearTimeout(forcePollingTimerRef.current);
        forcePollingTimerRef.current = null;
      }
      statusRequestAbortRef.current?.abort();
      mountedRef.current = false;
    };
  }, [fetchStatus, sessionId]);

  const localTranscriptGenerationBusy = isLocalTranscriptGenerationFenceActive({
    requestBusy: rerunBusy || transcriptionBusy,
    awaitingAuthoritativePostRetranscriptionStatus,
  });

  useEffect(() => {
    const shouldPollStatus = shouldObserveMaterialsStatus({
      serverShouldPoll: statusData?.processing.shouldPoll,
      forcePollingActive,
      localTranscriptGenerationBusy,
      publishedTranscriptRefreshPending,
    });
    if (!shouldPollStatus) return;
    const id = setInterval(
      () => void fetchStatus(),
      statusData?.processing.nextPollMs ?? DEFAULT_POLL_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [
    fetchStatus,
    forcePollingActive,
    localTranscriptGenerationBusy,
    publishedTranscriptRefreshPending,
    statusData?.processing.nextPollMs,
    statusData?.processing.shouldPoll,
  ]);

  const autoTranscribeEnabled =
    autoTranscribeProp || (statusData?.processing.autoTranscribeEnabled ?? false);

  const recording = statusData?.recording;
  const transcript = statusData?.transcription;
  const ai = statusData?.aiAnalysis;
  const permissions = statusData?.permissions;

  const canStartTranscription =
    isFacilitator && !readOnly && permissions?.canRunTranscription && transcript?.canStart;
  const canRetryTranscription =
    isFacilitator && !readOnly && permissions?.canRunTranscription && transcript?.canRetry;
  const canStopTranscription =
    isFacilitator && !readOnly && permissions?.canRunTranscription && transcript?.canStop;
  const canRerunTranscription =
    isFacilitator && !readOnly && permissions?.canRunTranscription && transcript?.canRerun;
  const enhancement = transcript?.enhancement ?? null;
  const enhancementStage = statusData?.postProcessing?.stages.TRANSCRIPT_ENHANCEMENT;
  const enhancementRunning = enhancementStage
    ? enhancementStage.semantic === "running"
    : isEnhancementStatusRunning(enhancement?.status);
  const enhancementFailedOrPartial =
    enhancement?.status === "FAILED" || enhancement?.status === "PARTIAL";
  const enhancementCompleted = enhancement?.status === "COMPLETED";
  const enhancementCurrentForGeneration = isEnhancementCurrentForTranscriptGeneration({
    jobRetranscribeCount: parseTranscriptEnhancementJob(transcript?.processingMetadata)
      .retranscribeCount,
    currentRetranscribeCount: transcript?.retranscribeCount,
  });
  const generationCurrentness = projectTranscriptGenerationUiCurrentness({
    transcriptionStage: transcript?.processingStage,
    localInitiationBusy: localTranscriptGenerationBusy,
    enhancementSemantic:
      (statusData?.postProcessing?.stages.TRANSCRIPT_ENHANCEMENT.semantic as
        | "pending"
        | "running"
        | "ready"
        | "action_required"
        | "informational"
        | "failed"
        | "not_applicable") ?? "pending",
    mappingSemantic:
      (statusData?.postProcessing?.stages.SPEAKER_MAPPING.semantic as
        | "pending"
        | "running"
        | "ready"
        | "action_required"
        | "informational"
        | "failed"
        | "not_applicable") ?? "pending",
    aiSemantic:
      (statusData?.postProcessing?.stages.AI_ANALYSIS.semantic as
        | "pending"
        | "running"
        | "ready"
        | "action_required"
        | "informational"
        | "failed"
        | "not_applicable") ?? "pending",
    enhancementCurrentForGeneration,
    speakerMappingStatus: transcript?.speakerMappingStatus,
    analysisCurrent: ai?.analysisCurrent,
    publishedReportCurrent: ai?.publishedReportCurrent,
  });
  const canContinueCurrentTranscript =
    Boolean(enhancement?.canContinueWithCurrentTranscript) &&
    !generationCurrentness.transcriptionActive;
  const mappingSemantic = generationCurrentness.mappingSemantic;
  const mappingActionRequired =
    !generationCurrentness.transcriptionActive &&
    (mappingSemantic === "action_required" || Boolean(transcript?.speakerMappingRequired));
  const canStartTranscriptEnhancement =
    isFacilitator &&
    !readOnly &&
    enhancement?.available &&
    transcript?.processingStage === "ready" &&
    !enhancementRunning &&
    !generationCurrentness.transcriptionActive &&
    (enhancement?.status === "NOT_STARTED" || enhancement?.status === "SKIPPED");
  const canRetryTranscriptEnhancement =
    isFacilitator &&
    !readOnly &&
    Boolean(enhancement?.canRetry) &&
    !enhancementRunning &&
    !generationCurrentness.transcriptionActive;
  const canRunTranscriptEnhancement =
    canStartTranscriptEnhancement || canRetryTranscriptEnhancement;
  const enhancementBlocksAi = isAiBlockedByEnhancementEligibility({
    publicationEligible: enhancement?.publicationEligible,
    uiStatus: enhancement?.status,
    executionStatus: enhancement?.executionStatus,
  });
  const canStartAi =
    isFacilitator &&
    !readOnly &&
    Boolean(ai?.canStart) &&
    !enhancementBlocksAi &&
    !generationCurrentness.transcriptionActive;
  const canRetryAi =
    isFacilitator &&
    !readOnly &&
    Boolean(ai?.canRetry) &&
    !enhancementBlocksAi &&
    !generationCurrentness.transcriptionActive;
  const canRerunAi =
    isFacilitator &&
    !readOnly &&
    Boolean(ai?.canRerun) &&
    !enhancementBlocksAi &&
    !generationCurrentness.transcriptionActive;
  const enhancementProgressParams = toProgressTemplateParams(enhancement?.progress ?? null);
  const showEnhancementProgress =
    shouldShowDurableEnhancementProgress({
      uiStatus: enhancement?.status,
      executionStatus: enhancement?.executionStatus,
      publicationEligible: enhancement?.publicationEligible,
      progress: enhancement?.progress,
    }) && !generationCurrentness.transcriptionActive;
  const enhancementUxInput = {
    uiStatus: enhancement?.status,
    executionStatus: enhancement?.executionStatus,
    publicationEligible: enhancement?.publicationEligible,
    terminalQuality: enhancement?.terminalQuality,
    cancelReason: enhancement?.cancelReason,
    skipReason: enhancement?.skipReason,
    progress: enhancement?.progress,
    transcriptionStage: transcript?.processingStage,
    retranscriptionLocked: localTranscriptGenerationBusy,
    currentForGeneration: enhancementCurrentForGeneration,
  };
  const enhancementStartActionKey = enhancementStartActionCopyKey(enhancementUxInput);
  const enhancementStatusCopyKind = resolveEnhancementStatusCopyKind(enhancementUxInput);
  const skippedEnhancementCopyVariant = resolveSkippedEnhancementCopyVariant({
    copyKind: enhancementStatusCopyKind,
    authoritativeEnhancedPublicationRunId: authoritativeEnhancedPublicationRunIdFromMetadata(
      statusData?.transcription.processingMetadata,
    ),
  });
  const enhancementStepStatusKey =
    enhancementStatusCopyKind === "skipped"
      ? skippedEnhancementHeadlineKey(skippedEnhancementCopyVariant)
      : enhancementStepStatusMessageKey(
          enhancementStatusCopyKind,
          Boolean(enhancement?.suggested),
        );
  const aiWorkflowStepCopyKind = resolveAiWorkflowStepCopyKind(enhancementUxInput);
  const aiTranscriptQualityNotice = resolveAiAnalysisTranscriptQualityNotice(enhancementUxInput);
  const enhancementRailStage = generationCurrentness.transcriptionActive
    ? generationCurrentness.enhancementSemantic
    : enhancementStatusCopyKind === "skipped" ||
        enhancementStatusCopyKind === "historical_timeout" ||
        enhancementStatusCopyKind === "running_ineligible"
      ? enhancementStatusCopyKind
      : generationCurrentness.enhancementSemantic;
  const canViewAi = ai?.canView ?? false;
  const canShareAi = isFacilitator && !readOnly && ai?.canShare;
  const aiShared = ai?.isSharedWithSession ?? false;
  const isFacilitatorView = ai?.visibility != null;
  const canOpenMaterials = statusData?.permissions?.canOpenMaterials ?? true;

  const aiRenderState = resolveAiAnalysisRenderState({
    recordingStage: (recording?.processingStage ??
      "not_available") as ProcessingRecordingStatus,
    transcriptionStage: (transcript?.processingStage ??
      "waiting_for_recording") as ProcessingTranscriptionStatus,
    aiStage: (ai?.processingStage ?? "waiting_for_transcript") as ProcessingAiAnalysisStatus,
    canViewAiAnalysis: canViewAi,
    analysisJson: ai?.analysisJson ?? null,
    parseAnalysisJson:
      participantType === "FACILITATOR"
        ? parseCanonicalAnalysisOutput
        : parsePublishedViewerAnalysis,
  });
  const analysisJson: PublishedViewerAnalysis | null =
    aiRenderState.analysis;
  const aiRenderValidationError = aiRenderState.showInvalidResultError
    ? t("sessionMaterials.aiAnalysisInvalidResult")
    : null;

  const handleStartTranscription = useCallback(async () => {
    setTranscriptionBusy(true);
    setAwaitingAuthoritativePostRetranscriptionStatus(true);
    let postSucceeded = false;
    try {
      await observeThenRetranscribe({
        observe: () =>
          beginMaterialsStatusObservation({
            forceStatusPolling,
            fetchStatus,
          }),
        retranscribe: async () => {
          const res = await fetch(materialsTranscribePath(sessionId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(roomAuthBody(roomAuth)),
          });
          if (!res.ok) {
            const body = (await res.json()) as { error?: string };
            throw new Error(body.error ?? "Transcription failed.");
          }
        },
      });
      postSucceeded = true;
      postRetranscribeStatusSeqRef.current = statusRequestSeqRef.current;
      await applyAuthoritativeStatusAfterRetranscribe({
        statusRequestSeqAtPostCompletion: postRetranscribeStatusSeqRef.current,
        applyAuthoritativeStatus: () => fetchStatus({ exclusive: true }),
      });
    } catch {
      autoTranscribeStartedRef.current = false;
      if (!postSucceeded) {
        postRetranscribeStatusSeqRef.current = null;
        if (mountedRef.current) {
          setAwaitingAuthoritativePostRetranscriptionStatus(false);
        }
      }
    } finally {
      if (mountedRef.current) {
        setTranscriptionBusy(false);
      }
    }
  }, [fetchStatus, forceStatusPolling, roomAuth, sessionId]);

  const handleRerunTranscription = useCallback(async () => {
    if (rerunBusy || awaitingAuthoritativePostRetranscriptionStatus) {
      return;
    }
    setRerunConfirmOpen(false);
    setRerunBusy(true);
    setAwaitingAuthoritativePostRetranscriptionStatus(true);
    setRerunError(null);
    let postSucceeded = false;
    try {
      await observeThenRetranscribe({
        observe: () =>
          beginMaterialsStatusObservation({
            forceStatusPolling,
            fetchStatus,
          }),
        retranscribe: async () => {
          const res = await fetch(materialsRetranscribePath(sessionId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...roomAuthBody(roomAuth), reason: "manual_rerun" }),
          });
          if (!res.ok) {
            const body = (await res.json()) as { error?: string; code?: string };
            throw new Error(
              resolveRetranscribeFailureMessage(body, t, "Re-transcription failed."),
            );
          }
        },
      });
      postSucceeded = true;
      postRetranscribeStatusSeqRef.current = statusRequestSeqRef.current;
      await applyAuthoritativeStatusAfterRetranscribe({
        statusRequestSeqAtPostCompletion: postRetranscribeStatusSeqRef.current,
        applyAuthoritativeStatus: () => fetchStatus({ exclusive: true }),
      });
    } catch (err) {
      if (!postSucceeded) {
        postRetranscribeStatusSeqRef.current = null;
        if (mountedRef.current) {
          setAwaitingAuthoritativePostRetranscriptionStatus(false);
        }
      }
      if (mountedRef.current) {
        setRerunError(err instanceof Error ? err.message : "Re-transcription failed.");
      }
    } finally {
      if (mountedRef.current) {
        setRerunBusy(false);
      }
    }
  }, [
    awaitingAuthoritativePostRetranscriptionStatus,
    fetchStatus,
    forceStatusPolling,
    rerunBusy,
    roomAuth,
    sessionId,
    t,
  ]);

  const handleStopTranscription = useCallback(async () => {
    setStopTranscriptionBusy(true);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/transcribe/stop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomAuthBody(roomAuth)),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to stop transcription.");
      }
      autoTranscribeStartedRef.current = true;
      forceStatusPolling();
      void fetchStatus();
    } catch (err) {
      setRerunError(
        err instanceof Error ? err.message : "Unable to stop transcription.",
      );
    } finally {
      setStopTranscriptionBusy(false);
    }
  }, [fetchStatus, forceStatusPolling, roomAuth, sessionId]);

  const handleRunTranscriptEnhancement = useCallback(async () => {
    setEnhancementBusy(true);
    setRerunError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/enhance-transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomAuthBody(roomAuth)),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Transcript enhancement failed.");
      }
      forceStatusPolling();
      void fetchStatus();
    } catch (err) {
      setRerunError(
        err instanceof Error ? err.message : "Transcript enhancement failed.",
      );
    } finally {
      setEnhancementBusy(false);
    }
  }, [fetchStatus, forceStatusPolling, roomAuth, sessionId]);

  useEffect(() => {
    if (!autoTranscribeEnabled || !canStartTranscription || transcriptionBusy) return;
    if (canRetryTranscription) return;
    if (autoTranscribeStartedRef.current) return;
    autoTranscribeStartedRef.current = true;
    forceStatusPolling();
    void handleStartTranscription();
  }, [
    autoTranscribeEnabled,
    canRetryTranscription,
    canStartTranscription,
    forceStatusPolling,
    handleStartTranscription,
    transcriptionBusy,
  ]);

  // Keep the transcript expanded while enhancement is eligible/running so the
  // published text stays visible. Collapse only after AI is done.
  const aiDoneForCollapse = statusData?.aiAnalysis?.processingStage === "ready";
  useEffect(() => {
    if (aiDoneForCollapse && !autoCollapsedRef.current && !isSidebar) {
      autoCollapsedRef.current = true;
      setTranscriptCollapsed(true);
    }
  }, [aiDoneForCollapse, isSidebar]);

  const handleRunAiAnalysisConfirmed = async () => {
    setAiWarningOpen(false);
    setAiBusy(true);
    setAiError(null);
    setSpeakerMappingBlockingAi(false);
    setStatusData((current) =>
      current
        ? {
            ...current,
            aiAnalysis: {
              ...current.aiAnalysis,
              processingStage: "queued",
              canStart: false,
              canRetry: false,
              canRerun: false,
            },
            permissions: {
              ...current.permissions,
              canRunAiAnalysis: false,
            },
            processing: {
              ...current.processing,
              shouldPoll: true,
              nextPollMs: current.processing.nextPollMs ?? DEFAULT_POLL_INTERVAL_MS,
            },
          }
        : current,
    );
    forceStatusPolling();
    void fetchStatus();
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...roomAuthBody(roomAuth), aiProcessingConfirmed: true }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; errorCode?: string };
        if (body.errorCode === "SPEAKER_MAPPING_REQUIRED") {
          setSpeakerMappingBlockingAi(true);
        } else {
          setAiError(body.error ?? "AI analysis failed.");
        }
      } else {
        void fetchStatus();
      }
    } catch {
      setAiError("AI analysis failed.");
    } finally {
      setAiBusy(false);
    }
  };

  const handleRunAiAnalysis = () => {
    if (lexicalUnsaved) {
      setAiUnsavedWarnOpen(true);
      return;
    }
    setAiWarningOpen(true);
  };

  const handleContinueWithCurrentTranscript = useCallback(async () => {
    if (continueBusy) return;
    setContinueBusy(true);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/continue-transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomAuthBody(roomAuth)),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setAiError(body.error ?? "Continue failed.");
      }
      void fetchStatus();
    } catch {
      setAiError("Continue failed.");
    } finally {
      setContinueBusy(false);
    }
  }, [continueBusy, fetchStatus, roomAuth, sessionId]);

  const handleShareAnalysisConfirmed = async () => {
    setShareWarningOpen(false);
    setSharingBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...roomAuthBody(roomAuth), shareDebriefConfirmed: true }),
      });
      forceStatusPolling();
      void fetchStatus();
    } finally {
      setSharingBusy(false);
    }
  };

  const handleShareAnalysis = () => {
    setShareWarningOpen(true);
  };

  const handleUnshareAnalysis = async () => {
    setUnsharingBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/unshare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roomAuthBody(roomAuth)),
      });
      forceStatusPolling();
      void fetchStatus();
    } finally {
      setUnsharingBusy(false);
    }
  };

  const showTranscriptionSection = isFacilitator && !readOnly;
  const showAiSection = isFacilitator || canViewAi || (ai?.participantPlaceholder ?? false);

  const transcriptionStage = transcript?.processingStage ?? "waiting_for_recording";
  const aiStage = ai?.processingStage ?? "waiting_for_transcript";
  const aiStepStatusKey: TranslationKey =
    aiWorkflowStepCopyKind === "blocked_by_enhancement"
      ? "sessionMaterials.enhancementAiBlockedWaitOrSkip"
      : generationCurrentness.transcriptionActive
        ? "sessionMaterials.waitingForTranscript"
      : (aiStageKeys[aiStage] ?? "sessionMaterials.waitingForTranscript");
  const transcriptionActive = generationCurrentness.transcriptionActive;
  const aiActive = ["queued", "analyzing"].includes(aiStage);
  const transcriptionDone =
    transcriptionStage === "ready" && !generationCurrentness.transcriptionActive;
  const enhancementDone =
    (enhancementCompleted || enhancementFailedOrPartial) &&
    generationCurrentness.enhancementCurrent;
  const enhancementStepActive = enhancementRunning && !transcriptionActive;
  const enhancementStepChrome = transcriptionActive
    ? "border-slate-700/40 bg-slate-900/30"
    : enhancementRunning
      ? "border-violet-500/30 bg-violet-950/10"
      : enhancementDone
        ? "border-emerald-500/20 bg-emerald-950/10"
        : enhancementFailedOrPartial
          ? "border-amber-500/30 bg-amber-950/10"
          : "border-slate-700/40 bg-slate-900/30";
  const aiDone = aiStage === "ready" && generationCurrentness.aiCurrent;
  const aiAdmissionCompleted =
    aiDone ||
    aiActive ||
    aiStage === "failed";
  const aiStatusMessageKey: TranslationKey | null = (() => {
    if (generationCurrentness.transcriptionActive) {
      return (
        transcriptionStageKeys[transcriptionStage] ??
        "sessionMaterials.transcriptionInProgress"
      );
    }
    switch (aiRenderState.stage) {
      case "WAITING_FOR_RECORDING":
        return "sessionMaterials.waitingForRecording";
      case "WAITING_FOR_TRANSCRIPT":
        return "sessionMaterials.waitingForTranscript";
      case "TRANSCRIPT_PROCESSING":
        return (
          transcriptionStageKeys[transcriptionStage] ??
          "sessionMaterials.transcriptionInProgress"
        );
      case "ANALYSIS_NOT_STARTED":
        return aiWorkflowStepCopyKind === "blocked_by_enhancement"
          ? "sessionMaterials.enhancementAiBlockedWaitOrSkip"
          : "sessionMaterials.transcriptReadyForAnalysis";
      case "ANALYSIS_IN_PROGRESS":
        return "sessionMaterials.aiAnalysisInProgress";
      case "ANALYSIS_FAILED":
        return "sessionMaterials.aiAnalysisFailed";
      case "ANALYSIS_READY_WITHOUT_RESULT":
      case "ANALYSIS_INVALID":
        return "sessionMaterials.aiAnalysisReady";
      case "ANALYSIS_READY":
        return generationCurrentness.aiCurrent ? null : "sessionMaterials.waitingForTranscript";
      default:
        return "sessionMaterials.waitingForTranscript";
    }
  })();
  const transcriptionSectionRefreshKey = getTranscriptionSectionRefreshKey({
    sessionId,
    transcriptId: transcript?.id ?? null,
    recordingId: recording?.id ?? null,
    retranscribeCount: transcript?.retranscribeCount ?? null,
  });
  const transcriptionSectionEnhancementProps = {
    canonicalEnhancementStatus: statusData ? (enhancement?.status ?? null) : undefined,
    canonicalEnhancementRunning: statusData ? enhancementRunning : undefined,
    canonicalPublicationEligible: statusData ? enhancement?.publicationEligible : undefined,
    canonicalLexicalEditAvailable: statusData ? enhancement?.lexicalEditAvailable : undefined,
    canonicalContinueAvailable: statusData ? enhancement?.canContinueWithCurrentTranscript : undefined,
    canonicalTerminalQuality: statusData ? (enhancement?.terminalQuality ?? null) : undefined,
    canonicalExecutionStatus: statusData ? (enhancement?.executionStatus ?? null) : undefined,
    canonicalCancelReason: statusData ? (enhancement?.cancelReason ?? null) : undefined,
    canonicalSkipReason: statusData ? (enhancement?.skipReason ?? null) : undefined,
    canonicalEnhancementProgress: statusData ? (enhancement?.progress ?? null) : undefined,
    canonicalPublishedText: statusData ? (transcript?.text ?? null) : undefined,
    onContinueWithCurrentTranscript: canContinueCurrentTranscript
      ? () => void handleContinueWithCurrentTranscript()
      : undefined,
    continueBusy,
    onLexicalUnsavedChange: setLexicalUnsaved,
    onPublishedTranscriptRefreshPending: setPublishedTranscriptRefreshPending,
  };

  // ── Steps pipeline (page variant only) ───────────────────────────────────

  const stepsBar = isFacilitator && !readOnly && statusData ? (
    <div className="space-y-2">
      {/* ── Step 1: Transcription ── */}
      <div
        id="step-transcription"
        className={`rounded-lg border px-4 py-3 transition-colors
          ${transcriptionActive ? "border-cyan-500/30 bg-cyan-950/10" : transcriptionDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex flex-wrap items-start gap-3">
          <StepBadge step={1} done={transcriptionDone} active={transcriptionActive} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-200">{t("sessions.recordingAndTranscription")}</p>
            {transcriptionStage !== "ready" ? (
              <p className="text-xs text-slate-500">
                {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.waitingForRecording")}
              </p>
            ) : null}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:justify-end sm:pt-0">
            {canRerunTranscription ? (
              <SecondaryButton
                disabled={rerunBusy || transcriptionBusy || awaitingAuthoritativePostRetranscriptionStatus || rerunConfirmOpen}
                onClick={() => setRerunConfirmOpen(true)}
                data-testid="post-processing-rerun-transcription-button"
              >
                {rerunBusy ? t("common.loading") : t("sessionMaterials.rerunTranscription")}
              </SecondaryButton>
            ) : null}
            {canStopTranscription ? (
              <SecondaryButton
                disabled={stopTranscriptionBusy}
                onClick={() => void handleStopTranscription()}
                data-testid="post-processing-stop-transcription-button"
              >
                {stopTranscriptionBusy
                  ? t("common.loading")
                  : t("sessionMaterials.stopTranscription")}
              </SecondaryButton>
            ) : null}
            {transcriptionDone || canStartTranscription || canRetryTranscription || canRerunTranscription ? (
              <a
                href="#transcription-section"
                className="text-xs text-slate-500 hover:text-slate-300"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById("transcription-section")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                ↓ {t("sessions.recordingAndTranscription")}
              </a>
            ) : null}
          </div>
        </div>
        {rerunError ? <p className="mt-2 text-xs text-rose-400">{rerunError}</p> : null}
      </div>

      {/* ── Step 2: Transcript enhancement ── */}
      {(transcriptionDone || transcriptionActive) &&
      (enhancement?.available ||
        enhancementRunning ||
        enhancementCompleted ||
        enhancementFailedOrPartial ||
        canContinueCurrentTranscript) ? (
        <div
          id="step-enhancement"
          data-testid="step-enhancement"
          className={`rounded-lg border px-4 py-3 transition-colors
            ${enhancementStepChrome}`}
        >
          <div className="flex flex-wrap items-start gap-3">
            <StepBadge step={2} done={enhancementDone} active={enhancementStepActive} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-200">
                {t("sessionMaterials.transcriptEnhancement")}
              </p>
              <EnhancementStepStatusCopy
                copyKind={enhancementStatusCopyKind}
                statusKey={enhancementStepStatusKey}
                skippedCopyVariant={skippedEnhancementCopyVariant}
                showProgress={showEnhancementProgress}
                progressParams={enhancementProgressParams}
              />
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:justify-end sm:pt-0">
              {canContinueCurrentTranscript ? (
                <SecondaryButton
                  disabled={continueBusy}
                  onClick={() => void handleContinueWithCurrentTranscript()}
                  data-testid="post-processing-continue-transcript-button"
                >
                  {continueBusy
                    ? t("common.loading")
                    : t("sessionMaterials.skipEnhancement")}
                </SecondaryButton>
              ) : null}
              {canRunTranscriptEnhancement ? (
                <SecondaryButton
                  disabled={enhancementBusy || enhancementRunning}
                  onClick={() => void handleRunTranscriptEnhancement()}
                  data-testid="post-processing-run-transcript-enhancement-button"
                >
                  {enhancementBusy || enhancementRunning
                    ? t("sessionMaterials.transcriptEnhancementInProgress")
                    : t(enhancementStartActionKey)}
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Step 3: AI Analysis ── */}
      <div
        id="step-ai"
        className={`rounded-lg border px-4 py-3 transition-colors
          ${aiActive ? "border-violet-500/30 bg-violet-950/10" : aiDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex flex-wrap items-start gap-3">
          <StepBadge step={3} done={aiDone} active={aiActive} />
          <div
            className="min-w-0 flex-1"
            data-testid="step-ai-status"
            data-copy-kind={aiWorkflowStepCopyKind}
          >
            <p className="text-sm font-semibold text-slate-200">{t("sessionMaterials.aiAnalysis")}</p>
            <p
              className="text-xs text-slate-500"
              data-testid={
                aiWorkflowStepCopyKind === "blocked_by_enhancement"
                  ? "enhancement-ai-blocked-reason"
                  : undefined
              }
              data-copy-kind={aiWorkflowStepCopyKind}
            >
              {t(aiStepStatusKey)}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:justify-end sm:pt-0">
            {canStartAi || canRetryAi || canRerunAi ? (
              <SecondaryButton
                disabled={aiBusy}
                onClick={() => void handleRunAiAnalysis()}
                data-testid="post-processing-run-ai-analysis-button"
              >
                {aiBusy
                  ? t("common.loading")
                  : canRerunAi
                    ? t("sessionMaterials.rerunAiAnalysis")
                    : canRetryAi
                      ? t("sessionMaterials.retryAiAnalysis")
                      : t("room.runAiAnalysis")}
              </SecondaryButton>
            ) : null}
            {aiDone && !canStartAi && !canRetryAi && !canRerunAi ? (
              <a
                href="#ai-section"
                className="text-xs text-slate-500 hover:text-slate-300"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById("ai-section")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                ↓ {t("sessionMaterials.aiReport")}
              </a>
            ) : null}
          </div>
        </div>
        {speakerMappingBlockingAi || mappingActionRequired ? (
          <p className="mt-2 text-xs text-amber-300">{t("room.confirmSpeakerMappingBeforeAi")}</p>
        ) : null}
        {enhancementFailedOrPartial && (canStartAi || canRetryAi) ? (
          <p className="mt-2 text-xs text-sky-200" data-testid="enhancement-continue-current-transcript">
            {t("sessionMaterials.enhancementFailedContinueHint")}
          </p>
        ) : null}
        {aiError && !speakerMappingBlockingAi ? (
          <p className="mt-2 text-xs text-rose-400">{aiError}</p>
        ) : null}
        {ai?.analysisFromOlderTranscript ? (
          <p className="mt-2 text-xs text-amber-300">{t("sessionMaterials.analysisFromOlderTranscript")}</p>
        ) : null}
      </div>

      {/* ── Step 4: Share with participants ── */}
      {aiDone ? (
        <div
          id="step-share"
          className={`rounded-lg border px-4 py-3 transition-colors
            ${aiShared ? "border-emerald-500/30 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <StepBadge step={4} done={aiShared} active={false} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-200">{t("room.shareWithParticipants")}</p>
              <p className="text-xs text-slate-500">
                {aiShared ? t("room.sharedWithParticipants") : t("sessionMaterials.aiAnalysisFacilitatorBadge")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canShareAi && !aiShared ? (
                <SecondaryButton
                  disabled={sharingBusy}
                  onClick={() => void handleShareAnalysis()}
                  data-testid="post-processing-share-analysis-button"
                >
                  {sharingBusy ? t("sessionMaterials.sharing") : t("room.shareWithParticipants")}
                </SecondaryButton>
              ) : null}
              {aiShared ? (
                <SecondaryButton
                  disabled={unsharingBusy}
                  onClick={() => void handleUnshareAnalysis()}
                  data-testid="post-processing-unshare-analysis-button"
                >
                  {unsharingBusy ? t("common.loading") : t("room.stopSharing")}
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  // ── Sidebar steps bar (status left, action button right — mirrors page stepsBar) ──

  const sidebarStepsBar = isFacilitator && !readOnly && statusData && isSidebar ? (
    <div className="space-y-2">
      {/* Step 1: Transcription */}
      <div
        className={`rounded-lg border px-3 py-2.5 transition-colors
          ${transcriptionActive ? "border-cyan-500/30 bg-cyan-950/10" : transcriptionDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex flex-wrap items-start gap-2">
          <StepBadge step={1} done={transcriptionDone} active={transcriptionActive} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-200">{t("sessions.recordingAndTranscription")}</p>
            {transcriptionStage !== "ready" ? (
              <p className="text-xs text-slate-500">
                {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.waitingForRecording")}
              </p>
            ) : null}
          </div>
          <div className="flex w-full flex-col gap-2 pt-2 sm:ml-auto sm:w-56 sm:pt-0">
            {canRerunTranscription ? (
              <SecondaryButton
                disabled={transcriptionBusy || rerunBusy || awaitingAuthoritativePostRetranscriptionStatus || stopTranscriptionBusy || rerunConfirmOpen}
                onClick={() => setRerunConfirmOpen(true)}
                data-testid="post-processing-rerun-transcription-button"
                className="w-full text-xs"
              >
                {rerunBusy
                  ? t("common.loading")
                  : t("sessionMaterials.rerunTranscription")}
              </SecondaryButton>
            ) : null}
            {canStopTranscription ? (
              <SecondaryButton
                disabled={stopTranscriptionBusy}
                onClick={() => void handleStopTranscription()}
                data-testid="post-processing-stop-transcription-button"
                className="w-full text-xs"
              >
                {stopTranscriptionBusy
                  ? t("common.loading")
                  : t("sessionMaterials.stopTranscription")}
              </SecondaryButton>
            ) : null}
          </div>
        </div>
        {rerunError ? <p className="mt-1 text-xs text-rose-400">{rerunError}</p> : null}
      </div>

      {/* Step 2: Transcript enhancement */}
      {(transcriptionDone || transcriptionActive) &&
      (enhancement?.available ||
        enhancementRunning ||
        enhancementCompleted ||
        enhancementFailedOrPartial ||
        canContinueCurrentTranscript) ? (
        <div
          data-testid="step-enhancement"
          className={`rounded-lg border px-3 py-2.5 transition-colors
            ${enhancementStepChrome}`}
        >
          <div className="flex flex-wrap items-start gap-2">
            <StepBadge step={2} done={enhancementDone} active={enhancementStepActive} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200">
                {t("sessionMaterials.transcriptEnhancement")}
              </p>
              <EnhancementStepStatusCopy
                copyKind={enhancementStatusCopyKind}
                statusKey={enhancementStepStatusKey}
                skippedCopyVariant={skippedEnhancementCopyVariant}
                showProgress={showEnhancementProgress}
                progressParams={enhancementProgressParams}
              />
            </div>
            <div className="flex w-full flex-col gap-2 pt-2 sm:ml-auto sm:w-56 sm:pt-0">
              {canContinueCurrentTranscript ? (
                <SecondaryButton
                  disabled={continueBusy}
                  onClick={() => void handleContinueWithCurrentTranscript()}
                  data-testid="post-processing-continue-transcript-button"
                >
                  {continueBusy
                    ? t("common.loading")
                    : t("sessionMaterials.skipEnhancement")}
                </SecondaryButton>
              ) : null}
              {canRunTranscriptEnhancement ? (
                <SecondaryButton
                  disabled={enhancementBusy || enhancementRunning}
                  onClick={() => void handleRunTranscriptEnhancement()}
                  data-testid="post-processing-run-transcript-enhancement-button"
                  className="w-full text-xs"
                >
                  {enhancementBusy || enhancementRunning
                    ? t("sessionMaterials.transcriptEnhancementInProgress")
                    : t(enhancementStartActionKey)}
                </SecondaryButton>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Step 3: AI Analysis */}
      <div
        className={`rounded-lg border px-3 py-2.5 transition-colors
          ${aiActive ? "border-violet-500/30 bg-violet-950/10" : aiDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex flex-wrap items-start gap-2">
          <StepBadge step={3} done={aiDone} active={aiActive} />
          <div
            className="min-w-0 flex-1"
            data-testid="step-ai-status"
            data-copy-kind={aiWorkflowStepCopyKind}
          >
            <p className="text-xs font-semibold text-slate-200">{t("sessionMaterials.aiAnalysis")}</p>
            <p
              className="text-xs text-slate-500"
              data-testid={
                aiWorkflowStepCopyKind === "blocked_by_enhancement"
                  ? "enhancement-ai-blocked-reason"
                  : undefined
              }
              data-copy-kind={aiWorkflowStepCopyKind}
            >
              {t(aiStepStatusKey)}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 pt-1 sm:w-auto sm:justify-end sm:pt-0">
            {canStartAi || canRetryAi || canRerunAi ? (
              <SecondaryButton
                disabled={aiBusy}
                onClick={() => void handleRunAiAnalysis()}
                data-testid="post-processing-run-ai-analysis-button"
                className="shrink-0 text-xs"
              >
                {aiBusy
                  ? t("common.loading")
                  : canRerunAi
                    ? t("sessionMaterials.rerunAiAnalysis")
                    : canRetryAi
                      ? t("sessionMaterials.retryAiAnalysis")
                      : t("room.runAiAnalysis")}
              </SecondaryButton>
            ) : null}
          </div>
        </div>
        {speakerMappingBlockingAi || mappingActionRequired ? (
          <p className="mt-1 text-xs text-amber-300">{t("room.confirmSpeakerMappingBeforeAi")}</p>
        ) : null}
        {enhancementFailedOrPartial && (canStartAi || canRetryAi) ? (
          <p className="mt-1 text-xs text-sky-200" data-testid="enhancement-continue-current-transcript">
            {t("sessionMaterials.enhancementFailedContinueHint")}
          </p>
        ) : null}
        {aiError && !speakerMappingBlockingAi ? (
          <p className="mt-1 text-xs text-rose-400">{aiError}</p>
        ) : null}
        {ai?.analysisFromOlderTranscript ? (
          <p className="mt-1 text-xs text-amber-300">{t("sessionMaterials.analysisFromOlderTranscript")}</p>
        ) : null}
      </div>

      {/* Step 4: Share */}
      {aiDone ? (
        <div
          className={`rounded-lg border px-3 py-2.5 transition-colors
            ${aiShared ? "border-emerald-500/30 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
        >
          <div className="flex items-center gap-2">
            <StepBadge step={4} done={aiShared} active={false} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200">{t("room.shareWithParticipants")}</p>
              <p className="text-xs text-slate-500">
                {aiShared ? t("room.sharedWithParticipants") : t("sessionMaterials.aiAnalysisFacilitatorBadge")}
              </p>
            </div>
            {canShareAi && !aiShared ? (
              <SecondaryButton
                disabled={sharingBusy}
                onClick={() => void handleShareAnalysis()}
                data-testid="post-processing-share-analysis-button"
                className="shrink-0 text-xs"
              >
                {sharingBusy ? t("sessionMaterials.sharing") : t("room.shareWithParticipants")}
              </SecondaryButton>
            ) : aiShared ? (
              <SecondaryButton
                disabled={unsharingBusy}
                onClick={() => void handleUnshareAnalysis()}
                data-testid="post-processing-unshare-analysis-button"
                className="shrink-0 text-xs"
              >
                {unsharingBusy ? t("common.loading") : t("room.stopSharing")}
              </SecondaryButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  const statusStrip = statusData ? (
    <div
      className={
        isSidebar
          ? "space-y-2"
          : "grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-5"
      }
      data-testid="post-processing-status-strip"
    >
      <StatusPill
        title={t("sessionMaterials.recording")}
        stage={statusData.postProcessing?.stages.RECORDING.semantic ?? recording?.processingStage ?? "not_available"}
        stageKeys={{ ...recordingStageKeys, ...semanticStageKeys }}
        testId="post-processing-recording-status"
      />
      <StatusPill
        title={t("sessionMaterials.transcription")}
        stage={generationCurrentness.transcriptionSemantic}
        stageKeys={{ ...transcriptionStageKeys, ...semanticStageKeys }}
        testId="post-processing-transcription-status"
      />
      <StatusPill
        title={t("sessionMaterials.transcriptEnhancement")}
        stage={enhancementRailStage}
        stageKeys={{
          ...enhancementStageKeys,
          ...enhancementSemanticStageKeys,
          SKIPPED: skippedEnhancementReadySentenceKey(skippedEnhancementCopyVariant),
          informational: skippedEnhancementReadySentenceKey(skippedEnhancementCopyVariant),
          skipped: skippedEnhancementHeadlineKey(skippedEnhancementCopyVariant),
        }}
        testId="post-processing-enhancement-status"
      />
      <StatusPill
        title={t("sessionMaterials.speakerMapping")}
        stage={generationCurrentness.mappingSemantic}
        stageKeys={speakerMappingStageKeys}
        resolveTone={resolveSpeakerMappingRailTileTone}
        testId="post-processing-mapping-status"
      />
      <StatusPill
        title={t("sessionMaterials.aiAnalysis")}
        stage={generationCurrentness.aiSemantic}
        stageKeys={{ ...aiStageKeys, ...semanticStageKeys }}
        testId="post-processing-ai-status"
      />
    </div>
  ) : null;

  const navigationLinks = showNavigation || (!isFacilitator && isSidebar) ? (
    <div className={`flex flex-wrap gap-2 ${isSidebar ? "flex-col" : ""}`}>
      {canOpenMaterials ? (
        <GradientButtonLink
          href={materialsPath}
          target={isSidebar ? "_blank" : undefined}
          rel={isSidebar ? "noopener noreferrer" : undefined}
          className={isSidebar ? "w-full justify-center" : undefined}
          data-testid={
            isSidebar ? "debrief-open-materials-button" : "post-processing-open-materials-button"
          }
        >
          {t("room.viewMaterials")}
        </GradientButtonLink>
      ) : null}
      {eventLobbyUrl && isFacilitator ? (
        <GradientButtonLink
          href={eventLobbyUrl}
          className={isSidebar ? "w-full justify-center" : undefined}
          data-testid="post-processing-return-lobby-button"
        >
          {t("room.returnToEventLobby")}
        </GradientButtonLink>
      ) : null}
      {!isFacilitator && !canViewAi ? (
        <p className="text-center text-xs text-slate-500 italic">
          {t("room.aiAnalysisNotShared")}
        </p>
      ) : null}
    </div>
  ) : null;

  const showDebriefFallback = Boolean(
    isSidebar && !isFacilitator && fallbackContext,
  );
  const shouldDisplayFallbackInsteadOfAi = showDebriefFallback && (!canViewAi || !analysisJson);
  const debriefFallbackContent = shouldDisplayFallbackInsteadOfAi ? (
    <Card data-testid="debrief-fallback-content">
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-50">
          {t("join.publicContext")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-300">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t("join.caseDescription")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-slate-300">
            {fallbackContext?.publicContext.description}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t("join.publicInstructions")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-slate-300">
            {fallbackContext?.publicContext.publicInstructions}
          </p>
        </div>
        {fallbackContext?.participantType === "PARTICIPANT" &&
        fallbackContext.caseRole ? (
          <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3">
            <p className="text-xs uppercase tracking-wide text-violet-300">
              {t("join.yourRoleTitle", { name: fallbackContext.caseRole.name })}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-violet-100">
              {fallbackContext.caseRole.privateInstructions}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  ) : null;

  const aiContent = showAiSection ? (
    <Card id="ai-section" data-testid="post-processing-ai-section">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessionMaterials.aiAnalysis")}
          </h2>
        {canViewAi && analysisJson && generationCurrentness.aiCurrent && isFacilitatorView ? (
            <span className="rounded border border-amber-500/40 bg-amber-900/20 px-2 py-0.5 text-xs text-amber-300">
              {t("sessionMaterials.aiAnalysisFacilitatorBadge")}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isFacilitator && !canViewAi && ai?.participantPlaceholder ? (
          <p className="text-sm text-slate-400">{t("sessionMaterials.aiAnalysisNotSharedYet")}</p>
        ) : null}

        {!ai?.participantPlaceholder && aiStatusMessageKey ? (
          <p
            className="text-sm text-slate-400"
            data-testid="post-processing-ai-status-message"
          >
            {t(aiStatusMessageKey)}
          </p>
        ) : null}

        {isFacilitatorView &&
        (ai?.processingStage === "queued" ||
          ai?.processingStage === "analyzing") ? (
          <AiAnalysisPendingReport />
        ) : null}

        {ai?.processingStage === "failed" && ai.errorMessage ? (
          <p className="text-sm text-rose-400">{ai.errorMessage}</p>
        ) : null}

        {aiRenderValidationError ? (
          <p
            className="text-sm text-rose-400"
            data-testid="ai-analysis-invalid-result"
          >
            {aiRenderValidationError}
          </p>
        ) : null}

        {canViewAi && analysisJson && generationCurrentness.aiCurrent ? (
          <AiAnalysisReport analysis={analysisJson} isFacilitator={isFacilitatorView} />
        ) : null}

        {!isFacilitator && canViewAi ? (
          <p className="text-xs text-cyan-300">{t("sessionMaterials.aiAnalysisSharedBadge")}</p>
        ) : null}
      </CardContent>
    </Card>
  ) : null;

  const aiWarningModal = aiWarningOpen ? (
    <AiProcessingWarningModal
      qualityNoticeKind={aiTranscriptQualityNotice}
      onConfirm={() => void handleRunAiAnalysisConfirmed()}
      onCancel={() => setAiWarningOpen(false)}
    />
  ) : null;

  const aiUnsavedWarnDialog = (
    <ConfirmDialog
      open={aiUnsavedWarnOpen}
      title={t("sessionMaterials.aiAnalysis")}
      description={t("sessionMaterials.enhancementUnsavedLexicalWarn")}
      cancelLabel={t("common.cancel")}
      confirmLabel={t("recording.materialChangeConfirm")}
      testId="enhancement-unsaved-lexical-ai-dialog"
      onCancel={() => setAiUnsavedWarnOpen(false)}
      onConfirm={() => {
        setAiUnsavedWarnOpen(false);
        setAiWarningOpen(true);
      }}
    />
  );

  const shareWarningModal = shareWarningOpen ? (
    <ShareDebriefWarningModal
      onConfirm={() => void handleShareAnalysisConfirmed()}
      onCancel={() => setShareWarningOpen(false)}
    />
  ) : null;

  const rerunConfirmDialog = (
    <ConfirmDialog
      open={rerunConfirmOpen}
      title={t("recording.rerunTranscriptionConfirmTitle")}
      description={t("sessionMaterials.rerunTranscriptionConfirmBody")}
      cancelLabel={t("recording.rerunTranscriptionCancel")}
      confirmLabel={t("recording.rerunTranscriptionConfirm")}
      confirming={rerunBusy || awaitingAuthoritativePostRetranscriptionStatus}
      testId="retranscribe-confirm-dialog"
      onCancel={() => {
        if (!rerunBusy && !awaitingAuthoritativePostRetranscriptionStatus) {
          setRerunConfirmOpen(false);
        }
      }}
      onConfirm={() => void handleRerunTranscription()}
    />
  );

  if (isSidebar) {
    return (
      <>
        {aiWarningModal}
        {aiUnsavedWarnDialog}
        {shareWarningModal}
        {rerunConfirmDialog}
      <div
        className="space-y-4"
        data-testid="session-post-processing-panel"
        data-transcription-active={generationCurrentness.transcriptionActive ? "true" : "false"}
        data-enhancement-current={generationCurrentness.enhancementCurrent ? "true" : "false"}
        data-mapping-current={generationCurrentness.mappingCurrent ? "true" : "false"}
        data-ai-current={generationCurrentness.aiCurrent ? "true" : "false"}
      >
        {sidebarStepsBar}
        {showTranscriptionSection ? (
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/30">
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {t("sessions.recordingAndTranscription")}
              </p>
              <button
                type="button"
                data-testid="toggle-transcript-section"
                aria-expanded={!transcriptCollapsed}
                data-state={transcriptCollapsed ? "collapsed" : "expanded"}
                onClick={() => setTranscriptCollapsed((v) => !v)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {transcriptCollapsed ? t("sessions.expandTranscript") : t("sessions.collapseTranscript")}
              </button>
            </div>
            {transcriptionActive ? (
              <div className="border-t border-cyan-500/20 bg-cyan-950/10 px-3 py-2 text-center">
                <p className="text-xs text-cyan-300">
                  {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.transcriptionInProgress")}
                </p>
                {canStopTranscription ? (
                  <div className="mt-2 flex justify-center">
                    <SecondaryButton
                      disabled={stopTranscriptionBusy}
                      onClick={() => void handleStopTranscription()}
                      data-testid="post-processing-stop-transcription-button"
                      className="text-xs"
                    >
                      {stopTranscriptionBusy
                        ? t("common.loading")
                        : t("sessionMaterials.stopTranscription")}
                    </SecondaryButton>
                  </div>
                ) : null}
              </div>
            ) : null}
            {!transcriptCollapsed ? (
              <div className="px-3 pb-3 pt-2">
                <RecordingTranscriptionSection
                  key={transcriptionSectionRefreshKey}
                  sessionId={sessionId}
                  roomAuth={roomAuth}
                  // Auto-start is orchestrated by this panel via /materials/transcribe.
                  // Keep child section auto-start disabled to prevent duplicate starts.
                  autoTranscribeEnabled={false}
                  embedded
                  compact
                  presentation={recordingTranscriptionPresentation}
                  hideRerunControls
                  isLocked={generationCurrentness.transcriptionActive}
                  canonicalTranscriptionStage={transcriptionStage}
                  canonicalRetranscribeCount={transcript?.retranscribeCount ?? null}
                  aiAdmissionCompleted={aiAdmissionCompleted}
                  {...transcriptionSectionEnhancementProps}
                  onProcessingChange={() => void fetchStatus()}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {debriefFallbackContent}
        {debriefNotesContent}
        {shouldDisplayFallbackInsteadOfAi ? null : aiContent}
        {navigationLinks}
      </div>
      </>
    );
  }

  return (
    <>
      {aiWarningModal}
      {aiUnsavedWarnDialog}
      {shareWarningModal}
      {rerunConfirmDialog}
    <div
      className="space-y-6"
      data-testid="session-post-processing-panel"
      data-transcription-active={generationCurrentness.transcriptionActive ? "true" : "false"}
      data-enhancement-current={generationCurrentness.enhancementCurrent ? "true" : "false"}
      data-mapping-current={generationCurrentness.mappingCurrent ? "true" : "false"}
      data-ai-current={generationCurrentness.aiCurrent ? "true" : "false"}
    >
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessions.postProcessingTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {t("sessions.postProcessingDescription")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusStrip}
          {stepsBar}
        </CardContent>
      </Card>

      {showTranscriptionSection ? (
        <Card id="transcription-section">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-50">
                {t("sessions.recordingAndTranscription")}
              </h2>
              <button
                type="button"
                data-testid="toggle-transcript-section"
                aria-expanded={!transcriptCollapsed}
                data-state={transcriptCollapsed ? "collapsed" : "expanded"}
                onClick={() => setTranscriptCollapsed((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-700/40"
              >
                {transcriptCollapsed ? t("sessions.expandTranscript") : t("sessions.collapseTranscript")}
              </button>
            </div>
          </CardHeader>
          {transcriptionActive ? (
            <CardContent className="border-t border-cyan-500/20 bg-cyan-950/10">
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-cyan-300">
                  {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.transcriptionInProgress")}
                </p>
                <p className="text-xs text-slate-500">
                  {t("sessionMaterials.transcriptionInProgressDescription")}
                </p>
                {canStopTranscription ? (
                  <SecondaryButton
                    disabled={stopTranscriptionBusy}
                    onClick={() => void handleStopTranscription()}
                    data-testid="post-processing-stop-transcription-button"
                  >
                    {stopTranscriptionBusy
                      ? t("common.loading")
                      : t("sessionMaterials.stopTranscription")}
                  </SecondaryButton>
                ) : null}
              </div>
            </CardContent>
          ) : null}
          {!transcriptCollapsed ? (
            <CardContent>
              <RecordingTranscriptionSection
                key={transcriptionSectionRefreshKey}
                sessionId={sessionId}
                roomAuth={roomAuth}
                // Auto-start is orchestrated by this panel via /materials/transcribe.
                // Keep child section auto-start disabled to prevent duplicate starts.
                autoTranscribeEnabled={false}
                embedded
                presentation={recordingTranscriptionPresentation}
                hideRerunControls
                isLocked={generationCurrentness.transcriptionActive}
                canonicalTranscriptionStage={transcriptionStage}
                canonicalRetranscribeCount={transcript?.retranscribeCount ?? null}
                aiAdmissionCompleted={aiAdmissionCompleted}
                {...transcriptionSectionEnhancementProps}
                onProcessingChange={() => void fetchStatus()}
              />
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {debriefFallbackContent}
      {debriefNotesContent}
      {shouldDisplayFallbackInsteadOfAi ? null : aiContent}

      {ai?.processingStage === "failed" ? (
        <p className="text-xs text-slate-500">
          <Link href="/admin" className="text-cyan-400 hover:text-cyan-300">
            {t("recording.openDiagnostics")}
          </Link>
        </p>
      ) : null}
    </div>
    </>
  );
}

// ── AI Processing Warning Modal ──────────────────────────────────────────────

function AiProcessingWarningModal({
  onConfirm,
  onCancel,
  qualityNoticeKind,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  qualityNoticeKind: AiAnalysisTranscriptQualityNoticeKind;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="ai-analysis-warning-modal"
    >
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-semibold text-slate-50">
          {t("legal.aiAnalysisWarningTitle")}
        </h2>
        {qualityNoticeKind !== "none" ? (
          <div
            data-testid="ai-analysis-transcript-quality-notice"
            data-notice-kind={qualityNoticeKind}
            className="rounded-lg border border-violet-500/40 bg-violet-950/30 px-4 py-3"
          >
            <p className="text-sm font-semibold text-violet-100">
              {qualityNoticeKind === "skipped"
                ? t("sessionMaterials.aiAnalysisEnhancementSkippedTitle")
                : t("sessionMaterials.aiAnalysisEnhancementNotAppliedTitle")}
            </p>
            <p className="mt-1 text-sm text-violet-100/90">
              {qualityNoticeKind === "skipped"
                ? t("sessionMaterials.aiAnalysisEnhancementSkippedBody")
                : t("sessionMaterials.aiAnalysisEnhancementNotAppliedBody")}
            </p>
            {qualityNoticeKind === "skipped" ? (
              <p className="mt-1 text-sm text-violet-100/80">
                {t("sessionMaterials.aiAnalysisEnhancementSkippedHint")}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              data-testid="ai-analysis-consent-checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
            />
            <span className="text-sm text-amber-100 leading-relaxed">
              {t("legal.aiAnalysisWarningText")}
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!checked}
            onClick={onConfirm}
            data-testid="ai-analysis-confirm"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t("legal.aiAnalysisConfirm")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            data-testid="ai-analysis-cancel"
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            {t("legal.aiAnalysisCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Share Debrief Warning Modal ───────────────────────────────────────────────

function ShareDebriefWarningModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="share-debrief-warning-modal"
    >
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-semibold text-slate-50">
          {t("legal.shareDebriefWarningTitle")}
        </h2>
        <div className="rounded-lg border border-slate-700/40 bg-slate-800/40 px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              data-testid="share-debrief-consent-checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
            />
            <span className="text-sm text-slate-200 leading-relaxed">
              {t("legal.shareDebriefWarningText")}
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!checked}
            onClick={onConfirm}
            data-testid="share-debrief-confirm"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t("legal.shareDebriefConfirm")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            data-testid="share-debrief-cancel"
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            {t("legal.shareDebriefCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

