"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { RoomAuthToken } from "@/lib/room-auth";
import {
  getRemoteTrackerBlockReason,
  type RemoteLifecycleCloseReason,
} from "@/lib/telemetry/voximplant-remote-speaking-tracker";
import { VOX_REMOTE_STREAM_ACTIVITY_SOURCE } from "@/lib/telemetry/audio-activity-sources";
import {
  buildSpeakingIntervalPayload,
  postSpeakingInterval,
} from "@/lib/telemetry/voximplant-speaking-tracker";
import { VOX_END_DEBOUNCE_MS, VOX_MIN_INTERVAL_MS } from "@/lib/telemetry/speaking-activity-config";

type RemoteTelemetryTarget = {
  sessionParticipantId: string;
  participantIdentity: string | null;
  isSpeaking: boolean;
};

type OpenIntervalState = {
  startedAt: Date;
  participantIdentity: string | null;
  silenceTimerId: number | null;
};

type VoximplantRemoteSpeakingActivityTrackerProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  connectionId?: string;
  enabled: boolean;
  debugEnabled: boolean;
  canReportRemoteTelemetry: boolean;
  recordingStatus?: string | null;
  audioProcessingEnabled?: boolean;
  targets: RemoteTelemetryTarget[];
};

export function VoximplantRemoteSpeakingActivityTracker({
  sessionId,
  roomAuth,
  connectionId,
  enabled,
  debugEnabled,
  canReportRemoteTelemetry,
  recordingStatus,
  audioProcessingEnabled,
  targets,
}: VoximplantRemoteSpeakingActivityTrackerProps) {
  const blockReason = useMemo(
    () =>
      getRemoteTrackerBlockReason({
        enabled,
        debugEnabled,
        canReportRemoteTelemetry,
      }),
    [enabled, debugEnabled, canReportRemoteTelemetry],
  );

  const openIntervalsRef = useRef(new Map<string, OpenIntervalState>());
  const runtimeRef = useRef({
    sessionId,
    roomAuth,
    connectionId,
    recordingStatus,
    audioProcessingEnabled,
  });

  useEffect(() => {
    runtimeRef.current = {
      sessionId,
      roomAuth,
      connectionId,
      recordingStatus,
      audioProcessingEnabled,
    };
  }, [audioProcessingEnabled, connectionId, recordingStatus, roomAuth, sessionId]);

  const flushInterval = useCallback(
    (participantId: string, endedAt: Date, reason: RemoteLifecycleCloseReason) => {
      const state = openIntervalsRef.current.get(participantId);
      if (!state) return;
      if (state.silenceTimerId != null) {
        window.clearTimeout(state.silenceTimerId);
      }
      openIntervalsRef.current.delete(participantId);
      const durationMs = endedAt.getTime() - state.startedAt.getTime();
      if (durationMs < VOX_MIN_INTERVAL_MS) {
        return;
      }
      const runtime = runtimeRef.current;
      const recordingActiveClientSide =
        runtime.recordingStatus === "STARTING" ||
        runtime.recordingStatus === "RECORDING" ||
        runtime.recordingStatus === "PAUSED";
      const payload = buildSpeakingIntervalPayload({
        sessionParticipantId: participantId,
        participantIdentity: state.participantIdentity,
        startedAt: state.startedAt,
        endedAt,
        source: VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
        recordingActiveClientSide,
        audioProcessingEnabled: runtime.audioProcessingEnabled,
      });
      void postSpeakingInterval({
        fetchImpl: window.fetch.bind(window),
        sessionId: runtime.sessionId,
        roomAuth: runtime.roomAuth,
        connectionId: runtime.connectionId,
        payload,
      })
        .then((result) => {
          if (debugEnabled && process.env.NODE_ENV !== "production") {
            console.debug("[vox-remote-telemetry] interval posted", {
              sessionParticipantId: participantId,
              durationMs,
              reason,
              status: result.status,
            });
          }
        })
        .catch((error) => {
          if (debugEnabled && process.env.NODE_ENV !== "production") {
            console.debug("[vox-remote-telemetry] interval post failed", {
              sessionParticipantId: participantId,
              durationMs,
              reason,
              error: error instanceof Error ? error.message : "post-failed",
            });
          }
        });
    },
    [debugEnabled],
  );

  useEffect(() => {
    if (blockReason) {
      for (const [participantId, state] of openIntervalsRef.current) {
        if (state.silenceTimerId != null) {
          window.clearTimeout(state.silenceTimerId);
        }
        flushInterval(participantId, new Date(), "block_transition");
      }
      return;
    }

    const targetIds = new Set(targets.map((target) => target.sessionParticipantId));
    for (const [participantId, state] of openIntervalsRef.current) {
      if (!targetIds.has(participantId)) {
        if (state.silenceTimerId != null) {
          window.clearTimeout(state.silenceTimerId);
        }
        flushInterval(participantId, new Date(), "block_transition");
      }
    }

    for (const target of targets) {
      const existing = openIntervalsRef.current.get(target.sessionParticipantId);
      if (target.isSpeaking) {
        if (existing?.silenceTimerId != null) {
          window.clearTimeout(existing.silenceTimerId);
          existing.silenceTimerId = null;
        }
        if (!existing) {
          openIntervalsRef.current.set(target.sessionParticipantId, {
            startedAt: new Date(),
            participantIdentity: target.participantIdentity,
            silenceTimerId: null,
          });
        }
        continue;
      }

      if (!existing) continue;
      if (existing.silenceTimerId != null) continue;
      existing.silenceTimerId = window.setTimeout(() => {
        const latest = openIntervalsRef.current.get(target.sessionParticipantId);
        if (!latest) return;
        latest.silenceTimerId = null;
        flushInterval(target.sessionParticipantId, new Date(), "silence_debounce");
      }, VOX_END_DEBOUNCE_MS);
    }
  }, [blockReason, flushInterval, targets]);

  useEffect(() => {
    const openIntervals = openIntervalsRef.current;
    return () => {
      for (const [participantId, state] of openIntervals) {
        if (state.silenceTimerId != null) {
          window.clearTimeout(state.silenceTimerId);
        }
        flushInterval(participantId, new Date(), "unmount");
      }
    };
  }, [flushInterval]);

  return null;
}
