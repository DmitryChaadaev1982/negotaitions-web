"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import { buildParticipantOptionLabel } from "@/lib/transcription/speaker-labels";

type RecordingData = {
  id: string;
  status: string;
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
};

type TranscriptData = {
  id: string;
  source: "MANUAL" | "GENERATED";
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  speakerMapping: Record<string, string | null> | null;
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
  joinToken: string;
  readOnly?: boolean;
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
) {
  return labels[status] ?? status;
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
  return recording.status === "COMPLETED" || Boolean(recording.fileKey);
}

function resolveSegmentSpeakerName(
  segment: TranscriptSegmentData,
  speakerMapping: Record<string, string | null> | null,
  participantsById: Map<string, ParticipantOption>,
): string {
  if (segment.speakerLabel && speakerMapping?.[segment.speakerLabel]) {
    const participant = participantsById.get(
      speakerMapping[segment.speakerLabel]!,
    );
    if (participant) {
      if (participant.roleName) {
        return `${participant.displayName} / ${participant.roleName}`;
      }
      return participant.displayName;
    }
  }

  return segment.displaySpeakerLabel ?? segment.speakerLabel ?? "Speaker";
}

type DiarizedTurn = {
  speakerName: string;
  text: string;
};

function groupSegmentsIntoTurns(
  segments: TranscriptSegmentData[],
  speakerMapping: Record<string, string | null> | null,
  participantsById: Map<string, ParticipantOption>,
): DiarizedTurn[] {
  const turns: DiarizedTurn[] = [];

  for (const segment of segments) {
    const speakerName = resolveSegmentSpeakerName(
      segment,
      speakerMapping,
      participantsById,
    );
    const lastTurn = turns.at(-1);

    if (lastTurn && lastTurn.speakerName === speakerName) {
      lastTurn.text = `${lastTurn.text} ${segment.text}`.trim();
    } else {
      turns.push({ speakerName, text: segment.text });
    }
  }

  return turns;
}

const STATUS_POLL_INTERVAL_MS = 1_000;
const RECORDING_STATUS_STALL_MS = 45_000;

export function RecordingTranscriptionSection({
  sessionId,
  joinToken,
  readOnly = false,
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
  const [transcriptText, setTranscriptText] = useState("");
  const [languageHint, setLanguageHint] = useState<"auto" | "ru" | "en">("auto");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionWarnings, setTranscriptionWarnings] = useState<
    TranscriptionWarningCode[]
  >([]);
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

  const diarizedTurns = useMemo(() => {
    const segments = transcript?.segments ?? [];
    if (!segments.length) {
      return [];
    }

    return groupSegmentsIntoTurns(
      segments,
      transcript?.speakerMapping ?? null,
      participantsById,
    );
  }, [participantsById, transcript]);

  const diarizedPreviewText = transcript?.diarizedText ?? "";

  const loadData = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/recording`);
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
      setSpeakerMappingDraft(payload.transcript?.speakerMapping ?? {});
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load recording data.",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const pollRecordingStatus = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/refresh-recording`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinToken }),
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
  }, [joinToken, loadData, sessionId]);

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

  const shouldWatchRecordingStall =
    !readOnly &&
    sessionStatus === "FINISHED" &&
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
        sessionStatus === "FINISHED" ||
        recording?.status === "PROCESSING" ||
        recording?.status === "STOPPED";

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
    sessionStatus,
  ]);

  const applyTranscriptPayload = useCallback((payload: TranscriptData) => {
    setTranscript(payload);
    setTranscriptText(payload.text);
    setSpeakerMappingDraft(payload.speakerMapping ?? {});
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
  }, []);

  const transcribe = useCallback(async () => {
    if (!recording?.id) return;

    setBusyAction("transcribe");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/transcribe-recording`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            joinToken,
            recordingId: recording.id,
            languageHint,
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        transcript?: TranscriptData;
        warnings?: TranscriptionWarningCode[];
        recording?: Partial<RecordingData>;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Transcription failed.");
      }

      if (payload.transcript) {
        applyTranscriptPayload(payload.transcript);
      }

      setTranscriptionWarnings(payload.warnings ?? []);
      setTranscriptionAutoFailed(false);

      if (payload.recording?.compressedSizeBytes != null && recording) {
        setRecording({
          ...recording,
          compressedSizeBytes: payload.recording.compressedSizeBytes,
          compressionStatus:
            payload.recording.compressionStatus ?? recording.compressionStatus,
        });
      }

      setMessage(t("recording.transcriptSaved"));
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
  }, [applyTranscriptPayload, joinToken, languageHint, recording, sessionId, t]);

  const isWaitingForRecordingReady =
    sessionStatus === "FINISHED" &&
    Boolean(recording) &&
    !isRecordingReadyForTranscription(recording!);

  const canTranscribeRecording =
    !readOnly &&
    sessionStatus === "FINISHED" &&
    Boolean(recording) &&
    !transcript &&
    isRecordingReadyForTranscription(recording!);

  useEffect(() => {
    if (!canTranscribeRecording || busyAction != null) {
      return;
    }

    if (autoTranscribeStartedForSessionRef.current === sessionId) {
      return;
    }

    autoTranscribeStartedForSessionRef.current = sessionId;
    void transcribe();
  }, [busyAction, canTranscribeRecording, sessionId, transcribe]);

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
      const response = await fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcriptText }),
      });

      const payload = (await response.json()) as {
        error?: string;
        transcript?: TranscriptData;
      };

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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const saveSpeakerMapping = async (applyOnly = false) => {
    setBusyAction(applyOnly ? "apply-mapping" : "save-mapping");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/speaker-mapping`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            joinToken,
            mapping: speakerMappingDraft,
            applyOnly,
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        transcript?: TranscriptData;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Save failed.");
      }

      if (payload.transcript) {
        applyTranscriptPayload(payload.transcript);
      }

      setMessage(t("recording.transcriptSaved"));
    } catch (mappingError) {
      setError(
        mappingError instanceof Error ? mappingError.message : "Save failed.",
      );
    } finally {
      setBusyAction(null);
    }
  };

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

    if (transcript?.source === "GENERATED" && transcriptionWarnings.length === 0) {
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
  };

  const displayRecordingStatus = recording
    ? resolveDisplayRecordingStatus(recording.status, sessionStatus)
    : null;

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

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-50">
          {t("sessions.recordingAndTranscription")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-slate-400">{t("common.loading")}...</p>
        ) : (
          <>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                <p className="text-xs text-slate-500">{t("recording.recordingStatus")}</p>
                <p className="text-sm font-medium text-slate-100">
                  {recording && displayRecordingStatus
                    ? recordingStatusLabel(
                        displayRecordingStatus,
                        recordingStatusLabels,
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
                <p className="text-xs text-slate-500">{t("recording.compressedFileSize")}</p>
                <p className="text-sm text-slate-200">
                  {formatBytes(recording?.compressedSizeBytes ?? null)}
                </p>
              </div>
            </div>

            {recording?.fileKey ? (
              <p className="text-xs text-slate-500">
                {t("recording.fileKey")}: {recording.fileKey}
              </p>
            ) : null}

            {recording?.compressionStatus ? (
              <p className="text-sm text-slate-400">
                {t("recording.compressionStatus")}: {recording.compressionStatus}
              </p>
            ) : null}

            <p className="text-sm text-slate-400">{t("recording.compressionInfo")}</p>

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

            {!readOnly ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">
                  {t("recording.language")}
                </label>
                <select
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

            {speakersForMapping.length > 0 && !readOnly ? (
              <div className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
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
                          setSpeakerMappingDraft((current) => ({
                            ...current,
                            [speaker.speakerLabel]: value || null,
                          }));
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
                    onClick={() => void saveSpeakerMapping(false)}
                  >
                    {busyAction === "save-mapping"
                      ? t("common.saving")
                      : t("recording.saveSpeakerMapping")}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={busyAction != null}
                    onClick={() => void saveSpeakerMapping(true)}
                  >
                    {busyAction === "apply-mapping"
                      ? t("common.saving")
                      : t("recording.applyMappingToTranscript")}
                  </SecondaryButton>
                </div>
              </div>
            ) : null}

            {diarizedTurns.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    {t("recording.diarizedTranscript")}
                  </label>
                  <SecondaryButton
                    disabled={busyAction != null}
                    onClick={() => void copyDiarizedTranscript()}
                  >
                    {t("recording.copyDiarizedTranscript")}
                  </SecondaryButton>
                </div>

                <div className="space-y-3">
                  {diarizedTurns.map((turn, index) => (
                    <div
                      key={`${turn.speakerName}-${index}`}
                      className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-950/80 px-4 py-3 shadow-inner"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300/90">
                        {turn.speakerName}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-slate-200">
                        {turn.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
                value={transcriptText}
                onChange={(event) => setTranscriptText(event.target.value)}
                readOnly={readOnly}
                rows={10}
                placeholder={t("recording.noTranscriptYet")}
                className="w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
              {!readOnly ? (
                <SecondaryButton
                  disabled={busyAction != null}
                  onClick={() => void saveTranscript()}
                >
                  {busyAction === "save"
                    ? t("common.saving")
                    : t("recording.saveTranscript")}
                </SecondaryButton>
              ) : null}
            </div>

            {message ? <p className="text-sm text-emerald-400">{message}</p> : null}
            {error ? <p className="text-sm text-amber-400">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
