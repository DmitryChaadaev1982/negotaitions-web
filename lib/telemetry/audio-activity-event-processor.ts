type RecordingWindow = {
  startedAt: Date | null;
  endedAt: Date | null;
};

type ActivityRow = {
  id: string;
  startedAt: Date;
  startedOffsetSeconds: number | null;
};

export type AudioActivityRepository = {
  findRecordingWindow: (sessionId: string) => Promise<RecordingWindow | null>;
  createActivity: (data: {
    sessionId: string;
    sessionParticipantId: string;
    participantIdentity: string | null;
    source: string;
    confidence: number | null;
    startedAt: Date;
    endedAt?: Date | null;
    startedOffsetSeconds: number | null;
    endedOffsetSeconds?: number | null;
  }) => Promise<void>;
  findLatestOpenActivity: (sessionId: string, sessionParticipantId: string) => Promise<ActivityRow | null>;
  updateActivity: (id: string, data: {
    endedAt: Date;
    endedOffsetSeconds: number | null;
    startedOffsetSeconds: number | null;
  }) => Promise<void>;
};

export type AudioActivityInput = {
  sessionId: string;
  event: "SPEAKING_START" | "SPEAKING_END" | "speaking_interval";
  resolvedSessionParticipantId: string;
  source: string;
  participantIdentity?: string | null;
  sessionParticipantId?: string | null;
  clientTimestamp?: string;
  offsetSeconds?: number;
  audioLevel?: number;
  startedAt?: string;
  endedAt?: string;
};

export type AudioActivityResult = {
  accepted: boolean;
  reason: string;
  httpStatus: number;
  hasOffsets: boolean;
  intervalDurationMs: number | null;
};

function toRoundedSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}

function deriveOffsetSeconds(eventAt: Date, recordingStart: Date | null) {
  if (!recordingStart) return null;
  return Math.max(0, toRoundedSeconds((eventAt.getTime() - recordingStart.getTime()) / 1000));
}

function normalizeOffsetSeconds(offsetSeconds: number | null, recordingDurationSeconds: number | null) {
  if (typeof offsetSeconds !== "number") return null;
  if (recordingDurationSeconds == null) return Math.max(0, offsetSeconds);
  return Math.max(0, Math.min(offsetSeconds, recordingDurationSeconds));
}

function parseIsoDate(input: string | undefined): Date | null {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampIntervalToRecording(params: {
  startedAt: Date;
  endedAt: Date;
  recordingWindow: RecordingWindow | null;
}) {
  const { startedAt, endedAt, recordingWindow } = params;
  if (endedAt.getTime() <= startedAt.getTime()) {
    return { accepted: false as const, reason: "invalid_interval_order" };
  }

  const recordingStart = recordingWindow?.startedAt ?? null;
  const recordingEnd = recordingWindow?.endedAt ?? null;
  if (!recordingStart) {
    return {
      accepted: true as const,
      startedAt,
      endedAt,
      startedOffsetSeconds: null,
      endedOffsetSeconds: null,
      intervalDurationMs: endedAt.getTime() - startedAt.getTime(),
    };
  }

  const startsAfterEnd = recordingEnd && startedAt.getTime() >= recordingEnd.getTime();
  const endsBeforeStart = endedAt.getTime() <= recordingStart.getTime();
  if (startsAfterEnd || endsBeforeStart) {
    return { accepted: false as const, reason: "interval_outside_recording_window" };
  }

  const clampedStart = startedAt.getTime() < recordingStart.getTime() ? recordingStart : startedAt;
  const clampedEnd =
    recordingEnd && endedAt.getTime() > recordingEnd.getTime() ? recordingEnd : endedAt;

  if (clampedEnd.getTime() <= clampedStart.getTime()) {
    return { accepted: false as const, reason: "interval_outside_recording_window" };
  }

  const recordingDurationSeconds = recordingEnd
    ? Math.max(0, (recordingEnd.getTime() - recordingStart.getTime()) / 1000)
    : null;
  const rawStartedOffset = deriveOffsetSeconds(clampedStart, recordingStart);
  const rawEndedOffset = deriveOffsetSeconds(clampedEnd, recordingStart);

  return {
    accepted: true as const,
    startedAt: clampedStart,
    endedAt: clampedEnd,
    startedOffsetSeconds: normalizeOffsetSeconds(rawStartedOffset, recordingDurationSeconds),
    endedOffsetSeconds: normalizeOffsetSeconds(rawEndedOffset, recordingDurationSeconds),
    intervalDurationMs: clampedEnd.getTime() - clampedStart.getTime(),
  };
}

export async function processAudioActivityEvent(
  repository: AudioActivityRepository,
  input: AudioActivityInput,
): Promise<AudioActivityResult> {
  if (input.sessionParticipantId && input.sessionParticipantId !== input.resolvedSessionParticipantId) {
    return {
      accepted: false,
      reason: "invalid_session_participant_id",
      httpStatus: 403,
      hasOffsets: false,
      intervalDurationMs: null,
    };
  }

  const recordingWindow = await repository.findRecordingWindow(input.sessionId);
  const recordingStart = recordingWindow?.startedAt ?? null;
  const recordingDurationSeconds =
    recordingWindow?.startedAt && recordingWindow?.endedAt
      ? Math.max(0, (recordingWindow.endedAt.getTime() - recordingWindow.startedAt.getTime()) / 1000)
      : null;

  if (input.event === "speaking_interval") {
    const startedAt = parseIsoDate(input.startedAt);
    const endedAt = parseIsoDate(input.endedAt);
    if (!startedAt || !endedAt) {
      return {
        accepted: false,
        reason: "invalid_interval_timestamps",
        httpStatus: 400,
        hasOffsets: false,
        intervalDurationMs: null,
      };
    }
    const clamped = clampIntervalToRecording({ startedAt, endedAt, recordingWindow });
    if (!clamped.accepted) {
      return {
        accepted: false,
        reason: clamped.reason,
        httpStatus: 200,
        hasOffsets: false,
        intervalDurationMs: null,
      };
    }
    await repository.createActivity({
      sessionId: input.sessionId,
      sessionParticipantId: input.resolvedSessionParticipantId,
      participantIdentity: input.participantIdentity ?? null,
      source: input.source,
      confidence: typeof input.audioLevel === "number" ? input.audioLevel : null,
      startedAt: clamped.startedAt,
      endedAt: clamped.endedAt,
      startedOffsetSeconds: clamped.startedOffsetSeconds,
      endedOffsetSeconds: clamped.endedOffsetSeconds,
    });
    return {
      accepted: true,
      reason: "interval_recorded",
      httpStatus: 200,
      hasOffsets: clamped.startedOffsetSeconds != null && clamped.endedOffsetSeconds != null,
      intervalDurationMs: clamped.intervalDurationMs,
    };
  }

  const now = new Date();
  const clientTime = parseIsoDate(input.clientTimestamp) ?? now;
  const offset =
    input.offsetSeconds ?? deriveOffsetSeconds(clientTime, recordingStart);
  const normalizedOffset = normalizeOffsetSeconds(offset, recordingDurationSeconds);

  if (input.event === "SPEAKING_START") {
    await repository.createActivity({
      sessionId: input.sessionId,
      sessionParticipantId: input.resolvedSessionParticipantId,
      participantIdentity: input.participantIdentity ?? null,
      source: input.source,
      confidence: typeof input.audioLevel === "number" ? input.audioLevel : null,
      startedAt: clientTime,
      startedOffsetSeconds: normalizedOffset,
    });
    return {
      accepted: true,
      reason: "start_recorded",
      httpStatus: 200,
      hasOffsets: normalizedOffset != null,
      intervalDurationMs: null,
    };
  }

  const openActivity = await repository.findLatestOpenActivity(
    input.sessionId,
    input.resolvedSessionParticipantId,
  );
  if (!openActivity) {
    return {
      accepted: false,
      reason: "no_open_interval_for_end",
      httpStatus: 200,
      hasOffsets: normalizedOffset != null,
      intervalDurationMs: null,
    };
  }

  const endedOffsetSeconds =
    normalizedOffset == null
      ? null
      : openActivity.startedOffsetSeconds != null
        ? Math.max(normalizedOffset, openActivity.startedOffsetSeconds)
        : normalizedOffset;
  const startedOffsetSeconds =
    openActivity.startedOffsetSeconds ??
    normalizeOffsetSeconds(deriveOffsetSeconds(openActivity.startedAt, recordingStart), recordingDurationSeconds);
  const intervalDurationMs = Math.max(0, clientTime.getTime() - openActivity.startedAt.getTime());
  await repository.updateActivity(openActivity.id, {
    endedAt: clientTime,
    endedOffsetSeconds,
    startedOffsetSeconds,
  });
  return {
    accepted: true,
    reason: "end_recorded",
    httpStatus: 200,
    hasOffsets: endedOffsetSeconds != null,
    intervalDurationMs,
  };
}
