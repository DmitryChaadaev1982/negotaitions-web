"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { GradientButtonLink } from "@/components/ui/buttons";
import { buildSessionMaterialsPath } from "@/lib/config";
import { useI18n } from "@/lib/i18n/useI18n";

// ── Types ──────────────────────────────────────────────────────────────────

type ProcessingStatusData = {
  recording: {
    status: string;
    processingStage: string;
  } | null;
  transcription: {
    status: string | null;
    processingStage: string;
    canStart: boolean;
    canRetry: boolean;
  };
  aiAnalysis: {
    id: string | null;
    status: string;
    processingStage: string;
    canStart: boolean;
    canRetry: boolean;
    canView: boolean;
    canShare: boolean;
    participantPlaceholder: boolean;
    isSharedWithSession: boolean;
    visibility: string | null;
    notSharedMessage: string | null;
  };
  permissions: {
    canRunTranscription: boolean;
    canRunAiAnalysis: boolean;
    canShareAiAnalysis: boolean;
  };
};

type DebriefPanelProps = {
  sessionId: string;
  joinToken: string;
  participantType: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  eventLobbyUrl: string | null | undefined;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function stageTone(stage: string): string {
  if (stage === "ready") return "border-emerald-500/30 bg-emerald-950/20 text-emerald-300";
  if (["queued", "analyzing", "downloading", "compressing", "transcribing", "processing", "in_progress", "finalizing"].includes(stage))
    return "border-cyan-500/30 bg-cyan-950/20 text-cyan-300";
  if (stage === "failed") return "border-rose-500/30 bg-rose-950/20 text-rose-300";
  return "border-slate-700/40 bg-slate-900/30 text-slate-400";
}

function stageDot(stage: string): string {
  if (stage === "ready") return "bg-emerald-400";
  if (["queued", "analyzing", "downloading", "compressing", "transcribing", "processing", "in_progress", "finalizing"].includes(stage))
    return "bg-cyan-400 animate-pulse";
  if (stage === "failed") return "bg-rose-400";
  return "bg-slate-600";
}

function stageLabel(stage: string, category: "recording" | "transcript" | "ai", t: (k: string) => string): string {
  const map: Record<string, string> = {
    not_available: t("sessionMaterials.recordingNotAvailable"),
    in_progress: t("sessionMaterials.recordingInProgress"),
    finalizing: t("sessionMaterials.recordingFinalizing"),
    processing: t("sessionMaterials.recordingProcessing"),
    ready: category === "recording"
      ? t("sessionMaterials.recordingReady")
      : category === "transcript"
        ? t("sessionMaterials.transcriptReady")
        : t("sessionMaterials.aiAnalysisReady"),
    failed: category === "recording"
      ? t("sessionMaterials.recordingFailed")
      : category === "transcript"
        ? t("sessionMaterials.transcriptionFailed")
        : t("sessionMaterials.aiAnalysisFailed"),
    waiting_for_recording: t("sessionMaterials.waitingForRecording"),
    not_started: category === "ai"
      ? t("sessionMaterials.transcriptReadyForAnalysis")
      : t("sessionMaterials.transcriptNotAvailableYet"),
    waiting_for_transcript: t("sessionMaterials.waitingForTranscript"),
    queued: category === "ai"
      ? t("sessionMaterials.aiAnalysisQueued")
      : t("sessionMaterials.transcriptionQueued"),
    downloading: t("sessionMaterials.transcriptionDownloading"),
    compressing: t("sessionMaterials.transcriptionCompressing"),
    transcribing: t("sessionMaterials.transcriptionInProgress"),
    analyzing: t("sessionMaterials.aiAnalysisAnalyzing"),
  };
  return map[stage] ?? stage;
}

// ── StatusCard ────────────────────────────────────────────────────────────

function StatusCard({
  title,
  stage,
  category,
}: {
  title: string;
  stage: string;
  category: "recording" | "transcript" | "ai";
}) {
  const { t } = useI18n();
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${stageTone(stage)}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${stageDot(stage)}`} />
      <span className="font-medium">{title}:</span>
      <span className="truncate">{stageLabel(stage, category, t as (k: string) => string)}</span>
    </div>
  );
}

// ── DebriefPanel ──────────────────────────────────────────────────────────

export function DebriefPanel({
  sessionId,
  joinToken,
  participantType,
  eventLobbyUrl,
}: DebriefPanelProps) {
  const { t } = useI18n();
  const isFacilitator = participantType === "FACILITATOR";
  const isObserver = participantType === "OBSERVER";

  const [statusData, setStatusData] = useState<ProcessingStatusData | null>(null);
  const [isStartingTranscription, setIsStartingTranscription] = useState(false);
  const [isStartingAi, setIsStartingAi] = useState(false);
  const [isSharingAi, setIsSharingAi] = useState(false);
  const [isUnsharingAi, setIsUnsharingAi] = useState(false);

  const mountedRef = useRef(true);
  const autoTranscribeStartedRef = useRef(false);
  const [shouldPoll, setShouldPoll] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/materials/status?joinToken=${encodeURIComponent(joinToken)}`,
        { cache: "no-store" },
      );
      if (!res.ok || !mountedRef.current) return;
      const data = (await res.json()) as {
        recording: ProcessingStatusData["recording"];
        transcription: ProcessingStatusData["transcription"];
        aiAnalysis: ProcessingStatusData["aiAnalysis"];
        permissions: ProcessingStatusData["permissions"];
        processing: { shouldPoll: boolean; nextPollMs: number | null };
      };

      if (!mountedRef.current) return;
      setStatusData({
        recording: data.recording,
        transcription: data.transcription,
        aiAnalysis: data.aiAnalysis,
        permissions: data.permissions,
      });
      setShouldPoll(data.processing.shouldPoll);
    } catch {
      // Ignore transient errors
    }
  }, [sessionId, joinToken]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      void fetchStatus();
    });
    return () => {
      mountedRef.current = false;
    };
  }, [fetchStatus]);

  // Polling interval when statuses are active
  useEffect(() => {
    if (!shouldPoll) return;
    const intervalId = setInterval(() => {
      queueMicrotask(() => {
        void fetchStatus();
      });
    }, 4000);
    return () => clearInterval(intervalId);
  }, [shouldPoll, fetchStatus]);

  // Refresh on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        queueMicrotask(() => {
          void fetchStatus();
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchStatus]);

  const handleStartTranscription = useCallback(async () => {
    setIsStartingTranscription(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/materials/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Transcription failed.");
      }
      void fetchStatus();
    } catch {
      autoTranscribeStartedRef.current = false;
    } finally {
      setIsStartingTranscription(false);
    }
  }, [fetchStatus, joinToken, sessionId]);

  useEffect(() => {
    autoTranscribeStartedRef.current = false;
  }, [sessionId]);

  const handleRunAiAnalysis = async () => {
    setIsStartingAi(true);
    try {
      await fetch(`/api/sessions/${sessionId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      void fetchStatus();
    } finally {
      setIsStartingAi(false);
    }
  };

  const handleShareAnalysis = async () => {
    setIsSharingAi(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      void fetchStatus();
    } finally {
      setIsSharingAi(false);
    }
  };

  const handleUnshareAnalysis = async () => {
    setIsUnsharingAi(true);
    try {
      await fetch(`/api/sessions/${sessionId}/ai-analysis/unshare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken }),
      });
      void fetchStatus();
    } finally {
      setIsUnsharingAi(false);
    }
  };

  const ai = statusData?.aiAnalysis;
  const transcript = statusData?.transcription;
  const recording = statusData?.recording;
  const permissions = statusData?.permissions;

  const canStartTranscription =
    isFacilitator &&
    permissions?.canRunTranscription &&
    transcript?.canStart;

  useEffect(() => {
    if (!canStartTranscription || isStartingTranscription) {
      return;
    }

    if (autoTranscribeStartedRef.current) {
      return;
    }

    autoTranscribeStartedRef.current = true;
    void handleStartTranscription();
  }, [canStartTranscription, handleStartTranscription, isStartingTranscription]);

  const canStartAi =
    isFacilitator &&
    ai?.canStart;

  const canRetryAi =
    isFacilitator &&
    ai?.canRetry;

  const aiCompleted = ai?.processingStage === "ready";
  const aiShared = ai?.isSharedWithSession;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto bg-slate-900 p-4 text-slate-100"
      data-testid="debrief-panel"
    >
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-50" data-testid="debrief-title">
          {t("room.debriefTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-400" data-testid="debrief-message">
          {t("room.debriefMessage")}
        </p>
      </div>

      {/* Processing status */}
      {statusData && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {t("room.processingStatus")}
          </p>
          <StatusCard
            title={t("sessionMaterials.recording")}
            stage={recording?.processingStage ?? "not_available"}
            category="recording"
          />
          <StatusCard
            title={t("sessionMaterials.transcription")}
            stage={transcript?.processingStage ?? "waiting_for_recording"}
            category="transcript"
          />
          <StatusCard
            title={t("sessionMaterials.aiAnalysis")}
            stage={ai?.processingStage ?? "waiting_for_transcript"}
            category="ai"
          />
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {t("common.actions")}
        </p>

        {/* Open Session Materials */}
        <GradientButtonLink
          href={buildSessionMaterialsPath(joinToken)}
          className="w-full justify-center"
          data-testid="debrief-open-materials-button"
        >
          {t("room.openSessionMaterials")}
        </GradientButtonLink>

        {/* Return to Event Lobby */}
        {eventLobbyUrl ? (
          <GradientButtonLink
            href={eventLobbyUrl}
            className="w-full justify-center"
            data-testid="debrief-return-to-lobby-button"
          >
            {t("room.returnToEventLobby")}
          </GradientButtonLink>
        ) : null}

        {/* Facilitator actions */}
        {isFacilitator && statusData ? (
          <>
            {/* Start transcription */}
            {canStartTranscription ? (
              <button
                type="button"
                className="btn-secondary w-full rounded-lg px-4 py-2 text-sm font-semibold"
                onClick={() => void handleStartTranscription()}
                disabled={isStartingTranscription}
                data-testid="debrief-start-transcription-button"
              >
                {isStartingTranscription
                  ? t("common.loading")
                  : t("room.startTranscription")}
              </button>
            ) : null}

            {/* Retry transcription */}
            {transcript?.canRetry && !isStartingTranscription ? (
              <button
                type="button"
                className="btn-secondary w-full rounded-lg px-4 py-2 text-sm font-semibold"
                onClick={() => void handleStartTranscription()}
                disabled={isStartingTranscription}
              >
                {t("sessionMaterials.retryTranscription")}
              </button>
            ) : null}

            {/* Run AI analysis */}
            {canStartAi || canRetryAi ? (
              <button
                type="button"
                className="btn-secondary w-full rounded-lg px-4 py-2 text-sm font-semibold"
                onClick={() => void handleRunAiAnalysis()}
                disabled={isStartingAi}
                data-testid="debrief-run-ai-analysis-button"
              >
                {isStartingAi
                  ? t("common.loading")
                  : canRetryAi
                    ? t("sessionMaterials.retryAiAnalysis")
                    : t("room.runAiAnalysis")}
              </button>
            ) : null}

            {/* Share AI analysis */}
            {aiCompleted && !aiShared ? (
              <button
                type="button"
                className="w-full rounded-lg border border-emerald-500/40 bg-emerald-900/20 px-4 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-900/40"
                onClick={() => void handleShareAnalysis()}
                disabled={isSharingAi}
                data-testid="debrief-share-analysis-button"
              >
                {isSharingAi ? t("sessionMaterials.sharing") : t("room.shareWithParticipants")}
              </button>
            ) : null}

            {/* Stop sharing */}
            {aiShared ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {t("room.sharedWithParticipants")}
                </div>
                <button
                  type="button"
                  className="btn-secondary w-full rounded-lg px-4 py-1.5 text-xs font-semibold"
                  onClick={() => void handleUnshareAnalysis()}
                  disabled={isUnsharingAi}
                  data-testid="debrief-unshare-analysis-button"
                >
                  {isUnsharingAi ? t("common.loading") : t("room.stopSharing")}
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {/* Participant / Observer: shared analysis */}
        {!isFacilitator && statusData ? (
          <>
            {aiShared ? (
              <Link
                href={buildSessionMaterialsPath(joinToken)}
                className="inline-flex w-full items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-900/20 px-4 py-2 text-sm font-semibold text-cyan-300 transition-colors hover:bg-cyan-900/40"
                data-testid="debrief-view-shared-analysis-link"
              >
                {t("room.viewSharedAiAnalysis")}
              </Link>
            ) : (
              ai && !ai.participantPlaceholder ? null : (
                <p
                  className="text-sm text-slate-500 italic"
                  data-testid="debrief-analysis-not-shared-message"
                >
                  {isObserver
                    ? t("room.aiAnalysisNotShared")
                    : t("room.aiAnalysisNotShared")}
                </p>
              )
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
