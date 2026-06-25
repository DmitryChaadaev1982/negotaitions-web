"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/card";
import { SecondaryButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
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
  roomAuth: RoomAuthToken;
  readOnly?: boolean;
  autoTranscribeEnabled?: boolean;
  /** When true, renders without outer Card wrapper (for embedding in a parent panel). */
  embedded?: boolean;
  /** Hides recording metadata grid and secondary info — for narrow sidebars. */
  compact?: boolean;
  /** Hides the built-in re-run transcription block (parent provides actions). */
  hideRerunControls?: boolean;
  /** Called after transcript/mapping changes so parent can refresh processing status. */
  onProcessingChange?: () => void;
  /** When true, disables all editing interactions (e.g. during retranscription). */
  isLocked?: boolean;
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
  return recording.status === "COMPLETED" && Boolean(recording.fileKey);
}

function hasUsableTranscript(transcript: TranscriptData | null) {
  return Boolean(transcript?.text?.trim() || transcript?.diarizedText?.trim());
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

type ManualSpeakerTurn = {
  id: string;
  participantId: string;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  speakerLabel: string | null;
  displaySpeakerLabel: string | null;
  /** User-assigned speaker slot (e.g. "1", "2") used for cluster-level propagation when speakerLabel is absent. */
  speakerSlot: string | null;
};

function createManualTurnId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildInitialManualTurnsFromTranscript(
  transcriptText: string,
): ManualSpeakerTurn[] {
  const chunks = transcriptText
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return [
      {
        id: createManualTurnId(),
        participantId: "",
        text: "",
        startSeconds: null,
        endSeconds: null,
        speakerLabel: null,
        displaySpeakerLabel: null,
        speakerSlot: null,
      },
    ];
  }

  return chunks.map((chunk) => ({
    id: createManualTurnId(),
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
  const normalized = segments
    .map((segment) => segment.text.trim())
    .map((text, index) => ({
      segment: segments[index]!,
      text,
    }))
    .filter((item) => item.text.length > 0);

  if (normalized.length === 0) {
    return buildInitialManualTurnsFromTranscript("");
  }

  return normalized.map((item) => ({
    id: createManualTurnId(),
    participantId: item.segment.mappedParticipantId ?? "",
    text: item.text,
    startSeconds: item.segment.startSeconds,
    endSeconds: item.segment.endSeconds,
    speakerLabel: item.segment.speakerLabel,
    displaySpeakerLabel: item.segment.displaySpeakerLabel ?? item.segment.speakerLabel,
    speakerSlot: item.segment.speakerLabel ?? null,
  }));
}

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

function formatTurnTime(startSeconds: number | null, endSeconds: number | null): string {
  const toTimestamp = (value: number) => {
    const safe = Math.max(0, Math.floor(value));
    const hours = Math.floor(safe / 3600)
      .toString()
      .padStart(2, "0");
    const minutes = Math.floor((safe % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safe % 60).toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  if (startSeconds == null && endSeconds == null) {
    return "00:00:00";
  }

  if (startSeconds != null && endSeconds != null) {
    return `${toTimestamp(startSeconds)}-${toTimestamp(endSeconds)}`;
  }

  return toTimestamp(startSeconds ?? endSeconds ?? 0);
}

const STATUS_POLL_INTERVAL_MS = 1_000;
const RECORDING_STATUS_STALL_MS = 45_000;

export function RecordingTranscriptionSection({
  sessionId,
  roomAuth,
  readOnly = false,
  autoTranscribeEnabled = false,
  embedded = false,
  compact = false,
  hideRerunControls = false,
  onProcessingChange,
  isLocked = false,
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
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);

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
      const response = await fetch(
        `/api/sessions/${sessionId}/recording?${roomAuthQuery(roomAuth)}`,
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
  }, [roomAuth, sessionId]);

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
            ...roomAuthBody(roomAuth),
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
  }, [applyTranscriptPayload, roomAuth, languageHint, notifyProcessingChange, recording, sessionId, t]);

  const rerunTranscription = useCallback(async () => {
    setRerunConfirmOpen(false);
    setBusyAction("rerun");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/materials/retranscribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...roomAuthBody(roomAuth), language: languageHint }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        status?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? t("recording.rerunTranscription") + " failed.");
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
    sessionStatus === "FINISHED" &&
    Boolean(recording) &&
    !isRecordingReadyForTranscription(recording!);

  const canTranscribeRecording =
    !readOnly &&
    sessionStatus === "FINISHED" &&
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
      const response = await fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...roomAuthBody(roomAuth), text: transcriptText }),
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
  }) => {
    const applyOnly = options?.applyOnly ?? false;
    const confirm = options?.confirm ?? false;
    setBusyAction(applyOnly ? "apply-mapping" : confirm ? "confirm-mapping" : "save-mapping");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/speaker-mapping`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...roomAuthBody(roomAuth),
            mapping: speakerMappingDraft,
            applyOnly,
            confirm,
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

      setMessage(
        confirm
          ? t("recording.speakerMappingConfirmed")
          : t("recording.transcriptSaved"),
      );
      notifyProcessingChange();
    } catch (mappingError) {
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
    const normalizedTurns = manualSpeakerTurns
      .map((turn) => ({
        participantId: turn.participantId.trim(),
        text: turn.text.trim(),
        startSeconds: turn.startSeconds,
        endSeconds: turn.endSeconds,
      }))
      .filter((turn) => turn.text.length > 0);

    if (
      normalizedTurns.length === 0 ||
      normalizedTurns.some((turn) => turn.participantId.length === 0)
    ) {
      setError(t("recording.manualSpeakerAttributionRequiredFields"));
      return;
    }

    setBusyAction("manual-speaker-attribution");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/sessions/${sessionId}/manual-speaker-attribution`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...roomAuthBody(roomAuth),
            turns: normalizedTurns,
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        transcript?: TranscriptData;
      };

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
  }, [applyTranscriptPayload, roomAuth, manualSpeakerTurns, notifyProcessingChange, sessionId, t]);

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
  const showManualSpeakerAttributionFallback =
    !readOnly &&
    transcript?.source === "GENERATED" &&
    !transcript.hasSpeakerDiarization &&
    hasUsableTranscript(transcript);

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

  const allSpeakersMappedInDraft = useMemo(() => {
    if (speakersForMapping.length === 0) {
      return false;
    }
    return speakersForMapping.every((speaker) =>
      Boolean(speakerMappingDraft[speaker.speakerLabel]),
    );
  }, [speakerMappingDraft, speakersForMapping]);

  const content = (
    <>
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

            {!compact ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3">
                    <p className="text-xs text-slate-500">{t("recording.recordingStatus")}</p>
                    <p
                      data-testid="recording-status"
                      data-status={displayRecordingStatus ?? "NOT_STARTED"}
                      className="text-sm font-medium text-slate-100"
                    >
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
              </>
            ) : (
              <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2">
                <p className="text-xs text-slate-500">{t("recording.recordingStatus")}</p>
                <p
                  data-testid="recording-status"
                  data-status={displayRecordingStatus ?? "NOT_STARTED"}
                  className="text-sm font-medium text-slate-100"
                >
                  {recording && displayRecordingStatus
                    ? recordingStatusLabel(
                        displayRecordingStatus,
                        recordingStatusLabels,
                      )
                    : t("recording.noRecordingYet")}
                </p>
              </div>
            )}

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
                      data-testid="transcribe-recording-button"
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
                              {formatTurnTime(turn.startSeconds, turn.endSeconds)}
                            </span>
                          </div>
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

                        <select
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
                      <SecondaryButton
                        type="button"
                        disabled={busyAction != null}
                        onClick={() => {
                          setManualSpeakerTurns((current) => [
                            ...current,
                            {
                              id: createManualTurnId(),
                              participantId: "",
                              text: "",
                              startSeconds: null,
                              endSeconds: null,
                              speakerLabel: null,
                              displaySpeakerLabel: null,
                              speakerSlot: null,
                            },
                          ]);
                        }}
                      >
                        {t("recording.addManualSpeakerTurn")}
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        disabled={busyAction != null}
                        onClick={() => void saveManualSpeakerAttribution()}
                        data-testid="save-manual-speaker-attribution-button"
                      >
                        {busyAction === "manual-speaker-attribution"
                          ? t("common.saving")
                          : t("recording.saveManualSpeakerAttribution")}
                      </SecondaryButton>
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

            {speakersForMapping.length > 0 && !readOnly && !isLocked ? (
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
                    onClick={() =>
                      void saveSpeakerMapping({
                        confirm: allSpeakersMappedInDraft,
                      })
                    }
                  >
                    {busyAction === "save-mapping"
                      ? t("common.saving")
                      : t("recording.saveSpeakerMapping")}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={busyAction != null || !allSpeakersMappedInDraft}
                    onClick={() => void saveSpeakerMapping({ confirm: true })}
                    data-testid="confirm-speaker-mapping-button"
                  >
                    {busyAction === "confirm-mapping"
                      ? t("common.saving")
                      : t("recording.confirmSpeakerMapping")}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={busyAction != null}
                    onClick={() => void saveSpeakerMapping({ applyOnly: true })}
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
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      disabled={busyAction != null}
                      onClick={() => void copyDiarizedTranscript()}
                    >
                      {t("recording.copyDiarizedTranscript")}
                    </SecondaryButton>
                    {!readOnly && !isLocked && !manualSpeakerModeEnabled ? (
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
                ) : null}
              </div>
            ) : null}

            {/* Plain transcript: only shown when no diarized content is available.
                When speaker diarization is active, the diarized view above is the source of truth. */}
            {diarizedTurns.length === 0 ? (
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
                  readOnly={readOnly || isLocked}
                  rows={10}
                  placeholder={t("recording.noTranscriptYet")}
                  className="w-full rounded-lg border border-slate-600/40 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
                {!readOnly && !isLocked ? (
                  <SecondaryButton
                    data-testid="save-transcript-button"
                    disabled={busyAction != null}
                    onClick={() => void saveTranscript()}
                  >
                    {busyAction === "save"
                      ? t("common.saving")
                      : t("recording.saveTranscript")}
                  </SecondaryButton>
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
    </>
  );

  if (embedded) {
    return (
      <div className="relative space-y-6">
        {content}
        {isLocked ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-900/80 backdrop-blur-sm">
            <span className="animate-spin text-2xl text-cyan-400">⟳</span>
            <p className="text-sm text-cyan-300">{t("sessionMaterials.transcriptionInProgress")}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="relative">
      <CardHeader>
        <h2 className="text-base font-semibold text-slate-50">
          {t("sessions.recordingAndTranscription")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-6">{content}</CardContent>
      {isLocked ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-900/80 backdrop-blur-sm">
          <span className="animate-spin text-2xl text-cyan-400">⟳</span>
          <p className="text-sm text-cyan-300">{t("sessionMaterials.transcriptionInProgress")}</p>
        </div>
      ) : null}
    </Card>
  );
}
