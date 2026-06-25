"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiAnalysisReport } from "@/components/session-materials-dashboard";
import { Card, CardContent, CardHeader } from "@/components/card";
import { RecordingTranscriptionSection } from "@/components/recording-transcription-section";
import { GradientButtonLink, SecondaryButton } from "@/components/ui/buttons";
import { buildSessionMaterialsPath } from "@/lib/config";
import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
import {
  NegotiationAnalysisOutputSchema,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";
import { useI18n } from "@/lib/i18n/useI18n";
import type { TranslationKey } from "@/lib/i18n/translate";

// ── Types ──────────────────────────────────────────────────────────────────

type MaterialsStatusResponse = {
  recording: { processingStage: string } | null;
  transcription: {
    processingStage: string;
    canStart: boolean;
    canRetry: boolean;
    canRerun?: boolean;
    speakerMappingRequired?: boolean;
    diarizationStatus?: string | null;
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
    analysisJson: unknown;
    errorMessage: string | null;
  };
  permissions: {
    canRunTranscription: boolean;
    canRunAiAnalysis: boolean;
    canShareAiAnalysis: boolean;
  };
  processing: {
    shouldPoll: boolean;
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
};

const POLL_INTERVAL_MS = 4000;

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

function stageTone(stage: string): string {
  if (stage === "ready") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-200";
  if (
    ["queued", "analyzing", "downloading", "compressing", "transcribing", "processing", "in_progress", "finalizing"].includes(
      stage,
    )
  ) {
    return "border-cyan-500/30 bg-cyan-950/20 text-cyan-200";
  }
  if (stage === "failed") return "border-rose-500/30 bg-rose-950/20 text-rose-200";
  return "border-slate-700/50 bg-slate-900/40 text-slate-400";
}

function StatusPill({
  title,
  stage,
  stageKeys,
}: {
  title: string;
  stage: string;
  stageKeys: Record<string, TranslationKey>;
}) {
  const { t } = useI18n();
  const labelKey = stageKeys[stage];
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${stageTone(stage)}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{title}</p>
      <p className="mt-0.5 font-medium">{labelKey ? t(labelKey) : stage}</p>
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
}: SessionPostProcessingPanelProps) {
  const { t } = useI18n();
  const isFacilitator = participantType === "FACILITATOR";
  const isSidebar = variant === "sidebar";
  const materialsPath =
    roomAuth.type === "joinToken"
      ? buildSessionMaterialsPath(roomAuth.value)
      : `/sessions/${sessionId}/materials`;

  const [statusData, setStatusData] = useState<MaterialsStatusResponse | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [speakerMappingBlockingAi, setSpeakerMappingBlockingAi] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [unsharingBusy, setUnsharingBusy] = useState(false);
  const [transcriptCollapsed, setTranscriptCollapsed] = useState(false);
  const [aiWarningOpen, setAiWarningOpen] = useState(false);
  const [shareWarningOpen, setShareWarningOpen] = useState(false);

  const mountedRef = useRef(true);
  const autoTranscribeStartedRef = useRef(false);
  const autoCollapsedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/status?${roomAuthQuery(roomAuth)}`,
        { cache: "no-store" },
      );
      if (!res.ok || !mountedRef.current) return;
      const data = (await res.json()) as MaterialsStatusResponse;
      if (mountedRef.current) setStatusData(data);
    } catch {
      // ignore
    }
  }, [roomAuth, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    autoTranscribeStartedRef.current = false;
    queueMicrotask(() => void fetchStatus());
    return () => {
      mountedRef.current = false;
    };
  }, [fetchStatus, sessionId]);

  useEffect(() => {
    if (!statusData?.processing.shouldPoll) return;
    const id = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus, statusData?.processing.shouldPoll]);

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
  const canRerunTranscription =
    isFacilitator && !readOnly && permissions?.canRunTranscription && transcript?.canRerun;
  const canStartAi = isFacilitator && !readOnly && ai?.canStart;
  const canRetryAi = isFacilitator && !readOnly && ai?.canRetry;
  const canRerunAi = isFacilitator && !readOnly && ai?.canRerun;
  const canViewAi = ai?.canView ?? false;
  const canShareAi = isFacilitator && !readOnly && ai?.canShare;
  const aiShared = ai?.isSharedWithSession ?? false;
  const isFacilitatorView = ai?.visibility != null;

  const parsedAnalysis = canViewAi
    ? NegotiationAnalysisOutputSchema.safeParse(ai?.analysisJson)
    : null;
  const analysisJson: NegotiationAnalysisOutput | null = parsedAnalysis?.success
    ? parsedAnalysis.data
    : null;

  const handleStartTranscription = useCallback(async () => {
    setTranscriptionBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/materials/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roomAuthBody(roomAuth)),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Transcription failed.");
      }
      void fetchStatus();
    } catch {
      autoTranscribeStartedRef.current = false;
    } finally {
      setTranscriptionBusy(false);
    }
  }, [fetchStatus, roomAuth, sessionId]);

  const handleRerunTranscription = useCallback(async () => {
    setRerunConfirmOpen(false);
    setRerunBusy(true);
    setRerunError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/materials/retranscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...roomAuthBody(roomAuth), reason: "manual_rerun" }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Re-transcription failed.");
      }
      void fetchStatus();
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : "Re-transcription failed.");
    } finally {
      setRerunBusy(false);
    }
  }, [fetchStatus, roomAuth, sessionId]);

  useEffect(() => {
    if (!autoTranscribeEnabled || !canStartTranscription || transcriptionBusy) return;
    if (autoTranscribeStartedRef.current) return;
    autoTranscribeStartedRef.current = true;
    void handleStartTranscription();
  }, [autoTranscribeEnabled, canStartTranscription, handleStartTranscription, transcriptionBusy]);

  // Auto-collapse transcript once AI analysis is done (only once per session load).
  const transcriptionDoneForCollapse = statusData?.transcription?.processingStage === "ready";
  useEffect(() => {
    if (transcriptionDoneForCollapse && !autoCollapsedRef.current && !isSidebar) {
      autoCollapsedRef.current = true;
      setTranscriptCollapsed(true);
    }
  }, [transcriptionDoneForCollapse, isSidebar]);

  const handleRunAiAnalysisConfirmed = async () => {
    setAiWarningOpen(false);
    setAiBusy(true);
    setAiError(null);
    setSpeakerMappingBlockingAi(false);
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
    setAiWarningOpen(true);
  };

  const handleShareAnalysisConfirmed = async () => {
    setShareWarningOpen(false);
    setSharingBusy(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...roomAuthBody(roomAuth), shareDebriefConfirmed: true }),
      });
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
      void fetchStatus();
    } finally {
      setUnsharingBusy(false);
    }
  };

  const showTranscriptionSection = isFacilitator && !readOnly;
  const showAiSection = isFacilitator || canViewAi || (ai?.participantPlaceholder ?? false);

  const transcriptionStage = transcript?.processingStage ?? "waiting_for_recording";
  const aiStage = ai?.processingStage ?? "waiting_for_transcript";
  const transcriptionActive = ["queued", "downloading", "compressing", "transcribing"].includes(transcriptionStage);
  const aiActive = ["queued", "analyzing"].includes(aiStage);
  const transcriptionDone = transcriptionStage === "ready";
  const aiDone = aiStage === "ready";

  // ── Steps pipeline (page variant only) ───────────────────────────────────

  const stepsBar = isFacilitator && !readOnly && statusData ? (
    <div className="space-y-2">
      {/* ── Step 1: Transcription ── */}
      <div
        id="step-transcription"
        className={`rounded-lg border px-4 py-3 transition-colors
          ${transcriptionActive ? "border-cyan-500/30 bg-cyan-950/10" : transcriptionDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StepBadge step={1} done={transcriptionDone} active={transcriptionActive} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-200">{t("sessions.recordingAndTranscription")}</p>
            <p className="text-xs text-slate-500">
              {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.waitingForRecording")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canStartTranscription ? (
              <SecondaryButton
                disabled={transcriptionBusy}
                onClick={() => void handleStartTranscription()}
                data-testid="post-processing-start-transcription-button"
              >
                {transcriptionBusy ? t("common.loading") : t("room.startTranscription")}
              </SecondaryButton>
            ) : null}
            {canRetryTranscription ? (
              <SecondaryButton
                disabled={transcriptionBusy}
                onClick={() => void handleStartTranscription()}
              >
                {transcriptionBusy ? t("common.loading") : t("sessionMaterials.retryTranscription")}
              </SecondaryButton>
            ) : null}
            {canRerunTranscription && !rerunConfirmOpen ? (
              <SecondaryButton
                disabled={rerunBusy || transcriptionBusy}
                onClick={() => setRerunConfirmOpen(true)}
                data-testid="post-processing-rerun-transcription-button"
              >
                {rerunBusy ? t("common.loading") : t("sessionMaterials.rerunTranscription")}
              </SecondaryButton>
            ) : null}
            {transcriptionDone && !canRerunTranscription ? (
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
        {rerunConfirmOpen ? (
          <div className="mt-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
            <p className="text-xs text-amber-100">{t("sessionMaterials.rerunTranscriptionConfirmBody")}</p>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                disabled={rerunBusy}
                onClick={() => void handleRerunTranscription()}
                data-testid="post-processing-confirm-rerun-button"
              >
                {t("recording.rerunTranscriptionConfirm")}
              </SecondaryButton>
              <SecondaryButton disabled={rerunBusy} onClick={() => setRerunConfirmOpen(false)}>
                {t("recording.rerunTranscriptionCancel")}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
        {rerunError ? <p className="mt-2 text-xs text-rose-400">{rerunError}</p> : null}
      </div>

      {/* ── Step 2: AI Analysis ── */}
      <div
        id="step-ai"
        className={`rounded-lg border px-4 py-3 transition-colors
          ${aiActive ? "border-violet-500/30 bg-violet-950/10" : aiDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StepBadge step={2} done={aiDone} active={aiActive} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-200">{t("sessionMaterials.aiAnalysis")}</p>
            <p className="text-xs text-slate-500">
              {t(aiStageKeys[aiStage] ?? "sessionMaterials.waitingForTranscript")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
        {speakerMappingBlockingAi || transcript?.speakerMappingRequired ? (
          <p className="mt-2 text-xs text-amber-300">{t("room.confirmSpeakerMappingBeforeAi")}</p>
        ) : null}
        {aiError && !speakerMappingBlockingAi ? (
          <p className="mt-2 text-xs text-rose-400">{aiError}</p>
        ) : null}
        {ai?.analysisFromOlderTranscript ? (
          <p className="mt-2 text-xs text-amber-300">{t("sessionMaterials.analysisFromOlderTranscript")}</p>
        ) : null}
      </div>

      {/* ── Step 3: Share with participants ── */}
      {aiDone ? (
        <div
          id="step-share"
          className={`rounded-lg border px-4 py-3 transition-colors
            ${aiShared ? "border-emerald-500/30 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <StepBadge step={3} done={aiShared} active={false} />
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
        <div className="flex items-center gap-2">
          <StepBadge step={1} done={transcriptionDone} active={transcriptionActive} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-200">{t("sessions.recordingAndTranscription")}</p>
            <p className="text-xs text-slate-500">
              {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.waitingForRecording")}
            </p>
          </div>
          {(canStartTranscription || canRetryTranscription || (canRerunTranscription && !rerunConfirmOpen)) ? (
            <SecondaryButton
              disabled={transcriptionBusy || rerunBusy}
              onClick={() =>
                canRerunTranscription ? setRerunConfirmOpen(true) : void handleStartTranscription()
              }
              data-testid="post-processing-start-transcription-button"
              className="shrink-0 text-xs"
            >
              {transcriptionBusy || rerunBusy
                ? t("common.loading")
                : canRerunTranscription
                  ? t("sessionMaterials.rerunTranscription")
                  : canRetryTranscription
                    ? t("sessionMaterials.retryTranscription")
                    : t("room.startTranscription")}
            </SecondaryButton>
          ) : null}
        </div>
        {rerunConfirmOpen ? (
          <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2">
            <p className="text-xs text-amber-100">{t("sessionMaterials.rerunTranscriptionConfirmBody")}</p>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                disabled={rerunBusy}
                onClick={() => void handleRerunTranscription()}
                data-testid="post-processing-confirm-rerun-button"
              >
                {t("recording.rerunTranscriptionConfirm")}
              </SecondaryButton>
              <SecondaryButton disabled={rerunBusy} onClick={() => setRerunConfirmOpen(false)}>
                {t("recording.rerunTranscriptionCancel")}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
        {rerunError ? <p className="mt-1 text-xs text-rose-400">{rerunError}</p> : null}
      </div>

      {/* Step 2: AI Analysis */}
      <div
        className={`rounded-lg border px-3 py-2.5 transition-colors
          ${aiActive ? "border-violet-500/30 bg-violet-950/10" : aiDone ? "border-emerald-500/20 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
      >
        <div className="flex items-center gap-2">
          <StepBadge step={2} done={aiDone} active={aiActive} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-200">{t("sessionMaterials.aiAnalysis")}</p>
            <p className="text-xs text-slate-500">
              {t(aiStageKeys[aiStage] ?? "sessionMaterials.waitingForTranscript")}
            </p>
          </div>
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
        {speakerMappingBlockingAi || transcript?.speakerMappingRequired ? (
          <p className="mt-1 text-xs text-amber-300">{t("room.confirmSpeakerMappingBeforeAi")}</p>
        ) : null}
        {aiError && !speakerMappingBlockingAi ? (
          <p className="mt-1 text-xs text-rose-400">{aiError}</p>
        ) : null}
        {ai?.analysisFromOlderTranscript ? (
          <p className="mt-1 text-xs text-amber-300">{t("sessionMaterials.analysisFromOlderTranscript")}</p>
        ) : null}
      </div>

      {/* Step 3: Share */}
      {aiDone ? (
        <div
          className={`rounded-lg border px-3 py-2.5 transition-colors
            ${aiShared ? "border-emerald-500/30 bg-emerald-950/10" : "border-slate-700/40 bg-slate-900/30"}`}
        >
          <div className="flex items-center gap-2">
            <StepBadge step={3} done={aiShared} active={false} />
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
          : "grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3"
      }
      data-testid="post-processing-status-strip"
    >
      <StatusPill
        title={t("sessionMaterials.recording")}
        stage={recording?.processingStage ?? "not_available"}
        stageKeys={recordingStageKeys}
      />
      <StatusPill
        title={t("sessionMaterials.transcription")}
        stage={transcript?.processingStage ?? "waiting_for_recording"}
        stageKeys={transcriptionStageKeys}
      />
      <StatusPill
        title={t("sessionMaterials.aiAnalysis")}
        stage={ai?.processingStage ?? "waiting_for_transcript"}
        stageKeys={aiStageKeys}
      />
    </div>
  ) : null;

  const navigationLinks = showNavigation || (!isFacilitator && isSidebar) ? (
    <div className={`flex flex-wrap gap-2 ${isSidebar ? "flex-col" : ""}`}>
      {isFacilitator || canViewAi ? (
        <GradientButtonLink
          href={materialsPath}
          className={isSidebar ? "w-full justify-center" : undefined}
          data-testid={
            isSidebar ? "debrief-open-materials-button" : "post-processing-open-materials-button"
          }
        >
          {isFacilitator
            ? t("room.openSessionMaterials")
            : t("room.viewSharedAiAnalysis")}
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

  const aiContent = showAiSection ? (
    <Card id="ai-section" data-testid="post-processing-ai-section">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-50">
            {t("sessionMaterials.aiAnalysis")}
          </h2>
          {canViewAi && analysisJson && isFacilitatorView ? (
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

        {!canViewAi && isFacilitator && ai?.processingStage !== "ready" ? (
          <p className="text-sm text-slate-400">
            {t(aiStageKeys[ai?.processingStage ?? "waiting_for_transcript"])}
          </p>
        ) : null}

        {ai?.processingStage === "failed" && ai.errorMessage ? (
          <p className="text-sm text-rose-400">{ai.errorMessage}</p>
        ) : null}

        {canViewAi && analysisJson ? (
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
      onConfirm={() => void handleRunAiAnalysisConfirmed()}
      onCancel={() => setAiWarningOpen(false)}
    />
  ) : null;

  const shareWarningModal = shareWarningOpen ? (
    <ShareDebriefWarningModal
      onConfirm={() => void handleShareAnalysisConfirmed()}
      onCancel={() => setShareWarningOpen(false)}
    />
  ) : null;

  if (isSidebar) {
    return (
      <>
        {aiWarningModal}
        {shareWarningModal}
      <div className="space-y-4" data-testid="session-post-processing-panel">
        {sidebarStepsBar}
        {showTranscriptionSection ? (
          transcriptionActive ? (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-4 text-center">
              <p className="text-xs text-cyan-300 animate-pulse">
                {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.transcriptionInProgress")}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/30">
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {t("sessions.recordingAndTranscription")}
                </p>
                <button
                  type="button"
                  onClick={() => setTranscriptCollapsed((v) => !v)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {transcriptCollapsed ? t("sessions.expandTranscript") : t("sessions.collapseTranscript")}
                </button>
              </div>
              {!transcriptCollapsed ? (
                <div className="px-3 pb-3">
                  <RecordingTranscriptionSection
                    key={transcriptionStage}
                    sessionId={sessionId}
                    roomAuth={roomAuth}
                    autoTranscribeEnabled={autoTranscribeEnabled}
                    embedded
                    compact
                    hideRerunControls
                    isLocked={rerunBusy}
                    onProcessingChange={() => void fetchStatus()}
                  />
                </div>
              ) : null}
            </div>
          )
        ) : null}
        {aiContent}
        {navigationLinks}
      </div>
      </>
    );
  }

  return (
    <>
      {aiWarningModal}
      {shareWarningModal}
    <div className="space-y-6" data-testid="session-post-processing-panel">
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
        transcriptionActive ? (
          <Card id="transcription-section">
            <CardHeader>
              <h2 className="text-base font-semibold text-slate-50">
                {t("sessions.recordingAndTranscription")}
              </h2>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-950/30">
                  <span className="animate-spin text-lg text-cyan-400">⟳</span>
                </div>
                <p className="text-sm text-cyan-300">
                  {t(transcriptionStageKeys[transcriptionStage] ?? "sessionMaterials.transcriptionInProgress")}
                </p>
                <p className="text-xs text-slate-500">
                  {t("sessionMaterials.transcriptionInProgressDescription")}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card id="transcription-section">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-50">
                  {t("sessions.recordingAndTranscription")}
                </h2>
                <button
                  type="button"
                  onClick={() => setTranscriptCollapsed((v) => !v)}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded hover:bg-slate-700/40"
                >
                  {transcriptCollapsed ? t("sessions.expandTranscript") : t("sessions.collapseTranscript")}
                </button>
              </div>
            </CardHeader>
            {!transcriptCollapsed ? (
              <CardContent>
                <RecordingTranscriptionSection
                  key={transcriptionStage === "ready" ? "ready" : "idle"}
                  sessionId={sessionId}
                  roomAuth={roomAuth}
                  autoTranscribeEnabled={autoTranscribeEnabled}
                  embedded
                  hideRerunControls
                  isLocked={rerunBusy}
                  onProcessingChange={() => void fetchStatus()}
                />
              </CardContent>
            ) : null}
          </Card>
        )
      ) : null}

      {aiContent}

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
      data-testid="ai-analysis-warning-modal"
    >
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-semibold text-slate-50">
          {t("legal.aiAnalysisWarningTitle")}
        </h2>
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

