"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GradientButton, SecondaryButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  createEmptyManualSpeakerTurn,
  createManualTurnId,
  insertManualSpeakerTurnAfter,
  buildInitialManualTurnsFromPersistedSegments,
  toSubmittedManualSpeakerTurns,
  type ManualSpeakerTurnEdit,
} from "@/lib/transcription/manual-speaker-turn-edits";
import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
import {
  isPostNegotiationSessionDisplayStatus,
  type SessionDisplayStatus,
} from "@/lib/session-display-status";
import { buildParticipantOptionLabel } from "@/lib/transcription/speaker-labels";
import { shouldSyncSpeakerMappingDraft } from "@/lib/transcription/speaker-mapping-draft-sync";
import { resolveSpeakerMappingForUi } from "@/lib/transcription/speaker-mapping-state";
import {
  resolveAutoAppliedMappingSurface,
  resolvePrimaryMappingReasonI18nKey,
  resolveSpeakerMappingStatusDescriptionKey,
} from "@/lib/transcription/mapping-ui-presentation";
import {
  detailedTranscriptHydrationAttemptKey,
  isActiveTranscriptGenerationStage,
  isSpeakerMappingPresentedCurrent,
  resolveDetailedTranscriptGenerationPresentation,
  shouldHydrateDetailedTranscriptPayload,
} from "@/lib/post-processing/transcript-generation-currentness";
import {
  showRecordingStatusDetail,
  showTranscriptLanguageSelector,
  type RecordingTranscriptionPresentation,
} from "@/lib/transcription/recording-transcription-presentation";
import {
  formatTranscriptTimeRangeUi,
  formatTranscriptTimeRangeWithDurationUi,
  groupSegmentsIntoTurns,
} from "@/lib/transcription/transcript-timing";
import {
  resolveAssistedMappingSuggestion,
  resolveSpeakerReviewMode,
  type MappingConfidenceLevel,
} from "@/lib/transcription/assisted-speaker-mapping";
import { getRecordingDisplayState } from "@/lib/recording-display-state";
import { resolveTranscriptSectionEnhancementRunning } from "@/lib/post-processing/enhancement-effective-state";
import {
  authoritativeEnhancedPublicationRunIdFromMetadata,
  isLexicalEditLockedByEnhancement,
  resolveEnhancementStatusCopyKind,
  resolveEnhancementUxState,
  resolvePublishedTranscriptKind,
  resolveSkippedEnhancementCopyVariant,
  skippedEnhancementBodyKey,
  skippedEnhancementHeadlineKey,
  isEnhancementExecutionInFlight,
  isSuccessfulAtomicPublication,
  resolvePublishedTranscriptRefreshObligation,
  shouldReloadPublishedTranscript,
  shouldShowDurableEnhancementProgress,
  toProgressTemplateParams,
  transcriptPayloadIndicatesSuccessfulPublication,
  type EnhancementUxProgress,
} from "@/lib/post-processing/enhancement-ux-presentation";
import {
  materialsRetranscribePath,
  materialsTranscribePath,
} from "@/lib/transcription/transcription-routes";
import { resolveRetranscribeFailureMessage } from "@/lib/transcription/retranscribe-client-error";

type RecordingData = {
  id: string;
  status: string;
  stopOperationState?: string | null;
  recordingType: string;
  fileKey: string | null;
  fileName: string | null;
  originalSizeBytes: number | null;
  compressedSizeBytes: number | null;
  compressionStatus: string | null;
  compressionError: string | null;
  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
};

type TranscriptSegmentData = {
  id: string;
  speakerLabel: string | null;
  mappedParticipantId: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
  orderIndex: number;
  displaySpeakerLabel?: string | null;
  enhancementProvenance?: "applied" | "raw" | "edited";
};

type TranscriptData = {
  id: string;
  status?: string;
  source: "MANUAL" | "GENERATED";
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  retranscribeCount?: number;
  speakerMappingStatus?: string | null;
  mappingFailureReason?: string | null;
  mappingFailureI18nKey?: string | null;
  mappingFailureCompactI18nKey?: string | null;
  mappingFailureDetails?: Record<string, unknown> | null;
  mappingSuggestionDiagnostics?: Record<string, unknown> | null;
  speakerMapping: Record<string, string | null> | null;
  processingMetadata?: Record<string, unknown> | null;
  enhancement?: {
    status: string;
    suggested: boolean;
    reasons: string[];
    error: string | null;
  } | null;
  updatedAt: string;
  segments?: TranscriptSegmentData[];
};

type ParticipantOption = {
  id: string;
  displayName: string;
  type: string;
  roleName: string | null;
};

type DetectedSpeaker = {
  speakerLabel: string;
  displaySpeakerLabel: string;
};

type TranscriptionWarningCode =
  | "DIARIZATION_FAILED"
  | "NO_SPEAKER_LABELS"
  | "SPEAKER_LABELS_NOT_RETURNED";

type RecordingTranscriptionSectionProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  readOnly?: boolean;
  autoTranscribeEnabled?: boolean;
  /** When true, renders without outer Card wrapper (for embedding in a parent panel). */
  embedded?: boolean;
  /** Hides recording metadata grid and secondary info — for narrow sidebars. */
  compact?: boolean;
  /**
   * Presentation surface. `roomQuick` is the in-room Debrief facilitator
   * panel; `materialsDetail` is the dedicated Materials/session page.
   * Default keeps the detailed Materials controls.
   */
  presentation?: RecordingTranscriptionPresentation;
  /** Hides the built-in re-run transcription block (parent provides actions). */
  hideRerunControls?: boolean;
  /** Called after transcript/mapping changes so parent can refresh processing status. */
  onProcessingChange?: () => void;
  /** When true, disables generation-dependent mapping/lexical currentness. */
  isLocked?: boolean;
  /** Canonical materials/status transcription processing stage. */
  canonicalTranscriptionStage?: string | null;
  /** Authoritative transcript generation from materials/status. */
  canonicalRetranscribeCount?: number | null;
  /** Hide the pre-AI AUTO_SUGGESTED advisory after successful AI admission. */
  aiAdmissionCompleted?: boolean;
  /**
   * Canonical enhancement status from polled `materials/status`.
   * When provided (including `null`), this wins over a stale `/recording` snapshot.
   */
  canonicalEnhancementStatus?: string | null;
  /**
   * Rail-owned running flag from the same `materials/status` poll.
   * When provided, this is the lock authority and must match the five-card rail.
   */
  canonicalEnhancementRunning?: boolean;
  canonicalPublicationEligible?: boolean;
  canonicalLexicalEditAvailable?: boolean;
  canonicalContinueAvailable?: boolean;
  canonicalTerminalQuality?: string | null;
  canonicalExecutionStatus?: string | null;
  canonicalCancelReason?: string | null;
  canonicalSkipReason?: string | null;
  canonicalEnhancementProgress?: EnhancementUxProgress | null;
  canonicalPublishedText?: string | null;
  onContinueWithCurrentTranscript?: () => void;
  continueBusy?: boolean;
  onLexicalUnsavedChange?: (dirty: boolean) => void;
  onPublishedTranscriptRefreshPending?: (pending: boolean) => void;
};

function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function recordingStatusLabel(
  status: string,
  labels: Record<string, string>,
  unknownLabel: string,
) {
  return labels[status] ?? unknownLabel;
}

function resolveDisplayRecordingStatus(
  recordingStatus: string,
  sessionStatus: SessionDisplayStatus | null,
) {
  if (
    sessionStatus === "PAUSED" &&
    (recordingStatus === "RECORDING" ||
      recordingStatus === "STARTING" ||
      recordingStatus === "PAUSED")
  ) {
    return "RECORDING";
  }

  return recordingStatus;
}

function isRecordingReadyForTranscription(recording: RecordingData) {
  return (
    getRecordingDisplayState({
      recordingStatus: recording.status,
      stopOperationState: recording.stopOperationState,
    }) === "completed" && Boolean(recording.fileKey)
  );
}

function hasUsableTranscript(transcript: TranscriptData | null) {
  return Boolean(transcript?.text?.trim() || transcript?.diarizedText?.trim());
}

type ResolvedSpeakerDisplay = {
  speakerName: string;
  rawSpeakerLabel: string | null;
  mappingApplied: boolean;
};

function confidenceLevelLabel(
  level: MappingConfidenceLevel | null,
  t: ReturnType<typeof useI18n>["t"],
): string | null {
  if (level === "HIGH") return t("recording.confidenceHigh");
  if (level === "MEDIUM") return t("recording.confidenceMedium");
  if (level === "LOW") return t("recording.confidenceLow");
  return null;
}

function TurnEnhancementProvenanceIcon({
  provenance,
  appliedLabel,
  rawLabel,
  editedLabel,
}: {
  provenance: "applied" | "raw" | "edited";
  appliedLabel: string;
  rawLabel: string;
  editedLabel: string;
}) {
  const label =
    provenance === "applied" ? appliedLabel : provenance === "edited" ? editedLabel : rawLabel;
  const toneClassName =
    provenance === "applied"
      ? "text-emerald-400"
      : provenance === "edited"
        ? "text-amber-400"
        : "text-slate-500";
  return (
    <span
      data-testid="diarized-turn-enhancement-provenance"
      data-provenance={provenance}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 ${toneClassName}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 1.2 9.1 5h4.1L10.2 7.5 11.4 11.4 8 9.1 4.6 11.4 5.8 7.5 2.8 5h4.1L8 1.2z"
        />
      </svg>
    </span>
  );
}

function resolveSegmentSpeakerDisplay(
  segment: TranscriptSegmentData,
  speakerMapping: Record<string, string | null> | null,
  participantsById: Map<string, ParticipantOption>,
  allowMappedNames: boolean,
): ResolvedSpeakerDisplay {
  const rawSpeakerLabel =
    segment.displaySpeakerLabel ?? segment.speakerLabel ?? null;

  if (allowMappedNames && segment.speakerLabel && speakerMapping?.[segment.speakerLabel]) {
    const participant = participantsById.get(
      speakerMapping[segment.speakerLabel]!,
    );
    if (participant) {
      return {
        speakerName: participant.roleName
          ? `${participant.displayName} / ${participant.roleName}`
          : participant.displayName,
        rawSpeakerLabel,
        mappingApplied: true,
      };
    }
  }

  return {
    speakerName: rawSpeakerLabel ?? "Speaker",
    rawSpeakerLabel,
    mappingApplied: false,
  };
}

type ManualSpeakerTurn = ManualSpeakerTurnEdit;

function buildInitialManualTurnsFromTranscript(
  transcriptText: string,
): ManualSpeakerTurn[] {
  const chunks = transcriptText
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return [createEmptyManualSpeakerTurn()];
  }

  return chunks.map((chunk) => ({
    id: createManualTurnId(),
    sourceSegmentId: null,
    participantId: "",
    text: chunk,
    startSeconds: null,
    endSeconds: null,
    speakerLabel: null,
    displaySpeakerLabel: null,
    speakerSlot: null,
  }));
}

function buildInitialManualTurnsFromSegments(
  segments: TranscriptSegmentData[],
): ManualSpeakerTurn[] {
  return buildInitialManualTurnsFromPersistedSegments(segments);
}

const STATUS_POLL_INTERVAL_MS = 1_000;
const RECORDING_STATUS_STALL_MS = 45_000;

function debugSpeakerMappingClient(event: string, payload: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  console.debug("[speaker-mapping][client]", { event, ...payload });
}

export function RecordingTranscriptionSection({
  sessionId,
  roomAuth,
  readOnly = false,
  autoTranscribeEnabled = false,
  embedded = false,
  compact = false,
  presentation = "materialsDetail",
  hideRerunControls = false,
  onProcessingChange,
  isLocked = false,
  canonicalTranscriptionStage = null,
  canonicalRetranscribeCount = null,
  aiAdmissionCompleted = false,
  canonicalEnhancementStatus,
  canonicalEnhancementRunning,
  canonicalPublicationEligible,
  canonicalLexicalEditAvailable,
  canonicalTerminalQuality,
  canonicalExecutionStatus,
  canonicalCancelReason,
  canonicalSkipReason,
  canonicalEnhancementProgress,
  canonicalPublishedText,
  onLexicalUnsavedChange,
  onPublishedTranscriptRefreshPending,
}: RecordingTranscriptionSectionProps) {
  const { t, locale } = useI18n();
  const [recording, setRecording] = useState<RecordingData | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [participants, setParticipants] = useState<ParticipantOption[]>([]);
  const [detectedSpeakers, setDetectedSpeakers] = useState<DetectedSpeaker[]>(
    [],
  );
  const [speakerMappingDraft, setSpeakerMappingDraft] = useState<
    Record<string, string | null>
  >({});
  const speakerMappingDraftDirtyRef = useRef(false);
  const mountId = useId();
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedPublishedTextRef = useRef<string | null>(null);
  const publishedRefreshInFlightRef = useRef(false);
  const detailedHydrationAttemptKeyRef = useRef<string | null>(null);
  const [publicationHydration, setPublicationHydration] = useState({
    inFlightSeen: false,
    cycle: 0,
    hydratedCycle: -1,
  });
  const [transcriptText, setTranscriptText] = useState("");
  const [languageHint, setLanguageHint] = useState<"auto" | "ru" | "en">("auto");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionWarnings, setTranscriptionWarnings] = useState<
    TranscriptionWarningCode[]
  >([]);
  const [manualSpeakerModeEnabled, setManualSpeakerModeEnabled] = useState(false);
  const [manualSpeakerTurns, setManualSpeakerTurns] = useState<ManualSpeakerTurn[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionDisplayStatus | null>(
    null,
  );
  const [recordingStallState, setRecordingStallState] = useState({
    watchKey: "",
    timerFired: false,
  });
  const [transcriptionAutoFailed, setTranscriptionAutoFailed] = useState(false);
  const [transcriptionFailSessionId, setTranscriptionFailSessionId] =
    useState(sessionId);
  const autoTranscribeStartedForSessionRef = useRef<string | null>(null);
  const speakerMappingDraftTranscriptIdRef = useRef<string | null>(null);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [mappingReviewSkipped, setMappingReviewSkipped] = useState(false);
  const [appliedMappingEditorOpen, setAppliedMappingEditorOpen] = useState(false);
  const [materialChangeDialog, setMaterialChangeDialog] = useState<{
    willRevokePublication: boolean;
  } | null>(null);
  const materialChangeConfirmRef = useRef<{
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const requestMaterialChangeConfirmation = useCallback(
    (willRevokePublication: boolean) =>
      new Promise<boolean>((resolve) => {
        materialChangeConfirmRef.current?.resolve(false);
        materialChangeConfirmRef.current = { resolve };
        setMaterialChangeDialog({ willRevokePublication });
      }),
    [],
  );

  const closeMaterialChangeDialog = useCallback((confirmed: boolean) => {
    const pending = materialChangeConfirmRef.current;
    materialChangeConfirmRef.current = null;
    setMaterialChangeDialog(null);
    pending?.resolve(confirmed);
  }, []);

  const notifyProcessingChange = useCallback(() => {
    onProcessingChange?.();
  }, [onProcessingChange]);

  if (transcriptionFailSessionId !== sessionId) {
    setTranscriptionFailSessionId(sessionId);
    setTranscriptionAutoFailed(false);
  }

  const participantsById = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants],
  );

  const participantTypeLabels = useMemo(
    () => ({
      PARTICIPANT: t("participantType.PARTICIPANT"),
      OBSERVER: t("participantType.OBSERVER"),
      FACILITATOR: t("participantType.FACILITATOR"),
    }),
    [t],
  );

  const resolveDraftFromTranscript = useCallback((value: TranscriptData | null) => {
    if (!value) {
      return {};
    }
    return resolveSpeakerMappingForUi({
      speakerMapping: value.speakerMapping ?? null,
      speakerMappingStatus: value.speakerMappingStatus,
      processingMetadata: value.processingMetadata ?? null,
    });
  }, []);

  const syncSpeakerMappingDraftFromTranscript = useCallback(
    (
      nextTranscript: TranscriptData | null,
      options?: { force?: boolean; reason?: string },
    ) => {
      const nextTranscriptId = nextTranscript?.id ?? null;
      const currentTranscriptId = speakerMappingDraftTranscriptIdRef.current;
      const shouldSync = shouldSyncSpeakerMappingDraft({
        currentTranscriptId,
        nextTranscriptId,
        isDirty: speakerMappingDraftDirtyRef.current,
        force: options?.force,
      });

      if (shouldSync) {
        const resolvedDraft = resolveDraftFromTranscript(nextTranscript);
        setSpeakerMappingDraft(resolvedDraft);
        speakerMappingDraftDirtyRef.current = false;
        debugSpeakerMappingClient("draftSyncedFromServer", {
          reason: options?.reason ?? "unspecified",
          transcriptId: nextTranscriptId,
          mappingKeys: Object.keys(resolvedDraft),
        });
      } else {
        debugSpeakerMappingClient("draftPreservedLocalDirty", {
          reason: options?.reason ?? "unspecified",
          transcriptId: nextTranscriptId,
        });
      }

      speakerMappingDraftTranscriptIdRef.current = nextTranscriptId;
    },
    [resolveDraftFromTranscript],
  );

  const diarizedTurns = useMemo(() => {
    const segments = transcript?.segments ?? [];
    if (!segments.length) {
      return [];
    }

    const detailedPresentation = resolveDetailedTranscriptGenerationPresentation({
      transcriptionActive:
        isLocked ||
        isActiveTranscriptGenerationStage(canonicalTranscriptionStage) ||
        isActiveTranscriptGenerationStage(transcript?.status),
      speakerMappingStatus: transcript?.speakerMappingStatus,
      payloadRetranscribeCount: transcript?.retranscribeCount,
      authoritativeRetranscribeCount: canonicalRetranscribeCount,
      payloadStatus: transcript?.status,
      authoritativeTranscriptionStage: canonicalTranscriptionStage,
    });

    return groupSegmentsIntoTurns(
      segments,
      (segment) => {
        const resolvedSpeaker = resolveSegmentSpeakerDisplay(
          segment,
          transcript?.speakerMapping ?? null,
          participantsById,
          detailedPresentation.presentMappedParticipantNames,
        );
        const enhancementProvenance = segment.enhancementProvenance ?? "raw";
        return {
          ...resolvedSpeaker,
          enhancementProvenance: detailedPresentation.presentSegmentProvenanceDecoration
            ? enhancementProvenance
            : undefined,
          speakerKey: `${resolvedSpeaker.speakerName}::${resolvedSpeaker.rawSpeakerLabel ?? "unknown"}::${resolvedSpeaker.mappingApplied ? "mapped" : "raw"}::${enhancementProvenance}`,
        };
      },
    );
  }, [canonicalRetranscribeCount, canonicalTranscriptionStage, isLocked, participantsById, transcript]);

  const diarizedPreviewText = transcript?.diarizedText ?? "";

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/recording?${roomAuthQuery(roomAuth)}`,
        { cache: "no-store" },
      );
      const rawBody = await response.text();

      if (!rawBody) {
        throw new Error("Recording API returned an empty response.");
      }

      const payload = JSON.parse(rawBody) as {
        error?: string;
        recording: RecordingData | null;
        transcript: TranscriptData | null;
        participants?: ParticipantOption[];
        detectedSpeakers?: DetectedSpeaker[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load recording data.");
      }

      setRecording(payload.recording);
      setTranscript(payload.transcript);
      setParticipants(payload.participants ?? []);
      setDetectedSpeakers(payload.detectedSpeakers ?? []);
      setTranscriptText(payload.transcript?.text ?? "");
      lastAppliedPublishedTextRef.current = payload.transcript?.text ?? "";
      if (transcriptPayloadIndicatesSuccessfulPublication(payload.transcript?.enhancement?.status)) {
        setPublicationHydration((current) => ({
          ...current,
          hydratedCycle: current.cycle,
        }));
      }
      setMappingReviewSkipped(false);
      syncSpeakerMappingDraftFromTranscript(payload.transcript ?? null, {
        reason: "loadData",
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load recording data.",
      );
    } finally {
      setLoading(false);
    }
  }, [roomAuth, sessionId, syncSpeakerMappingDraftFromTranscript]);

  const pollRecordingStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/refresh-recording`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roomAuthBody(roomAuth)),
        },
      );

      if (response.status === 404) {
        await loadData();
        return;
      }

      const payload = (await response.json()) as {
        error?: string;
        recording?: RecordingData;
      };

      if (!response.ok) {
        return;
      }

      if (payload.recording) {
        setRecording(payload.recording);
      }
    } catch {
      // Ignore transient polling errors.
    }
  }, [roomAuth, loadData, sessionId]);

  const refreshRecordingStatus = useCallback(async () => {
    setBusyAction("refresh");

    try {
      await pollRecordingStatus();
    } finally {
      setBusyAction((current) => (current === "refresh" ? null : current));
    }
  }, [pollRecordingStatus]);

  const pollSessionStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/display-status`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        status: SessionDisplayStatus;
      };

      setSessionStatus(payload.status);
    } catch {
      // Ignore transient polling errors.
    }
  }, [sessionId]);

  const isPostNegotiation =
    isPostNegotiationSessionDisplayStatus(sessionStatus);
  const shouldWatchRecordingStall =
    !readOnly &&
    isPostNegotiation &&
    Boolean(recording) &&
    !isRecordingReadyForTranscription(recording!);

  const recordingStallWatchKey = shouldWatchRecordingStall
    ? `${sessionId}:${recording!.id}:${recording!.status}`
    : "";

  if (recordingStallState.watchKey !== recordingStallWatchKey) {
    setRecordingStallState({
      watchKey: recordingStallWatchKey,
      timerFired: false,
    });
  }

  const recordingStatusStalled =
    shouldWatchRecordingStall && recordingStallState.timerFired;

  useEffect(() => {
    if (!shouldWatchRecordingStall) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setRecordingStallState((current) =>
        current.watchKey === recordingStallWatchKey
          ? { ...current, timerFired: true }
          : current,
      );
    }, RECORDING_STATUS_STALL_MS);

    return () => window.clearTimeout(timerId);
  }, [recordingStallWatchKey, shouldWatchRecordingStall]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
      void pollSessionStatus();
    });
  }, [loadData, pollSessionStatus]);

  useEffect(() => {
    if (readOnly) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void pollSessionStatus();

      const shouldPollRecording =
        isPostNegotiationSessionDisplayStatus(sessionStatus) ||
        recording?.status === "PROCESSING" ||
        recording?.status === "STOPPED" ||
        recording?.stopOperationState === "PENDING" ||
        recording?.stopOperationState === "DELIVERING" ||
        recording?.stopOperationState === "DELIVERED";

      if (shouldPollRecording) {
        void pollRecordingStatus();
      }
    }, STATUS_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [
    pollRecordingStatus,
    pollSessionStatus,
    readOnly,
    recording?.status,
    recording?.stopOperationState,
    sessionStatus,
  ]);

  const processingMetadata =
    transcript?.processingMetadata && typeof transcript.processingMetadata === "object"
      ? (transcript.processingMetadata as Record<string, unknown>)
      : null;
  const enhancementRunning = resolveTranscriptSectionEnhancementRunning({
    canonicalEnhancementRunning,
    canonicalEnhancementStatus,
    localEnhancementStatus: transcript?.enhancement?.status ?? null,
    processingMetadata,
  });
  const enhancementUx = {
    uiStatus: canonicalEnhancementStatus ?? transcript?.enhancement?.status ?? null,
    executionStatus: canonicalExecutionStatus ?? null,
    publicationEligible: canonicalPublicationEligible,
    terminalQuality: canonicalTerminalQuality,
    cancelReason: canonicalCancelReason,
    skipReason: canonicalSkipReason,
    progress: canonicalEnhancementProgress,
    transcriptionStage: canonicalTranscriptionStage,
  };
  const transcriptGenerationActive =
    isLocked ||
    isActiveTranscriptGenerationStage(canonicalTranscriptionStage) ||
    isActiveTranscriptGenerationStage(transcript?.status);
  const detailedPresentation = resolveDetailedTranscriptGenerationPresentation({
    transcriptionActive: transcriptGenerationActive,
    speakerMappingStatus: transcript?.speakerMappingStatus,
    payloadRetranscribeCount: transcript?.retranscribeCount,
    authoritativeRetranscribeCount: canonicalRetranscribeCount,
    payloadStatus: transcript?.status,
    authoritativeTranscriptionStage: canonicalTranscriptionStage,
  });
  const detailedPayloadCurrent = detailedPresentation.detailedPayloadCurrent;
  const enhancementUxState = resolveEnhancementUxState({
    ...enhancementUx,
    retranscriptionLocked: transcriptGenerationActive,
  });
  const enhancementRunningLocal =
    enhancementUxState === "ENHANCEMENT_RUNNING" ||
    enhancementUxState === "ENHANCEMENT_RETRYING" ||
    enhancementUxState === "RAW_READY_ENHANCEMENT_STARTING";
  const lexicalLocked =
    transcriptGenerationActive ||
    (canonicalLexicalEditAvailable === false) ||
    isLexicalEditLockedByEnhancement(enhancementUx);
  const mappingLocked = transcriptGenerationActive || !detailedPayloadCurrent;
  const mappingPresentedCurrent = isSpeakerMappingPresentedCurrent({
    transcriptionActive: transcriptGenerationActive,
    speakerMappingStatus: transcript?.speakerMappingStatus,
    detailedPayloadCurrent: detailedPayloadCurrent,
  });
  const showDurableProgress = shouldShowDurableEnhancementProgress(enhancementUx);
  const progressParams = toProgressTemplateParams(canonicalEnhancementProgress);
  const publishedKind = resolvePublishedTranscriptKind(enhancementUx);
  const skippedEnhancementCopyVariant = resolveSkippedEnhancementCopyVariant({
    copyKind: resolveEnhancementStatusCopyKind(enhancementUx),
    authoritativeEnhancedPublicationRunId:
      authoritativeEnhancedPublicationRunIdFromMetadata(processingMetadata),
  });
  const showPublishedKindLabel =
    hasUsableTranscript(transcript) &&
    !enhancementRunningLocal &&
    enhancementUxState !== "ENHANCEMENT_CONTINUED";
  const legalLexicalDirty =
    Boolean(canonicalLexicalEditAvailable) &&
    (transcriptText !== (transcript?.text ?? "") || manualSpeakerModeEnabled);

  useEffect(() => {
    onLexicalUnsavedChange?.(legalLexicalDirty);
  }, [legalLexicalDirty, onLexicalUnsavedChange]);

  const refreshPublishedTranscriptQuiet = useCallback(async (): Promise<boolean> => {
    if (publishedRefreshInFlightRef.current) {
      return false;
    }
    publishedRefreshInFlightRef.current = true;
    const scrollTop = transcriptScrollRef.current?.scrollTop ?? null;
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/recording?${roomAuthQuery(roomAuth)}`,
        { cache: "no-store" },
      );
      const rawBody = await response.text();
      if (!rawBody || !response.ok) return false;
      const payload = JSON.parse(rawBody) as {
        recording: RecordingData | null;
        transcript: TranscriptData | null;
        participants?: ParticipantOption[];
        detectedSpeakers?: DetectedSpeaker[];
      };
      if (payload.recording) setRecording(payload.recording);
      if (payload.participants) setParticipants(payload.participants);
      if (payload.detectedSpeakers) setDetectedSpeakers(payload.detectedSpeakers);
      if (!payload.transcript) return false;
      setTranscript(payload.transcript);
      lastAppliedPublishedTextRef.current = payload.transcript.text ?? "";
      if (!legalLexicalDirty) {
        setTranscriptText(payload.transcript.text ?? "");
      }
      syncSpeakerMappingDraftFromTranscript(payload.transcript, {
        reason: "quietPublishedRefresh",
      });
      if (transcriptPayloadIndicatesSuccessfulPublication(payload.transcript.enhancement?.status)) {
        setPublicationHydration((current) => ({
          ...current,
          hydratedCycle: current.cycle,
        }));
      }
      return true;
    } catch {
      return false;
    } finally {
      publishedRefreshInFlightRef.current = false;
      if (scrollTop != null && transcriptScrollRef.current) {
        transcriptScrollRef.current.scrollTop = scrollTop;
      }
    }
  }, [legalLexicalDirty, roomAuth, sessionId, syncSpeakerMappingDraftFromTranscript]);

  const successfulPublication = isSuccessfulAtomicPublication(enhancementUx);
  const enhancementInFlight = isEnhancementExecutionInFlight(enhancementUx);
  if (enhancementInFlight && !publicationHydration.inFlightSeen) {
    setPublicationHydration((current) => ({
      ...current,
      inFlightSeen: true,
      hydratedCycle: -1,
    }));
  } else if (!enhancementInFlight && publicationHydration.inFlightSeen) {
    setPublicationHydration((current) => ({
      inFlightSeen: false,
      cycle: successfulPublication ? current.cycle + 1 : current.cycle,
      hydratedCycle: current.hydratedCycle,
    }));
  }

  const publishedRefreshObligation = resolvePublishedTranscriptRefreshObligation({
    enhancement: enhancementUx,
    hydratedSuccessfulPublication:
      publicationHydration.hydratedCycle === publicationHydration.cycle,
    lexicalEditAvailable: canonicalLexicalEditAvailable === true,
    unsavedLegalLexicalEdit: legalLexicalDirty,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onPublishedTranscriptRefreshPending?.(publishedRefreshObligation);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [onPublishedTranscriptRefreshPending, publishedRefreshObligation]);

  useEffect(() => {
    const textReload = shouldReloadPublishedTranscript({
      previousPublishedText: lastAppliedPublishedTextRef.current,
      nextPublishedText: canonicalPublishedText,
      lexicalEditAvailable: canonicalLexicalEditAvailable === true,
      unsavedLegalLexicalEdit: legalLexicalDirty,
    });
    if (!publishedRefreshObligation && !textReload) {
      return;
    }
    const runRefresh = () => {
      void refreshPublishedTranscriptQuiet();
    };
    const immediateId = window.setTimeout(runRefresh, 0);
    const intervalId = publishedRefreshObligation
      ? window.setInterval(runRefresh, STATUS_POLL_INTERVAL_MS)
      : null;
    return () => {
      window.clearTimeout(immediateId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [
    canonicalLexicalEditAvailable,
    canonicalPublishedText,
    legalLexicalDirty,
    publishedRefreshObligation,
    refreshPublishedTranscriptQuiet,
  ]);

  useEffect(() => {
    if (
      !shouldHydrateDetailedTranscriptPayload({
        authoritativeRetranscribeCount: canonicalRetranscribeCount,
        payloadRetranscribeCount: transcript?.retranscribeCount,
        payloadLoaded: !loading && transcript != null,
        payloadStatus: transcript?.status,
        authoritativeTranscriptionStage: canonicalTranscriptionStage,
      })
    ) {
      return;
    }
    const hydrationKey = detailedTranscriptHydrationAttemptKey({
      authoritativeRetranscribeCount: canonicalRetranscribeCount,
      authoritativeTranscriptionActive: isActiveTranscriptGenerationStage(
        canonicalTranscriptionStage,
      ),
    });
    if (detailedHydrationAttemptKeyRef.current === hydrationKey) {
      return;
    }
    detailedHydrationAttemptKeyRef.current = hydrationKey;
    void loadData();
  }, [
    canonicalRetranscribeCount,
    canonicalTranscriptionStage,
    loadData,
    loading,
    transcript,
  ]);

  const applyTranscriptPayload = useCallback((
    payload: TranscriptData,
    options?: { forceSpeakerMappingDraftSync?: boolean; reason?: string },
  ) => {
    setTranscript(payload);
    setTranscriptText(payload.text);
    setMappingReviewSkipped(false);
    syncSpeakerMappingDraftFromTranscript(payload, {
      force: options?.forceSpeakerMappingDraftSync ?? false,
      reason: options?.reason ?? "applyTranscriptPayload",
    });
    const segments = payload.segments ?? [];
    setDetectedSpeakers(
      segments.reduce<DetectedSpeaker[]>((labels, segment) => {
        if (
          !segment.speakerLabel ||
          labels.some((label) => label.speakerLabel === segment.speakerLabel)
        ) {
          return labels;
        }

        labels.push({
          speakerLabel: segment.speakerLabel,
          displaySpeakerLabel:
            segment.displaySpeakerLabel ?? segment.speakerLabel,
        });
        return labels;
      }, []),
    );
  }, [syncSpeakerMappingDraftFromTranscript]);

  const transcribe = useCallback(async () => {
    if (!recording?.id) return;

    setBusyAction("transcribe");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(materialsTranscribePath(sessionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...roomAuthBody(roomAuth),
          language: languageHint,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        warnings?: TranscriptionWarningCode[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Transcription failed.");
      }

      await loadData();
      setTranscriptionWarnings(payload.warnings ?? []);
      setTranscriptionAutoFailed(false);
      setMessage(t("recording.transcriptSaved"));
      notifyProcessingChange();
    } catch (transcribeError) {
      setTranscriptionAutoFailed(true);
      setError(
        transcribeError instanceof Error
          ? transcribeError.message
          : "Transcription failed.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [loadData, roomAuth, languageHint, notifyProcessingChange, recording, sessionId, t]);

  const rerunTranscription = useCallback(async () => {
    setRerunConfirmOpen(false);
    setBusyAction("rerun");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        materialsRetranscribePath(sessionId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...roomAuthBody(roomAuth), language: languageHint }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        code?: string;
        status?: string;
      };

      if (!response.ok) {
        throw new Error(
          resolveRetranscribeFailureMessage(
            payload,
            t,
            `${t("recording.rerunTranscription")} failed.`,
          ),
        );
      }

      // Reload all data to pick up the new transcript + segments
      await loadData();
      setMessage(t("recording.transcriptSaved"));
      notifyProcessingChange();
    } catch (rerunError) {
      setError(
        rerunError instanceof Error ? rerunError.message : "Re-run failed.",
      );
    } finally {
      setBusyAction((current) => (current === "rerun" ? null : current));
    }
  }, [roomAuth, languageHint, loadData, notifyProcessingChange, sessionId, t]);

  const isWaitingForRecordingReady =
    isPostNegotiation &&
    Boolean(recording) &&
    !isRecordingReadyForTranscription(recording!);

  const canTranscribeRecording =
    !readOnly &&
    isPostNegotiation &&
    Boolean(recording) &&
    !hasUsableTranscript(transcript) &&
    isRecordingReadyForTranscription(recording!);

  useEffect(() => {
    if (!autoTranscribeEnabled) {
      return;
    }
    if (!canTranscribeRecording || busyAction != null) {
      return;
    }

    if (autoTranscribeStartedForSessionRef.current === sessionId) {
      return;
    }

    autoTranscribeStartedForSessionRef.current = sessionId;
    void transcribe();
  }, [autoTranscribeEnabled, busyAction, canTranscribeRecording, sessionId, transcribe]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  };

  const saveTranscript = async () => {
    setBusyAction("save");
    setError(null);
    setMessage(null);

    try {
      const requestBody = { ...roomAuthBody(roomAuth), text: transcriptText };
      let response = await fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      let payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
        willRevokePublication?: boolean;
        transcript?: TranscriptData;
      };
      if (
        response.status === 409 &&
        payload.errorCode === "MATERIAL_CHANGE_CONFIRMATION_REQUIRED"
      ) {
        const confirmed = await requestMaterialChangeConfirmation(
          payload.willRevokePublication === true,
        );
        if (!confirmed) {
          return;
        }
        response = await fetch(`/api/sessions/${sessionId}/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...requestBody,
            confirmRewindPublication: true,
          }),
        });
        payload = (await response.json()) as typeof payload;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Save failed.");
      }

      if (payload.transcript) {
        setTranscript((current) =>
          current
            ? {
                ...current,
                source: payload.transcript!.source,
                text: payload.transcript!.text,
                diarizedText: payload.transcript!.diarizedText,
                hasSpeakerDiarization: payload.transcript!.hasSpeakerDiarization,
                updatedAt: payload.transcript!.updatedAt,
              }
            : null,
        );
      }

      setMessage(t("recording.transcriptSaved"));
      notifyProcessingChange();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const saveSpeakerMapping = async (options?: {
    applyOnly?: boolean;
    confirm?: boolean;
    mappingOverride?: Record<string, string | null>;
  }) => {
    const applyOnly = options?.applyOnly ?? false;
    const confirm = options?.confirm ?? false;
    const mappingToSave = options?.mappingOverride ?? speakerMappingDraft;
    setBusyAction(applyOnly ? "apply-mapping" : confirm ? "confirm-mapping" : "save-mapping");
    setError(null);
    setMessage(null);
    debugSpeakerMappingClient("saveRequested", {
      sessionId,
      transcriptId: transcript?.id ?? null,
      applyOnly,
      confirm,
      draftKeys: Object.keys(mappingToSave),
    });

    try {
      let response = await fetch(
        `/api/sessions/${sessionId}/speaker-mapping`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...roomAuthBody(roomAuth),
            transcriptId: transcript?.id,
            expectedRetranscribeCount: transcript?.retranscribeCount ?? 0,
            mapping: mappingToSave,
            applyOnly,
            confirm,
          }),
        },
      );
      let payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
        willRevokePublication?: boolean;
        transcript?: TranscriptData;
      };
      if (
        response.status === 409 &&
        payload.errorCode === "MATERIAL_CHANGE_CONFIRMATION_REQUIRED"
      ) {
        const confirmed = await requestMaterialChangeConfirmation(
          payload.willRevokePublication === true,
        );
        if (!confirmed) {
          return;
        }
        response = await fetch(`/api/sessions/${sessionId}/speaker-mapping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...roomAuthBody(roomAuth),
            transcriptId: transcript?.id,
            expectedRetranscribeCount: transcript?.retranscribeCount ?? 0,
            mapping: mappingToSave,
            applyOnly,
            confirm,
            confirmRewindPublication: true,
          }),
        });
        payload = (await response.json()) as typeof payload;
      }
      debugSpeakerMappingClient("saveResponseStatus", {
        sessionId,
        transcriptId: transcript?.id ?? null,
        status: response.status,
      });

      if (
        response.status === 409 &&
        payload.errorCode === "generation_mismatch"
      ) {
        setError(t("recording.speakerMappingGenerationMismatch"));
        notifyProcessingChange();
        void refreshPublishedTranscriptQuiet();
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Save failed.");
      }

      if (payload.transcript) {
        applyTranscriptPayload(payload.transcript, {
          forceSpeakerMappingDraftSync: true,
          reason: "saveSpeakerMappingSuccess",
        });
      }
      debugSpeakerMappingClient("saveApplied", {
        sessionId,
        transcriptId: payload.transcript?.id ?? transcript?.id ?? null,
        mappingKeys: Object.keys(payload.transcript?.speakerMapping ?? {}),
      });

      setMessage(t("recording.speakerMappingSaved"));
      notifyProcessingChange();
    } catch (mappingError) {
      debugSpeakerMappingClient("saveFailed", {
        sessionId,
        transcriptId: transcript?.id ?? null,
        error: mappingError instanceof Error ? mappingError.message : "Save failed.",
      });
      setError(
        mappingError instanceof Error ? mappingError.message : "Save failed.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const startManualSpeakerMode = useCallback(() => {
    const sourceSegments = transcript?.segments ?? [];
    setManualSpeakerTurns(
      sourceSegments.length > 0
        ? buildInitialManualTurnsFromSegments(sourceSegments)
        : buildInitialManualTurnsFromTranscript(transcriptText),
    );
    setManualSpeakerModeEnabled(true);
  }, [transcript, transcriptText]);

  const saveManualSpeakerAttribution = useCallback(async () => {
    const normalizedTurns = toSubmittedManualSpeakerTurns(manualSpeakerTurns);

    if (
      normalizedTurns.length === 0 ||
      normalizedTurns.some(
        (turn) => turn.text.trim().length > 0 && turn.participantId.length === 0,
      )
    ) {
      setError(t("recording.manualSpeakerAttributionRequiredFields"));
      return;
    }

    setBusyAction("manual-speaker-attribution");
    setError(null);
    setMessage(null);

    try {
      const requestBody = {
        ...roomAuthBody(roomAuth),
        turns: normalizedTurns,
      };
      let response = await fetch(
        `/api/sessions/${sessionId}/manual-speaker-attribution`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
      );

      let payload = (await response.json()) as {
        error?: string;
        errorCode?: string;
        willRevokePublication?: boolean;
        transcript?: TranscriptData;
      };
      if (
        response.status === 409 &&
        payload.errorCode === "MATERIAL_CHANGE_CONFIRMATION_REQUIRED"
      ) {
        const confirmed = await requestMaterialChangeConfirmation(
          payload.willRevokePublication === true,
        );
        if (!confirmed) {
          return;
        }
        response = await fetch(
          `/api/sessions/${sessionId}/manual-speaker-attribution`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...requestBody,
              confirmRewindPublication: true,
            }),
          },
        );
        payload = (await response.json()) as typeof payload;
      }

      if (!response.ok || !payload.transcript) {
        throw new Error(payload.error ?? "Save failed.");
      }

      applyTranscriptPayload(payload.transcript);
      setTranscriptionWarnings([]);
      setManualSpeakerModeEnabled(false);
      setMessage(t("recording.transcriptSaved"));
      notifyProcessingChange();
    } catch (manualAttributionError) {
      setError(
        manualAttributionError instanceof Error
          ? manualAttributionError.message
          : "Save failed.",
      );
    } finally {
      setBusyAction(null);
    }
  }, [applyTranscriptPayload, requestMaterialChangeConfirmation, roomAuth, manualSpeakerTurns, notifyProcessingChange, sessionId, t]);

  const copyDiarizedTranscript = async () => {
    const textToCopy = diarizedPreviewText || diarizedTurns
      .map((turn) => `[${turn.speakerName}] ${turn.text}`)
      .join("\n\n");

    if (!textToCopy) {
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      setMessage(t("recording.diarizedTranscriptCopied"));
    } catch {
      setError("Copy failed.");
    }
  };

  const showServiceAlert =
    recording?.status === "FAILED" || Boolean(recording?.errorMessage);

  const warningMessages = useMemo(() => {
    const messages: string[] = [];

    for (const warning of transcriptionWarnings) {
      if (warning === "DIARIZATION_FAILED") {
        messages.push(t("recording.diarizationFailed"));
      } else if (warning === "NO_SPEAKER_LABELS") {
        messages.push(t("recording.noSpeakerLabelsDetected"));
      } else if (warning === "SPEAKER_LABELS_NOT_RETURNED") {
        messages.push(t("recording.speakerLabelsNotReturned"));
      }
    }

    if (
      transcript?.source === "GENERATED" &&
      transcript.status === "COMPLETED" &&
      transcriptionWarnings.length === 0
    ) {
      if (
        transcript.transcriptionModel === "gpt-4o-transcribe-diarize" &&
        !transcript.hasSpeakerDiarization
      ) {
        messages.push(t("recording.speakerLabelsNotReturned"));
      } else if (
        transcript.transcriptionModel &&
        transcript.transcriptionModel !== "gpt-4o-transcribe-diarize" &&
        !transcript.hasSpeakerDiarization
      ) {
        messages.push(t("recording.diarizationFailed"));
      }
    }

    return messages;
  }, [t, transcript, transcriptionWarnings]);

  const recordingStatusLabels = {
    NOT_STARTED: t("recording.recordingNotStarted"),
    STARTING: t("recording.recordingStarting"),
    RECORDING: t("recording.recordingInProgress"),
    PAUSED: t("recording.recordingPaused"),
    PROCESSING: t("recording.recordingProcessing"),
    COMPLETED: t("recording.recordingCompleted"),
    FAILED: t("recording.recordingFailed"),
    STOPPED: t("recording.recordingStopped"),
    STOPPING: t("recording.recordingStopping"),
  };

  const displayRecordingStatus = recording
    ? resolveDisplayRecordingStatus(recording.status, sessionStatus)
    : null;
  const stopOperationFailed = recording?.stopOperationState === "FAILED";
  const displayRecordingSemanticState = stopOperationFailed
    ? "failed"
    : getRecordingDisplayState({
        recordingStatus: displayRecordingStatus,
        stopOperationState: recording?.stopOperationState,
        sessionStatus,
      });
  const recordingStateForLabel =
    displayRecordingSemanticState === "stopping"
      ? "STOPPING"
      : displayRecordingSemanticState === "failed"
        ? "FAILED"
        : displayRecordingStatus;

  const renderRecordingStatusDetail = showRecordingStatusDetail(presentation);
  const renderLanguageSelector =
    showTranscriptLanguageSelector(presentation) && !readOnly;

  const showPauseRecordingNotice = sessionStatus === "PAUSED";
  const showActiveRecordingNotice =
    sessionStatus === "RUNNING" &&
    (displayRecordingStatus === "RECORDING" ||
      displayRecordingStatus === "STARTING");
  const showAutoRefreshStatus = !readOnly && isWaitingForRecordingReady && !recordingStatusStalled;
  const showRefreshFallback =
    !readOnly && isWaitingForRecordingReady && recordingStatusStalled;
  const showAutoTranscribeStatus =
    !readOnly && canTranscribeRecording && busyAction === "transcribe";
  const showTranscribeFallback =
    !readOnly && canTranscribeRecording && transcriptionAutoFailed && busyAction !== "transcribe";
  const showManualSpeakerAttributionFallback =
    !readOnly &&
    transcript?.source === "GENERATED" &&
    !transcript.hasSpeakerDiarization &&
    hasUsableTranscript(transcript);
  const lexicalEditorLocked = lexicalLocked;
  const mappingControlsLocked = mappingLocked;
  const preprocessingSkipped = processingMetadata?.preprocessingSkipped === true;
  const preprocessingReason =
    typeof processingMetadata?.preprocessingTriggerReason === "string"
      ? processingMetadata.preprocessingTriggerReason
      : null;
  const transcriptionInputSizeBytes =
    typeof processingMetadata?.transcriptionInputSizeBytes === "number"
      ? processingMetadata.transcriptionInputSizeBytes
      : recording?.compressedSizeBytes ?? null;

  const speakersForMapping =
    detectedSpeakers.length > 0
      ? detectedSpeakers
      : (transcript?.segments ?? []).reduce<DetectedSpeaker[]>((labels, segment) => {
          if (
            !segment.speakerLabel ||
            labels.some((label) => label.speakerLabel === segment.speakerLabel)
          ) {
            return labels;
          }

          labels.push({
            speakerLabel: segment.speakerLabel,
            displaySpeakerLabel:
              segment.displaySpeakerLabel ?? segment.speakerLabel,
          });
          return labels;
        }, []);

  const hasFullyMappedSegments = useMemo(() => {
    const segments = transcript?.segments ?? [];
    const spokenSegments = segments.filter((segment) => segment.text.trim().length > 0);
    if (spokenSegments.length === 0) {
      return false;
    }
    return spokenSegments.every((segment) => Boolean(segment.mappedParticipantId));
  }, [transcript?.segments]);

  const mappingEditorEligible =
    speakersForMapping.length > 0 &&
    !readOnly &&
    !mappingControlsLocked &&
    !manualSpeakerModeEnabled &&
    transcript?.source !== "MANUAL";
  const shouldShowSpeakerMappingPanel =
    mappingEditorEligible &&
    (!hasFullyMappedSegments || appliedMappingEditorOpen);

  const allSpeakersMappedInDraft = useMemo(() => {
    if (speakersForMapping.length === 0) {
      return false;
    }
    return speakersForMapping.every((speaker) =>
      Boolean(speakerMappingDraft[speaker.speakerLabel]),
    );
  }, [speakerMappingDraft, speakersForMapping]);

  const speakerSuggestion = useMemo(
    () =>
      resolveAssistedMappingSuggestion({
        mappingSuggestionDiagnostics: transcript?.mappingSuggestionDiagnostics ?? null,
      }),
    [transcript?.mappingSuggestionDiagnostics],
  );

  const speakerLabels = useMemo(
    () => speakersForMapping.map((speaker) => speaker.speakerLabel),
    [speakersForMapping],
  );

  const hasFullSuggestedMapping = speakerSuggestion.hasFullSuggestionForSpeakers(
    speakerLabels,
  );
  const hasAnySuggestedMapping = speakerSuggestion.hasAnySuggestion;
  const mappingStatusDescriptionKey = resolveSpeakerMappingStatusDescriptionKey({
    speakerMappingStatus: transcript?.speakerMappingStatus,
    hasSuggestedMapping: hasAnySuggestedMapping,
  });
  const primaryMappingReasonI18nKey = resolvePrimaryMappingReasonI18nKey({
    speakerMappingStatus: transcript?.speakerMappingStatus,
    mappingFailureI18nKey: transcript?.mappingFailureI18nKey ?? null,
    mappingFailureCompactI18nKey: transcript?.mappingFailureCompactI18nKey ?? null,
    mappingSuggestionDiagnostics: transcript?.mappingSuggestionDiagnostics ?? null,
  });

  const reviewMode = resolveSpeakerReviewMode({
    speakerMappingStatus: transcript?.speakerMappingStatus,
    speakersCount: speakersForMapping.length,
    isEditable: !readOnly && !mappingControlsLocked,
    manualSpeakerModeEnabled,
    transcriptSource: transcript?.source,
    mappingReviewSkipped,
    aiAdmissionCompleted,
    transcriptionActive: transcriptGenerationActive || !detailedPayloadCurrent,
  });
  const showAssistedReviewCard = reviewMode === "REVIEW_CARD";
  const showAutoAppliedNote = reviewMode === "AUTO_APPLIED_NOTE";
  const autoAppliedMappingSurface = resolveAutoAppliedMappingSurface({
    speakerMappingStatus: transcript?.speakerMappingStatus,
    aiAdmissionCompleted,
    mappingLocked: mappingControlsLocked,
    readOnly,
    mappingEditorVisible:
      (shouldShowSpeakerMappingPanel && !showAssistedReviewCard) ||
      showAssistedReviewCard,
  });
  const showAutoAppliedReviewAction =
    showAutoAppliedNote &&
    mappingEditorEligible &&
    autoAppliedMappingSurface === "notice_with_review_action";

  const content = (
    <div
      data-testid="recording-transcription-section"
      data-mount-id={mountId}
      data-enhancement-ux-state={enhancementUxState}
      data-publication-eligible={canonicalPublicationEligible ? "true" : "false"}
      data-lexical-locked={lexicalEditorLocked ? "true" : "false"}
      data-mapping-editable={!readOnly && !mappingControlsLocked ? "true" : "false"}
      data-mapping-current={mappingPresentedCurrent ? "true" : "false"}
      data-detailed-payload-current={detailedPayloadCurrent ? "true" : "false"}
      data-transcript-generation-active={transcriptGenerationActive ? "true" : "false"}
      className="space-y-6"
    >
        {loading ? (
          <p className="text-sm text-slate-400" data-testid="recording-transcription-initial-loading">
            {t("common.loading")}...
          </p>
        ) : (
          <>
            {transcriptGenerationActive ? (
              <div
                data-testid="transcript-generation-noncurrent"
                className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-100"
              >
                <p>{t("sessionMaterials.transcriptionInProgress")}</p>
                {(transcript?.speakerMappingStatus === "CONFIRMED" ||
                  transcript?.speakerMappingStatus === "AUTO_SUGGESTED") ? (
                  <p
                    className="mt-1 text-xs text-cyan-200/80"
                    data-testid="prior-mapping-noncurrent"
                  >
                    {t("sessionMaterials.waitingForTranscript")}
                  </p>
                ) : null}
              </div>
            ) : !detailedPayloadCurrent &&
              (transcript?.speakerMappingStatus === "CONFIRMED" ||
                transcript?.speakerMappingStatus === "AUTO_SUGGESTED") ? (
              <div
                data-testid="transcript-generation-noncurrent"
                className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-100"
              >
                <p
                  className="text-xs text-cyan-200/80"
                  data-testid="prior-mapping-noncurrent"
                >
                  {t("sessionMaterials.waitingForTranscript")}
                </p>
              </div>
            ) : null}
            {enhancementRunningLocal ? (
              <div
                data-testid={lexicalEditorLocked ? "transcript-lexical-view-only" : undefined}
              >
                <div
                  data-testid="transcript-enhancement-running-lock"
                  className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-950/20 px-4 py-3 text-sm text-violet-100"
                >
                  <p
                    data-testid={
                      showDurableProgress && progressParams ? "enhancement-progress" : undefined
                    }
                  >
                    {showDurableProgress && progressParams
                      ? t("sessionMaterials.enhancementTranscriptLocalProgress", progressParams)
                      : t("sessionMaterials.enhancementStatusRunning")}
                  </p>
                  <p
                    className="text-xs text-violet-200/80"
                    data-testid="enhancement-published-kind"
                    data-published-kind="raw"
                  >
                    {t("sessionMaterials.enhancementPublishedRaw")}
                  </p>
                </div>
              </div>
            ) : null}

            {enhancementUxState === "ENHANCEMENT_RUNNING_INELIGIBLE" ? (
              <div
                data-testid="enhancement-running-ineligible"
                className="rounded-xl border border-slate-600/40 bg-slate-900/40 px-4 py-3 text-sm text-slate-200"
              >
                {t("sessionMaterials.enhancementRunningIneligible")}
              </div>
            ) : null}

            {enhancementUxState === "ENHANCEMENT_TERMINAL_PARTIAL" ? (
              <div
                data-testid="enhancement-terminal-partial"
                className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100"
              >
                {t("sessionMaterials.enhancementTerminalPartial")}
              </div>
            ) : null}

            {enhancementUxState === "ENHANCEMENT_HISTORICAL_TIMEOUT" ? (
              <div
                data-testid="enhancement-historical-timeout"
                className="rounded-xl border border-slate-600/40 bg-slate-900/40 px-4 py-3 text-sm text-slate-200"
              >
                {t("sessionMaterials.enhancementHistoricalTimeout")}
              </div>
            ) : null}

            {enhancementUxState === "ENHANCEMENT_CONTINUED" ? (
              <div
                data-testid="enhancement-continued"
                data-skipped-copy={skippedEnhancementCopyVariant}
                className="space-y-1"
              >
                <p className="text-sm text-slate-300">
                  {t(skippedEnhancementHeadlineKey(skippedEnhancementCopyVariant))}
                </p>
                <p className="text-xs text-slate-400">
                  {t(skippedEnhancementBodyKey(skippedEnhancementCopyVariant))}
                </p>
              </div>
            ) : null}

            {canonicalEnhancementProgress &&
            (canonicalEnhancementProgress.permanentFailedChunks ?? 0) > 0 &&
            enhancementRunning &&
            canonicalPublicationEligible === false ? (
              <p data-testid="enhancement-permanent-failure-running" className="text-sm text-amber-200">
                {t("sessionMaterials.enhancementPermanentFailureRunning")}
              </p>
            ) : null}

            {showPublishedKindLabel ? (
              <p
                data-testid="enhancement-published-kind"
                data-published-kind={publishedKind}
                className="text-xs text-slate-500"
              >
                {publishedKind === "enhanced"
                  ? t("sessionMaterials.enhancementPublishedEnhanced")
                  : t("sessionMaterials.enhancementPublishedRaw")}
              </p>
            ) : null}

            {showServiceAlert ? (
              <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p>
                  {recording?.errorMessage ??
                    t("recording.negotiationStartedRecordingFailed")}
                </p>
                <Link href="/admin" className="font-medium text-cyan-300 hover:text-cyan-200">
                  {t("recording.openDiagnostics")}
                </Link>
              </div>
            ) : null}

            {warningMessages.map((warning) => (
              <div
                key={warning}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
              >
                {warning}
              </div>
            ))}

            {showPauseRecordingNotice ? (
              <p className="text-sm text-slate-300">
                {t("recording.recordingContinuesDuringPause")}
              </p>
            ) : null}

            {showActiveRecordingNotice ? (
              <p className="text-sm text-rose-200">
                {t("recording.recordingInProgress")}
              </p>
            ) : null}

            {renderRecordingStatusDetail && !compact ? (
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.recordingStatus")}</p>
                    <p
                      data-testid="recording-status"
                      data-status={displayRecordingStatus ?? "NOT_STARTED"}
                      data-stop-operation-state={recording?.stopOperationState ?? "NONE"}
                      data-recording-state={displayRecordingSemanticState}
                      className="text-sm font-medium text-slate-100"
                    >
                      {recording && recordingStateForLabel
                        ? recordingStatusLabel(
                            recordingStateForLabel,
                            recordingStatusLabels,
                            t("recording.recordingStatusUnknown"),
                          )
                        : t("recording.noRecordingYet")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("common.type")}</p>
                    <p className="text-sm font-medium text-slate-100">
                      {t("recording.audioOnlyRecording")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.startedAt")}</p>
                    <p className="text-sm text-slate-200">
                      {formatDate(recording?.startedAt ?? null)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.endedAt")}</p>
                    <p className="text-sm text-slate-200">
                      {formatDate(recording?.endedAt ?? null)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.originalFileSize")}</p>
                    <p className="text-sm text-slate-200">
                      {formatBytes(recording?.originalSizeBytes ?? null)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.transcriptionInputFile")}</p>
                    <p className="text-sm text-slate-200">
                      {formatBytes(transcriptionInputSizeBytes)}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.recordingPreprocessingStatus")}</p>
                    <p className="text-sm text-slate-200">
                      {preprocessingSkipped
                        ? t("recording.preprocessingSkipped")
                        : t("recording.preprocessingCompleted")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.preprocessingReason")}</p>
                    <p className="text-sm text-slate-200 break-words">
                      {preprocessingReason ?? "—"}
                    </p>
                  </div>
                </div>
                </div>

                <div className="space-y-2">
                  {recording?.fileKey ? (
                    <div className="max-w-full space-y-1 overflow-hidden text-xs text-slate-500">
                      <p>{t("recording.fileKey")}:</p>
                      <code className="block max-w-full whitespace-pre-wrap break-all rounded bg-slate-950/40 px-2 py-1 text-[11px] text-slate-300">
                        {recording.fileKey}
                      </code>
                    </div>
                  ) : null}

                  {recording?.compressionStatus ? (
                    <p className="text-sm text-slate-400">
                      {t("recording.compressionStatus")}: {recording.compressionStatus}
                    </p>
                  ) : null}

                  <p className="text-sm text-slate-400">
                    {recording?.compressionStatus === "SKIPPED"
                      ? t("recording.originalWithoutRecompression")
                      : t("recording.compressionInfo")}
                  </p>
                </div>
              </div>
            ) : renderRecordingStatusDetail ? (
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2">
                <p className="text-xs text-slate-500">{t("recording.recordingStatus")}</p>
                <p
                  data-testid="recording-status"
                  data-status={displayRecordingStatus ?? "NOT_STARTED"}
                  data-stop-operation-state={recording?.stopOperationState ?? "NONE"}
                  data-recording-state={displayRecordingSemanticState}
                  className="text-sm font-medium text-slate-100"
                >
                  {recording && recordingStateForLabel
                    ? recordingStatusLabel(
                        recordingStateForLabel,
                        recordingStatusLabels,
                        t("recording.recordingStatusUnknown"),
                      )
                    : t("recording.noRecordingYet")}
                </p>
              </div>
            ) : null}

            {!readOnly &&
            (showAutoRefreshStatus ||
              showRefreshFallback ||
              showAutoTranscribeStatus ||
              showTranscribeFallback) ? (
              <div className="space-y-2">
                {showAutoRefreshStatus ? (
                  <p className="text-sm text-slate-400">
                    {t("recording.autoRefreshingRecordingStatus")}
                  </p>
                ) : null}
                {showRefreshFallback ? (
                  <>
                    <p className="text-sm text-slate-400">
                      {t("recording.autoRefreshStalledHint")}
                    </p>
                    <SecondaryButton
                      disabled={busyAction != null}
                      onClick={() => void refreshRecordingStatus()}
                    >
                      {busyAction === "refresh"
                        ? t("common.loading")
                        : t("recording.refreshRecordingStatus")}
                    </SecondaryButton>
                  </>
                ) : null}
                {showAutoTranscribeStatus ? (
                  <p className="text-sm text-slate-400">
                    {t("recording.autoTranscribing")}
                  </p>
                ) : null}
                {showTranscribeFallback ? (
                  <>
                    <p className="text-sm text-slate-400">
                      {t("recording.autoTranscribeFailedHint")}
                    </p>
                    <SecondaryButton
                      data-testid="retry-canonical-transcribe-button"
                      disabled={busyAction != null}
                      onClick={() => {
                        autoTranscribeStartedForSessionRef.current = null;
                        void transcribe();
                      }}
                    >
                      {t("recording.transcribeRecording")}
                    </SecondaryButton>
                  </>
                ) : null}
              </div>
            ) : null}

            {renderLanguageSelector ? (
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-300"
                  htmlFor="transcript-language-select"
                >
                  {t("recording.language")}
                </label>
                <select
                  id="transcript-language-select"
                  data-testid="transcript-language-select"
                  value={languageHint}
                  onChange={(event) =>
                    setLanguageHint(event.target.value as "auto" | "ru" | "en")
                  }
                  className="rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="auto">{t("recording.auto")}</option>
                  <option value="ru">{t("recording.russian")}</option>
                  <option value="en">{t("recording.english")}</option>
                </select>
              </div>
            ) : null}

            {showManualSpeakerAttributionFallback || (diarizedTurns.length > 0 && manualSpeakerModeEnabled) ? (
              <div className={`space-y-3 rounded-xl p-4 ${showManualSpeakerAttributionFallback ? "border border-amber-500/30 bg-amber-500/10" : "border border-slate-700/50 bg-slate-900/30"}`}>
                {showManualSpeakerAttributionFallback ? (
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-amber-100">
                      {t("recording.manualSpeakerAttributionTitle")}
                    </h3>
                    <p className="text-xs text-amber-200/90">
                      {t("recording.manualSpeakerAttributionHint")}
                    </p>
                  </div>
                ) : null}

                {showManualSpeakerAttributionFallback && !manualSpeakerModeEnabled ? (
                  <SecondaryButton
                    data-testid="start-manual-speaker-attribution-button"
                    disabled={busyAction != null}
                    onClick={startManualSpeakerMode}
                  >
                    {t("recording.enableManualSpeakerAttribution")}
                  </SecondaryButton>
                ) : manualSpeakerModeEnabled ? (
                  <div className="space-y-3">
                    {manualSpeakerTurns.map((turn, index) => (
                      <div
                        key={turn.id}
                        className="space-y-2 rounded-lg border border-slate-700/50 bg-slate-900/50 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-slate-300">
                              {t("recording.manualSpeakerTurn", {
                                number: index + 1,
                              })}
                            </span>
                            <span className="text-xs text-slate-500">
                              {formatTranscriptTimeRangeUi(
                                turn.startSeconds,
                                turn.endSeconds,
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="text-xs text-slate-400 hover:text-slate-200"
                              data-testid="insert-manual-speaker-turn-after"
                              onClick={() => {
                                setManualSpeakerTurns((current) =>
                                  insertManualSpeakerTurnAfter(current, index),
                                );
                              }}
                            >
                              {t("recording.insertManualSpeakerTurnAfter")}
                            </button>
                            {manualSpeakerTurns.length > 1 ? (
                              <button
                                type="button"
                                className="text-xs text-rose-300 hover:text-rose-200"
                                onClick={() => {
                                  setManualSpeakerTurns((current) =>
                                    current.filter((item) => item.id !== turn.id),
                                  );
                                }}
                              >
                                {t("recording.removeManualSpeakerTurn")}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <select
                          data-testid="manual-speaker-turn-participant"
                          value={turn.participantId}
                          onChange={(event) => {
                            const value = event.target.value;
                            setManualSpeakerTurns((current) => {
                              const currentTurn = current.find(
                                (item) => item.id === turn.id,
                              );
                              if (!currentTurn) {
                                return current;
                              }

                              // Group key: prefer the diarization label, fall back to the
                              // user-assigned speaker slot. Null means no grouping.
                              const groupKey =
                                currentTurn.speakerLabel ?? currentTurn.speakerSlot;

                              if (!groupKey) {
                                return current.map((item) =>
                                  item.id === turn.id
                                    ? { ...item, participantId: value }
                                    : item,
                                );
                              }

                              const sameSpeakerTurns = current.filter(
                                (item) =>
                                  (item.speakerLabel ?? item.speakerSlot) === groupKey,
                              );
                              const shouldPropagateToSameSpeaker = sameSpeakerTurns.every(
                                (item) => item.participantId.trim().length === 0,
                              );

                              if (shouldPropagateToSameSpeaker) {
                                return current.map((item) =>
                                  (item.speakerLabel ?? item.speakerSlot) === groupKey
                                    ? { ...item, participantId: value }
                                    : item,
                                );
                              }

                              return current.map((item) =>
                                item.id === turn.id
                                  ? { ...item, participantId: value }
                                  : item,
                              );
                            });
                          }}
                          className="w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                        >
                          <option value="">{t("recording.selectParticipant")}</option>
                          {participants.map((participant) => (
                            <option key={participant.id} value={participant.id}>
                              {buildParticipantOptionLabel(
                                participant,
                                participantTypeLabels,
                              )}
                            </option>
                          ))}
                        </select>

                        {/* Speaker slot selector: shown when diarization produced no labels */}
                        {!turn.speakerLabel ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-slate-500">
                              {t("recording.speakerSlotLabel")}:
                            </span>
                            {(["1", "2", "3", "4"] as const).map((slot) => (
                              <button
                                key={slot}
                                type="button"
                                title={t("recording.speakerSlotHint")}
                                className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${
                                  turn.speakerSlot === slot
                                    ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/50"
                                    : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                                }`}
                                onClick={() => {
                                  setManualSpeakerTurns((current) =>
                                    current.map((item) =>
                                      item.id === turn.id
                                        ? {
                                            ...item,
                                            speakerSlot:
                                              item.speakerSlot === slot ? null : slot,
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                              >
                                S{slot}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">
                            {turn.displaySpeakerLabel ?? turn.speakerLabel}
                          </p>
                        )}

                        <textarea
                          data-testid="manual-speaker-turn-text"
                          value={turn.text}
                          onChange={(event) => {
                            const value = event.target.value;
                            setManualSpeakerTurns((current) =>
                              current.map((item) =>
                                item.id === turn.id ? { ...item, text: value } : item,
                              ),
                            );
                          }}
                          rows={3}
                          placeholder={t("recording.manualSpeakerTurnPlaceholder")}
                          className="w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                        />
                      </div>
                    ))}

                    <div className="flex flex-wrap gap-2">
                      <GradientButton
                        type="button"
                        disabled={busyAction != null}
                        onClick={() => void saveManualSpeakerAttribution()}
                        data-testid="save-manual-speaker-attribution-button"
                      >
                        {busyAction === "manual-speaker-attribution"
                          ? t("common.saving")
                          : t("recording.saveTranscript")}
                      </GradientButton>
                      <SecondaryButton
                        type="button"
                        disabled={busyAction != null}
                        onClick={() => setManualSpeakerModeEnabled(false)}
                      >
                        {t("common.cancel")}
                      </SecondaryButton>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showAutoAppliedNote ? (
              <div
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
                data-testid="auto-applied-mapping-note"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {t("recording.mappingStatusDescription.appliedNeedsConfirmation")}
                  </p>
                  {showAutoAppliedReviewAction ? (
                    <SecondaryButton
                      type="button"
                      disabled={busyAction != null}
                      onClick={() => setAppliedMappingEditorOpen(true)}
                      data-testid="review-speaker-mapping-button"
                      className="shrink-0 text-xs"
                    >
                      {t("recording.reviewOrChangeMapping")}
                    </SecondaryButton>
                  ) : null}
                </div>
              </div>
            ) : null}

            {transcript?.speakerMappingStatus === "PARTIALLY_MAPPED" &&
            !showAssistedReviewCard ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {t("recording.mappingStatusDescription.partiallyMapped")}
              </div>
            ) : null}

            {showAssistedReviewCard ? (
              <div
                className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
                data-testid="assisted-speaker-mapping-card"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-amber-100">
                    {t("recording.confirmSpeakersTitle")}
                  </h3>
                  <p className="text-xs text-amber-200/90">
                    {mappingStatusDescriptionKey
                      ? t(mappingStatusDescriptionKey as never)
                      : t("recording.confirmSpeakersDescription")}
                  </p>
                  {primaryMappingReasonI18nKey ? (
                    <p className="text-xs text-amber-200/80">
                      {t(primaryMappingReasonI18nKey as never)}
                    </p>
                  ) : null}
                  {speakerSuggestion.globalConfidenceLevel ? (
                    <p className="text-xs text-amber-200/80">
                      {t("recording.confidence")}:{" "}
                      {confidenceLevelLabel(speakerSuggestion.globalConfidenceLevel, t)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {speakersForMapping.map((speaker) => {
                    const suggestedParticipantId =
                      speakerSuggestion.suggestedMapping[speaker.speakerLabel] ?? null;
                    const confidenceLevel =
                      speakerSuggestion.perSpeakerConfidence[speaker.speakerLabel] ?? null;
                    return (
                      <div
                        key={speaker.speakerLabel}
                        className="space-y-2 rounded-lg border border-amber-500/20 bg-slate-900/30 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-100">
                            {speaker.displaySpeakerLabel}
                          </span>
                          {confidenceLevel ? (
                            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">
                              {t("recording.confidence")}: {confidenceLevelLabel(confidenceLevel, t)}
                            </span>
                          ) : null}
                        </div>
                        {suggestedParticipantId ? (
                          <p className="text-xs text-amber-200/90">
                            {t("recording.suggested")}:{" "}
                            {buildParticipantOptionLabel(
                              participants.find(
                                (participant) => participant.id === suggestedParticipantId,
                              ) ?? {
                                id: suggestedParticipantId,
                                displayName: suggestedParticipantId,
                                type: "PARTICIPANT",
                                roleName: null,
                              },
                              participantTypeLabels,
                            )}
                          </p>
                        ) : null}
                        <select
                          value={speakerMappingDraft[speaker.speakerLabel] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSpeakerMappingDraft((current) => ({
                              ...current,
                              [speaker.speakerLabel]: value || null,
                            }));
                            speakerMappingDraftDirtyRef.current = true;
                          }}
                          className="w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                        >
                          <option value="">{t("recording.unassigned")}</option>
                          {participants.map((participant) => (
                            <option key={participant.id} value={participant.id}>
                              {buildParticipantOptionLabel(
                                participant,
                                participantTypeLabels,
                              )}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  {hasFullSuggestedMapping ? (
                    <SecondaryButton
                      disabled={busyAction != null}
                      onClick={() => {
                        setSpeakerMappingDraft(speakerSuggestion.suggestedMapping);
                        speakerMappingDraftDirtyRef.current = true;
                        void saveSpeakerMapping({
                          confirm: true,
                          mappingOverride: speakerSuggestion.suggestedMapping,
                        });
                      }}
                      data-testid="apply-speaker-suggestion-button"
                    >
                      {busyAction === "confirm-mapping"
                        ? t("common.saving")
                        : t("recording.applySuggestion")}
                    </SecondaryButton>
                  ) : null}
                  <GradientButton
                    disabled={busyAction != null}
                    onClick={() =>
                      void saveSpeakerMapping({
                        confirm: allSpeakersMappedInDraft,
                      })
                    }
                    data-testid="save-speaker-mapping-button"
                  >
                    {busyAction === "save-mapping" || busyAction === "confirm-mapping"
                      ? t("common.saving")
                      : t("recording.saveMappingAction")}
                  </GradientButton>
                  <SecondaryButton
                    disabled={busyAction != null}
                    onClick={() => {
                      setMappingReviewSkipped(true);
                      setError(null);
                      setMessage(t("recording.speakerMappingCanChangeLater"));
                    }}
                    data-testid="skip-speaker-mapping-button"
                  >
                    {t("recording.skipSpeakerMappingForNow")}
                  </SecondaryButton>
                </div>
              </div>
            ) : null}

            {shouldShowSpeakerMappingPanel && !showAssistedReviewCard ? (
              <div
                className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/30 p-4"
                data-testid="speaker-mapping-editor"
              >
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    {t("recording.speakerMapping")}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("recording.detectedSpeakers")}
                  </p>
                </div>

                <div className="space-y-3">
                  {speakersForMapping.map((speaker) => (
                    <div
                      key={speaker.speakerLabel}
                      className="grid gap-2 sm:grid-cols-[minmax(0,140px)_1fr] sm:items-center"
                    >
                      <span className="text-sm font-medium text-slate-200">
                        {speaker.displaySpeakerLabel}
                      </span>
                      <select
                        value={speakerMappingDraft[speaker.speakerLabel] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          debugSpeakerMappingClient("selectChanged", {
                            sessionId,
                            transcriptId: transcript?.id ?? null,
                            speakerLabel: speaker.speakerLabel,
                            selectedParticipantId: value || null,
                          });
                          setSpeakerMappingDraft((current) => ({
                            ...current,
                            [speaker.speakerLabel]: value || null,
                          }));
                          speakerMappingDraftDirtyRef.current = true;
                        }}
                        className="rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="">{t("recording.unassigned")}</option>
                        {participants.map((participant) => (
                          <option key={participant.id} value={participant.id}>
                            {buildParticipantOptionLabel(
                              participant,
                              participantTypeLabels,
                            )}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <SecondaryButton
                    disabled={busyAction != null}
                    onClick={() =>
                      void saveSpeakerMapping({
                        confirm: allSpeakersMappedInDraft,
                      })
                    }
                    data-testid="confirm-speaker-mapping-button"
                  >
                    {busyAction === "save-mapping" || busyAction === "confirm-mapping"
                      ? t("common.saving")
                      : allSpeakersMappedInDraft
                        ? t("recording.confirmSpeakerMapping")
                        : t("recording.saveSpeakerMapping")}
                  </SecondaryButton>
                </div>
              </div>
            ) : null}

            {diarizedTurns.length > 0 ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
                  <label className="text-sm font-medium text-slate-300">
                    {t("recording.diarizedTranscript")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      data-testid="copy-diarized-transcript-button"
                      disabled={busyAction != null}
                      onClick={() => void copyDiarizedTranscript()}
                    >
                      {t("recording.copyDiarizedTranscript")}
                    </SecondaryButton>
                    {!readOnly && !lexicalEditorLocked && !manualSpeakerModeEnabled ? (
                      <SecondaryButton
                        data-testid="edit-diarized-transcript-button"
                        disabled={busyAction != null}
                        onClick={startManualSpeakerMode}
                      >
                        {t("recording.editDiarizedTranscript")}
                      </SecondaryButton>
                    ) : null}
                  </div>
                </div>

                {!manualSpeakerModeEnabled ? (
                  <div ref={transcriptScrollRef} className="space-y-3">
                    {diarizedTurns.map((turn, index) => (
                      <div
                        key={`${turn.speakerKey}-${index}`}
                        data-testid="diarized-transcript-turn"
                        className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-950/80 px-4 py-3 shadow-inner"
                      >
                        <div className="flex items-center gap-1.5">
                          <p
                            className="text-xs font-semibold uppercase tracking-wide text-cyan-300/90"
                            data-mapping-applied={turn.mappingApplied ? "true" : "false"}
                          >
                            {turn.mappingApplied
                              ? turn.speakerName
                              : `${turn.speakerName} · ${t("recording.mappingRequiredShort")}`}
                          </p>
                          {turn.enhancementProvenance ? (
                            <TurnEnhancementProvenanceIcon
                              provenance={turn.enhancementProvenance}
                              appliedLabel={t("sessionMaterials.enhancementTurnApplied")}
                              rawLabel={t("sessionMaterials.enhancementTurnRaw")}
                              editedLabel={t("sessionMaterials.enhancementTurnEdited")}
                            />
                          ) : null}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatTranscriptTimeRangeWithDurationUi({
                            startSeconds: turn.startSeconds,
                            endSeconds: turn.endSeconds,
                            durationUnitLabel: t("recording.secondsShort"),
                          })}
                        </p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-200">
                          {turn.text}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Plain transcript: only shown when no diarized content is available.
                When speaker diarization is active, the diarized view above is the source of truth. */}
            {diarizedTurns.length === 0 && transcriptText.trim().length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    {t("recording.plainTranscript")}
                  </label>
                  {transcript ? (
                    <span className="text-xs text-slate-500">
                      {transcript.source === "GENERATED"
                        ? t("recording.generatedTranscript")
                        : t("recording.manualTranscript")}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">
                      {t("recording.noTranscriptYet")}
                    </span>
                  )}
                </div>
                {transcript?.source === "MANUAL" &&
                transcript.hasSpeakerDiarization ? (
                  <p className="text-xs text-amber-300/90">
                    {t("recording.manualTranscriptDiarizationWarning")}
                  </p>
                ) : null}
                <textarea
                  data-testid="transcript-textarea"
                  value={transcriptText}
                  onChange={(event) => setTranscriptText(event.target.value)}
                  readOnly={readOnly || lexicalEditorLocked}
                  rows={10}
                  placeholder={t("recording.noTranscriptYet")}
                  className="w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
                {!readOnly && !lexicalEditorLocked ? (
                  <GradientButton
                    data-testid="save-transcript-button"
                    disabled={busyAction != null}
                    onClick={() => void saveTranscript()}
                  >
                    {busyAction === "save"
                      ? t("common.saving")
                      : t("recording.saveTranscript")}
                  </GradientButton>
                ) : null}
              </div>
            ) : null}

            {!hideRerunControls &&
            !readOnly &&
            hasUsableTranscript(transcript) &&
            recording &&
            isRecordingReadyForTranscription(recording) ? (
              <div className="space-y-3 rounded-xl border border-slate-700/40 bg-slate-900/30 px-4 py-3">
                {rerunConfirmOpen ? (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-100">
                      {t("recording.rerunTranscriptionConfirmTitle")}
                    </p>
                    <p className="text-sm text-slate-400">
                      {t("recording.rerunTranscriptionConfirmBody")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        data-testid="confirm-rerun-transcription-button"
                        disabled={busyAction != null}
                        onClick={() => void rerunTranscription()}
                      >
                        {t("recording.rerunTranscriptionConfirm")}
                      </SecondaryButton>
                      <SecondaryButton
                        disabled={busyAction != null}
                        onClick={() => setRerunConfirmOpen(false)}
                      >
                        {t("recording.rerunTranscriptionCancel")}
                      </SecondaryButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-400">
                      {t("recording.diarizedTranscript")}:{" "}
                      {transcript?.transcriptionModel ?? t("recording.generatedTranscript")}
                    </p>
                    <SecondaryButton
                      data-testid="rerun-transcription-button"
                      disabled={busyAction != null}
                      onClick={() => setRerunConfirmOpen(true)}
                    >
                      {busyAction === "rerun"
                        ? t("recording.transcribing")
                        : t("recording.rerunTranscription")}
                    </SecondaryButton>
                  </div>
                )}
              </div>
            ) : null}

            {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
            {error ? <p className="text-sm text-amber-400">{error}</p> : null}
          </>
        )}
      <ConfirmDialog
        open={materialChangeDialog !== null}
        title={t("recording.materialChangeConfirmTitle")}
        description={
          materialChangeDialog?.willRevokePublication
            ? t("recording.materialChangePublicationWarning")
            : t("recording.materialChangeAiOnlyWarning")
        }
        cancelLabel={t("common.cancel")}
        confirmLabel={t("recording.materialChangeConfirm")}
        testId="material-change-confirm-dialog"
        onCancel={() => closeMaterialChangeDialog(false)}
        onConfirm={() => closeMaterialChangeDialog(true)}
      />
    </div>
  );

  if (embedded) {
    return <div className="relative space-y-6">{content}</div>;
  }

  return (
    <Card className="relative">
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-50">
          {t("sessions.recordingAndTranscription")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-6">{content}</CardContent>
    </Card>
  );
}
