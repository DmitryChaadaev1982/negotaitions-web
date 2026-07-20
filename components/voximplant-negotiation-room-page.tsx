"use client";

/**
 * Architecture: docs/architecture/05-voximplant-integration.md
 * Architecture: docs/architecture/04-session-event-flow.md
 */

/**
 * Stage 5.3/5.4 — Voximplant negotiation room page.
 *
 * Uses the shared room shell for all business/session orchestration.
 * Voximplant-specific code is limited to:
 *   - useVoximplantRoom (media/auth lifecycle, sendConferenceMessage)
 *   - VoximplantVideoLayout (video tiles)
 *   - VoximplantControlBar (mic/camera toggles using hook callbacks)
 *   - AudioDiagnosticsPanel (?debugAudio=1)
 *   - VoximplantRecordingControls (Stage 5.4: start/stop recording relay)
 *
 * Business logic (roles, privacy, sidebar, facilitator controls, recording
 * indicator, timer, debrief, etc.) is fully delegated to SharedRoomShell.
 */

import { GradientButtonLink } from "@/components/ui/buttons";
import { SharedRoomShell } from "@/components/shared-room-shell";
import { VoximplantMediaControls } from "@/components/voximplant-media-controls";
import { VoximplantSpeakingActivityTracker } from "@/components/voximplant-speaking-activity-tracker";
import VoximplantVideoLayout from "@/components/voximplant-video-layout";
import { buildSessionMaterialsPath } from "@/lib/config";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
import {
  clearSessionLeftFlag,
  markSessionLeftFlag,
} from "@/lib/session-room-leave";
import {
  clearRecoveryContext,
  saveRecoveryContext,
  touchRecoveryContext,
} from "@/lib/rejoin/recovery-storage";
import type { RoomRecordingState, ShellSessionCloseState } from "@/lib/room-provider/types";
import type { ControlState } from "@/lib/negotiation-control";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import { useVoximplantRoom } from "@/lib/voximplant/use-voximplant-room";
import type { RecordingControlMessage } from "@/lib/voximplant/scenario-messages";
import type {
  ConferenceCallReferenceSource,
  ConferenceMessageSendResult,
} from "@/lib/voximplant/use-voximplant-room";
import { isRemoteStreamTelemetryEnabled } from "@/lib/telemetry/voximplant-remote-speaking-tracker";
import { shouldEnableLocalMicTelemetryForRole } from "@/lib/telemetry/audio-activity-role-gates";
import type { ParticipantType } from "@/app/generated/prisma/enums";
import { useClientConnectionId } from "@/lib/client/connection-id";
import {
  getRoomClosureRedirectFromConflict,
  isStaleConnectionResponse,
} from "@/lib/client/stale-connection";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Page props ───────────────────────────────────────────────────────────────

type VoximplantNegotiationRoomPageProps =
  | {
      sessionId: string;
      authMode?: "guest";
      joinToken: string;
      participantId?: never;
      disableInitialCamera?: boolean;
      disableInitialMic?: boolean;
      debugAudio?: boolean;
      debugRecording?: boolean;
    }
  | {
      sessionId: string;
      authMode: "account";
      participantId: string;
      joinToken?: never;
      disableInitialCamera?: boolean;
      disableInitialMic?: boolean;
      debugAudio?: boolean;
      debugRecording?: boolean;
    };

// ─── VoximplantControlBar ─────────────────────────────────────────────────────
// Provider-specific control bar that mirrors the shape of RestrictedControlBar.

function VoximplantControlBar({
  joined,
  disabled,
  micCaptureStatus,
  micAllowed,
  isCameraOn,
  cameraUnavailable,
  toggleMic,
  toggleCamera,
}: {
  joined: boolean;
  disabled?: boolean;
  micCaptureStatus: string;
  micAllowed: boolean;
  isCameraOn: boolean;
  cameraUnavailable: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
}) {
  const micActuallyOn = micCaptureStatus === "active";
  const micState: "on" | "off" | "locked" =
    !micAllowed ? "locked" : micActuallyOn ? "on" : "off";
  const cameraState: "on" | "off" | "locked" = cameraUnavailable
    ? "locked"
    : isCameraOn
      ? "on"
      : "off";

  return (
    <VoximplantMediaControls
      joined={joined}
      disabled={disabled}
      micState={micState}
      cameraState={cameraState}
      onToggleMic={toggleMic}
      onToggleCamera={toggleCamera}
      testIdPrefix="vox"
    />
  );
}

// ─── VoximplantLeaveButton ────────────────────────────────────────────────────

function VoximplantLeaveButton({
  isLeaving,
  onLeave,
}: {
  isLeaving: boolean;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onLeave}
      disabled={isLeaving}
      className="btn-secondary inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-60"
    >
      {isLeaving ? `${t("common.loading")}...` : t("room.leaveRoom")}
    </button>
  );
}

// ─── Voximplant recording relay types ────────────────────────────────────────

type RecordingControlResponse = {
  ok: boolean;
  provider?: string;
  scenarioMessage?: RecordingControlMessage;
  stopRelay?: {
    operationId: string;
    requestId: string;
    scenarioMessage: RecordingControlMessage;
  };
  recording?: { status: string; errorMessage: string | null } | null;
  warning?: string;
  error?: string;
  code?: string;
  redirectTo?: string;
  fileKeyHandoff?: "webhook";
  fileKeyHandoffDeferred?: boolean;
};

type RecordingStopRelayHint = {
  operationId: string;
  requestId: string;
  operationState: string;
  recordingId: string;
} | null;

type PocRelayRecordingStartRequest = {
  scenarioMessage: RecordingControlMessage;
  operationId?: string | null;
  expectedSessionId?: string | null;
  expectedConferenceName?: string | null;
};

export type PocRelayRecordingStartResult = {
  ok: boolean;
  recordingBrowserCommandClaimedAt: string | null;
  recordingBrowserCommandReceivedAt: string | null;
  recordingBrowserContextRole: string | null;
  recordingBrowserContextId: string | null;
  callReferenceFound: boolean;
  callReferenceSource: ConferenceCallReferenceSource;
  callConnected: boolean;
  callIdSanitized: string | null;
  callState: string | null;
  conferenceName: string | null;
  recordingBrowserCallReferenceFound: boolean;
  recordingBrowserCallReferenceSource: ConferenceCallReferenceSource;
  recordingBrowserCallConnected: boolean;
  recordingBrowserCallIdSanitized: string | null;
  recordingBrowserCallId: string | null;
  recordingBrowserCallState: string | null;
  recordingBrowserConferenceName: string | null;
  recordingBrowserSendMessageInvokedAt: string | null;
  recordingBrowserSendMessageCompletedAt: string | null;
  recordingBrowserSendMessageErrorCode: string | null;
  relayOwnerRole: string | null;
  relayOwnerParticipantId: string | null;
  relayOwnerConnectionId: string | null;
  relayClaimedAt: string | null;
  relayConsumedAt: string | null;
  recordingBrowserCommandSentAt: string | null;
  operationId: string | null;
  errorCode:
    | "RECORDING_START_OPERATION_ID_MISSING"
    | "RECORDING_START_OPERATION_MISMATCH"
    | "RECORDING_START_BROWSER_CONTEXT_MISMATCH"
    | "RECORDING_START_BROWSER_CALL_NOT_FOUND"
    | "RECORDING_START_BROWSER_CALL_NOT_CONNECTED"
    | "RECORDING_START_BROWSER_CALL_STALE"
    | "RECORDING_START_BROWSER_CALL_CONFERENCE_MISMATCH"
    | "RECORDING_START_BROWSER_SEND_NOT_INVOKED"
    | "RECORDING_START_BROWSER_SEND_FAILED"
    | null;
};

// ─── VoximplantNegotiationRoomPage ────────────────────────────────────────────

export default function VoximplantNegotiationRoomPage(
  props: VoximplantNegotiationRoomPageProps,
) {
  const router = useRouter();
  const { t } = useI18n();

  const roomAuth: RoomAuthToken = useMemo(
    () =>
      props.authMode === "account"
        ? { type: "account", participantId: props.participantId }
        : { type: "joinToken", value: props.joinToken },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.authMode, props.authMode === "account" ? props.participantId : props.joinToken],
  );

  const materialsUrl = useMemo(
    () =>
      roomAuth.type === "joinToken"
        ? buildSessionMaterialsPath(roomAuth.value)
        : `/sessions/${props.sessionId}/materials`,
    [props.sessionId, roomAuth],
  );

  const roomConnectionId = useClientConnectionId(`room-${props.sessionId}`);
  const [staleConnection, setStaleConnection] = useState(false);
  const staleConnectionRef = useRef(false);
  const activateStaleConnection = useCallback(() => {
    if (staleConnectionRef.current) return;
    staleConnectionRef.current = true;
    setStaleConnection(true);
  }, []);

  // ── Media hook (Voximplant) ────────────────────────────────────────────────
  const {
    isLoading: mediaLoading,
    isLeaving,
    joined,
    error: mediaError,
    localDisplayName,
    localParticipant,
    remoteParticipants,
    isMicMuted,
    isCameraOn,
    cameraUnavailable,
    mediaWarnings,
    toggleMic,
    toggleCamera,
    leave,
    // Audio diagnostics
    micCaptureStatus,
    localAudioStreamCreated,
    micLevel,
    audioProcessingEnabled,
    remotePlaybackBlocked,
    unlockAudioPlayback,
    // Stage 5.4: recording relay
    sendConferenceMessage,
    sendConferenceMessageDetailed,
    sendMessageAvailable,
  } = useVoximplantRoom({
    sessionId: props.sessionId,
    connectionId: roomConnectionId ?? undefined,
    onStaleConnection: activateStaleConnection,
    disableInitialCamera: props.disableInitialCamera,
    disableInitialMic: props.disableInitialMic,
  });

  // ── Business state (sidebar + control state) ───────────────────────────────
  // Loaded and polled identically to VideoRoomPage for full parity.

  const [businessLoading, setBusinessLoading] = useState(true);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<RoomSidebarData | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);
  const [recordingState, setRecordingState] = useState<RoomRecordingState>(null);
  const recordingStateRef = useRef<RoomRecordingState>(null);
  const [recordingStopRelayHint, setRecordingStopRelayHint] =
    useState<RecordingStopRelayHint>(null);
  const [sessionCloseState, setSessionCloseState] = useState<ShellSessionCloseState>({
    isClosed: false,
    closeMessageKey: null,
    closedBeforeNegotiation: false,
  });
  const lastPublishedMediaStatusRef = useRef<string | null>(null);

  // Initial load of sidebar + control state
  useEffect(() => {
    if (!roomConnectionId) {
      return;
    }

    let cancelled = false;

    const loadBusiness = async () => {
      setBusinessLoading(true);
      setBusinessError(null);

      try {
        if (staleConnectionRef.current) return;
        const [sidebarResult, controlResult] = await Promise.all([
          fetch(
            `/api/livekit/sidebar?${roomAuthQuery(roomAuth, { connectionId: roomConnectionId ?? undefined, claimLease: true })}`,
            {
            cache: "no-store",
            },
          ),
          fetch(
            `/api/sessions/${props.sessionId}/control-state?${roomAuthQuery(roomAuth, { connectionId: roomConnectionId ?? undefined, claimLease: true })}`,
            { cache: "no-store" },
          ),
        ]);

        const redirectTarget =
          (await getRoomClosureRedirectFromConflict(sidebarResult)) ??
          (await getRoomClosureRedirectFromConflict(controlResult));
        if (redirectTarget) {
          window.location.replace(redirectTarget);
          return;
        }
        if (
          (await isStaleConnectionResponse(sidebarResult)) ||
          (await isStaleConnectionResponse(controlResult))
        ) {
          activateStaleConnection();
          return;
        }

        type ControlPayload = ControlState &
          ShellSessionCloseState & {
            recording?: RoomRecordingState;
            recordingStopRelay?: RecordingStopRelayHint;
            closeMessageKey?: ShellSessionCloseState["closeMessageKey"];
          };

        const sidebarPayload = (await sidebarResult.json().catch(() => ({}))) as
          | RoomSidebarData
          | { error?: string };
        const controlPayload = (await controlResult.json().catch(() => ({}))) as
          | ControlPayload
          | { error?: string };

        if (!sidebarResult.ok) {
          throw new Error(
            "error" in sidebarPayload && sidebarPayload.error
              ? sidebarPayload.error
              : t("room.unableToLoadSessionPanel"),
          );
        }
        if (!controlResult.ok) {
          throw new Error(
            "error" in controlPayload && controlPayload.error
              ? controlPayload.error
              : t("room.unableToLoadNegotiationState"),
          );
        }

        if (!cancelled) {
          setSidebar(sidebarPayload as RoomSidebarData);
          const cp = controlPayload as ControlPayload;
          setControlState(cp);
          setRecordingState(cp.recording ?? null);
          setRecordingStopRelayHint(cp.recordingStopRelay ?? null);
          setSessionCloseState({
            isClosed: cp.isClosed,
            closeMessageKey: cp.closeMessageKey ?? null,
            closedBeforeNegotiation: cp.closedBeforeNegotiation,
          });
          saveRecoveryContext({ type: "SESSION_ROOM", sessionId: props.sessionId });
        }
      } catch (loadError) {
        if (!cancelled) {
          setBusinessError(
            loadError instanceof Error ? loadError.message : t("room.unableToJoinRoom"),
          );
          clearRecoveryContext();
        }
      } finally {
        if (!cancelled) {
          setBusinessLoading(false);
        }
      }
    };

    void loadBusiness();
    return () => {
      cancelled = true;
    };
  }, [activateStaleConnection, roomAuth, props.sessionId, roomConnectionId, t]);

  // Polling (mirrors VideoRoomPage — 1-second interval)
  useEffect(() => {
    if (!roomConnectionId || staleConnection || businessLoading || businessError) return;

    const intervalId = window.setInterval(async () => {
      if (staleConnectionRef.current) return;
      touchRecoveryContext();

      try {
        const [controlResponse, sidebarResponse] = await Promise.all([
          fetch(
            `/api/sessions/${props.sessionId}/control-state?${roomAuthQuery(roomAuth, { connectionId: roomConnectionId ?? undefined })}`,
            { cache: "no-store" },
          ),
          fetch(`/api/livekit/sidebar?${roomAuthQuery(roomAuth, { connectionId: roomConnectionId ?? undefined })}`, {
            cache: "no-store",
          }),
        ]);

        if (await isStaleConnectionResponse(controlResponse)) {
          activateStaleConnection();
          return;
        }
        if (controlResponse.ok) {
          type ControlPayload = ControlState &
            ShellSessionCloseState & {
              recording?: RoomRecordingState;
              recordingStopRelay?: RecordingStopRelayHint;
              closeMessageKey?: ShellSessionCloseState["closeMessageKey"];
            };
          const nextState = (await controlResponse.json()) as ControlPayload;
          setControlState(nextState);
          setRecordingState(nextState.recording ?? null);
          setRecordingStopRelayHint(nextState.recordingStopRelay ?? null);
          setSessionCloseState({
            isClosed: nextState.isClosed,
            closeMessageKey: nextState.closeMessageKey ?? null,
            closedBeforeNegotiation: nextState.closedBeforeNegotiation,
          });
        } else if (controlResponse.status === 409) {
          const redirectTarget =
            await getRoomClosureRedirectFromConflict(controlResponse);
          if (redirectTarget) {
            window.location.replace(redirectTarget);
            return;
          }
          activateStaleConnection();
        }

        if (await isStaleConnectionResponse(sidebarResponse)) {
          activateStaleConnection();
          return;
        }
        if (sidebarResponse.ok) {
          const nextSidebar = (await sidebarResponse.json()) as RoomSidebarData;
          setSidebar(nextSidebar);
        } else if (sidebarResponse.status === 409) {
          const redirectTarget =
            await getRoomClosureRedirectFromConflict(sidebarResponse);
          if (redirectTarget) {
            window.location.replace(redirectTarget);
            return;
          }
          activateStaleConnection();
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [
    activateStaleConnection,
    businessLoading,
    businessError,
    roomAuth,
    props.sessionId,
    roomConnectionId,
    staleConnection,
  ]);

  // ── Identity resolution ────────────────────────────────────────────────────
  // Sidebar is always authoritative. Hook value is the transport-level fallback.
  // Visible role NEVER comes from the raw VoxRoomRole (participant_a, facilitator…).

  const effectiveParticipantType: ParticipantType | null =
    sidebar?.participantType ?? null;

  const participantTypeLabel = effectiveParticipantType
    ? t(
        `participantType.${effectiveParticipantType}` as `participantType.${typeof effectiveParticipantType}`,
      )
    : t("participantType.OBSERVER");

  const effectiveDisplayName = sidebar?.displayName || localDisplayName || "Участник";
  const trackerSessionParticipantId =
    roomAuth.type === "account"
      ? roomAuth.participantId
      : (sidebar?.currentParticipantId ?? null);
  const localMicTelemetryEnabled = shouldEnableLocalMicTelemetryForRole(
    effectiveParticipantType,
  );

  // ── Automatic Voximplant recording relay ──────────────────────────────────
  // Recording is tied to negotiation lifecycle: start → start recording,
  // finish → stop recording. No separate UI button is shown.
  // The browser relays a typed scenarioMessage to VoxEngine; the scenario
  // handles actual recording and later sends a status webhook.

  const [recordingRelayError, setRecordingRelayError] = useState<string | null>(null);
  const explicitLeaveInFlightRef = useRef(false);
  const relayInFlightOperationsRef = useRef<Set<string>>(new Set());
  const relayOwnerRef = useRef<{
    operationId: string;
    role: string;
    participantId: string | null;
    connectionId: string | null;
    claimedAt: string;
  } | null>(null);
  const relayOperationMetaRef = useRef<
    Map<
      string,
      {
        sessionId: string;
        conferenceName: string | null;
      }
    >
  >(new Map());
  const relayOperationResultRef = useRef<Map<string, PocRelayRecordingStartResult>>(
    new Map(),
  );
  const joinedRef = useRef(false);
  const roomConnectionIdRef = useRef<string | null>(null);
  const participantTypeRef = useRef<ParticipantType | null>(null);
  const trackerParticipantIdRef = useRef<string | null>(null);
  const sendConferenceMessageDetailedRef = useRef(sendConferenceMessageDetailed);

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);
  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);
  useEffect(() => {
    roomConnectionIdRef.current = roomConnectionId ?? null;
  }, [roomConnectionId]);
  useEffect(() => {
    participantTypeRef.current = effectiveParticipantType;
  }, [effectiveParticipantType]);
  useEffect(() => {
    trackerParticipantIdRef.current = trackerSessionParticipantId;
  }, [trackerSessionParticipantId]);
  useEffect(() => {
    sendConferenceMessageDetailedRef.current = sendConferenceMessageDetailed;
  }, [sendConferenceMessageDetailed]);

  // ── Recording diagnostics (dev-only) ──────────────────────────────────────
  // postRecordingDebug: fire-and-forget POST to diagnostics API.
  // Never blocks user flow — errors are silently ignored.
  const showRecordingDebug =
    props.debugRecording === true ||
    process.env.NEXT_PUBLIC_RECORDING_DEBUG_PANEL === "true";
  const remoteTelemetryDebugEnabled =
    props.debugRecording === true ||
    process.env.NEXT_PUBLIC_VOX_REMOTE_STREAM_TELEMETRY_DEBUG === "1";
  const remoteTelemetryCaptureEnabled = isRemoteStreamTelemetryEnabled(
    process.env.NEXT_PUBLIC_VOX_REMOTE_STREAM_TELEMETRY_ENABLED,
  );

  const postRecordingDebug = useCallback(
    (
      step: string,
      message: string,
      data?: Record<string, unknown>,
      level: "info" | "warn" | "error" | "success" = "info",
    ) => {
      if (!showRecordingDebug) return;
      void fetch(`/api/debug/recording/${encodeURIComponent(props.sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "client", level, step, message, data }),
      }).catch(() => {
        // Non-blocking — ignore all errors.
      });
    },
    [showRecordingDebug, props.sessionId],
  );

  const projectRelayResult = useCallback(
    (
      base: Omit<
        PocRelayRecordingStartResult,
        | "callReferenceFound"
        | "callReferenceSource"
        | "callConnected"
        | "callIdSanitized"
        | "callState"
        | "conferenceName"
        | "recordingBrowserCallReferenceFound"
        | "recordingBrowserCallReferenceSource"
        | "recordingBrowserCallConnected"
        | "recordingBrowserCallIdSanitized"
        | "recordingBrowserCallId"
        | "recordingBrowserCallState"
        | "recordingBrowserConferenceName"
        | "recordingBrowserSendMessageInvokedAt"
        | "recordingBrowserSendMessageCompletedAt"
        | "recordingBrowserSendMessageErrorCode"
        | "recordingBrowserCommandSentAt"
        | "errorCode"
        | "ok"
      >,
      sendResult: ConferenceMessageSendResult,
    ): PocRelayRecordingStartResult => {
      const callErrorCode =
        sendResult.sendErrorCode === "RECORDING_START_BROWSER_CALL_NOT_FOUND"
          ? "RECORDING_START_BROWSER_CALL_NOT_FOUND"
          : sendResult.sendErrorCode === "RECORDING_START_BROWSER_CALL_NOT_CONNECTED"
            ? "RECORDING_START_BROWSER_CALL_NOT_CONNECTED"
            : sendResult.sendErrorCode === "RECORDING_START_BROWSER_CALL_STALE"
              ? "RECORDING_START_BROWSER_CALL_STALE"
              : sendResult.sendErrorCode ===
                    "RECORDING_START_BROWSER_CALL_CONFERENCE_MISMATCH"
                ? "RECORDING_START_BROWSER_CALL_CONFERENCE_MISMATCH"
            : sendResult.sendErrorCode ===
                  "RECORDING_START_BROWSER_SEND_NOT_INVOKED"
              ? "RECORDING_START_BROWSER_SEND_NOT_INVOKED"
              : sendResult.sendErrorCode === "RECORDING_START_BROWSER_SEND_FAILED"
                ? "RECORDING_START_BROWSER_SEND_FAILED"
                : null;
      const completed = Boolean(sendResult.sendCompletedAt && sendResult.sendCompleted);
      const ok =
        sendResult.callReferenceFound &&
        sendResult.callConnected &&
        sendResult.sendInvoked &&
        completed &&
        !callErrorCode;
      return {
        ...base,
        ok,
        callReferenceFound: sendResult.callReferenceFound,
        callReferenceSource: sendResult.callReferenceSource,
        callConnected: sendResult.callConnected,
        callIdSanitized: sendResult.callIdSanitized,
        callState: sendResult.callState,
        conferenceName: sendResult.conferenceName,
        recordingBrowserCallReferenceFound: sendResult.callReferenceFound,
        recordingBrowserCallReferenceSource: sendResult.callReferenceSource,
        recordingBrowserCallConnected: sendResult.callConnected,
        recordingBrowserCallIdSanitized: sendResult.callIdSanitized,
        recordingBrowserCallId: sendResult.callId,
        recordingBrowserCallState: sendResult.callState,
        recordingBrowserConferenceName: sendResult.conferenceName,
        recordingBrowserSendMessageInvokedAt: sendResult.sendInvokedAt,
        recordingBrowserSendMessageCompletedAt: sendResult.sendCompletedAt,
        recordingBrowserSendMessageErrorCode: callErrorCode,
        recordingBrowserCommandSentAt: completed
          ? sendResult.sendCompletedAt
          : null,
        errorCode: ok ? null : callErrorCode ?? "RECORDING_START_BROWSER_SEND_FAILED",
      };
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const relayRecordingStart = async (
      input: unknown,
    ): Promise<PocRelayRecordingStartResult> => {
      const now = new Date().toISOString();
      const contextRole = participantTypeRef.current ?? "UNKNOWN";
      const contextConnectionId = roomConnectionIdRef.current;
      const contextParticipantId = trackerParticipantIdRef.current;
      const base: Omit<PocRelayRecordingStartResult, "errorCode" | "ok"> = {
        recordingBrowserCommandClaimedAt: now,
        recordingBrowserCommandReceivedAt: now,
        recordingBrowserContextRole: String(contextRole),
        recordingBrowserContextId: contextConnectionId,
        callReferenceFound: false,
        callReferenceSource: "NOT_FOUND",
        callConnected: false,
        callIdSanitized: null,
        callState: null,
        conferenceName: null,
        recordingBrowserCallReferenceFound: false,
        recordingBrowserCallReferenceSource: "NOT_FOUND",
        recordingBrowserCallConnected: false,
        recordingBrowserCallIdSanitized: null,
        recordingBrowserCallId: null,
        recordingBrowserCallState: null,
        recordingBrowserConferenceName: null,
        recordingBrowserSendMessageInvokedAt: null,
        recordingBrowserSendMessageCompletedAt: null,
        recordingBrowserSendMessageErrorCode: null,
        relayOwnerRole: null,
        relayOwnerParticipantId: contextParticipantId,
        relayOwnerConnectionId: null,
        relayClaimedAt: now,
        relayConsumedAt: now,
        recordingBrowserCommandSentAt: null,
        operationId: null,
      };

      const payload =
        input && typeof input === "object"
          ? (input as Partial<PocRelayRecordingStartRequest>)
          : null;
      const scenarioMessage =
        payload?.scenarioMessage as Partial<RecordingControlMessage> | undefined;
      if (
        !scenarioMessage ||
        scenarioMessage.type !== "recording_control" ||
        scenarioMessage.action !== "start"
      ) {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode: "RECORDING_START_BROWSER_SEND_NOT_INVOKED",
          recordingBrowserCommandSentAt: null,
          operationId: null,
          errorCode: "RECORDING_START_BROWSER_SEND_NOT_INVOKED",
        };
      }

      const operationIdFromMessage =
        typeof scenarioMessage.requestId === "string"
          ? scenarioMessage.requestId.trim()
          : "";
      const expectedOperationId =
        typeof payload?.operationId === "string" ? payload.operationId.trim() : "";
      const operationId = expectedOperationId || operationIdFromMessage || null;
      const expectedSessionId =
        typeof payload?.expectedSessionId === "string" ? payload.expectedSessionId.trim() : "";
      if (!operationId) {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode: "RECORDING_START_OPERATION_ID_MISSING",
          recordingBrowserCommandSentAt: null,
          operationId: null,
          errorCode: "RECORDING_START_OPERATION_ID_MISSING",
        };
      }
      if (expectedOperationId && operationIdFromMessage !== expectedOperationId) {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode: "RECORDING_START_OPERATION_MISMATCH",
          recordingBrowserCommandSentAt: null,
          operationId,
          errorCode: "RECORDING_START_OPERATION_MISMATCH",
        };
      }
      if (expectedSessionId && expectedSessionId !== props.sessionId) {
        return {
          ...base,
          ok: false,
          recordingBrowserSendMessageErrorCode: "RECORDING_START_OPERATION_MISMATCH",
          operationId,
          errorCode: "RECORDING_START_OPERATION_MISMATCH",
        };
      }

      if (scenarioMessage.sessionId && scenarioMessage.sessionId !== props.sessionId) {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode: "RECORDING_START_OPERATION_MISMATCH",
          recordingBrowserCommandSentAt: null,
          operationId,
          errorCode: "RECORDING_START_OPERATION_MISMATCH",
        };
      }

      const priorMeta = relayOperationMetaRef.current.get(operationId);
      const expectedConferenceName =
        typeof payload?.expectedConferenceName === "string" &&
        payload.expectedConferenceName.trim()
          ? payload.expectedConferenceName.trim()
          : typeof scenarioMessage.conferenceName === "string" &&
              scenarioMessage.conferenceName.trim()
            ? scenarioMessage.conferenceName.trim()
            : null;
      const nextMeta = {
        sessionId: props.sessionId,
        conferenceName: expectedConferenceName,
      };
      if (
        priorMeta &&
        (priorMeta.sessionId !== nextMeta.sessionId ||
          priorMeta.conferenceName !== nextMeta.conferenceName)
      ) {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode: "RECORDING_START_OPERATION_MISMATCH",
          recordingBrowserCommandSentAt: null,
          operationId,
          errorCode: "RECORDING_START_OPERATION_MISMATCH",
        };
      }

      const priorResult = relayOperationResultRef.current.get(operationId);
      if (priorResult) {
        return {
          ...priorResult,
          relayConsumedAt: now,
          recordingBrowserCommandReceivedAt: now,
        };
      }

      if (contextRole !== "FACILITATOR") {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode:
            "RECORDING_START_BROWSER_CONTEXT_MISMATCH",
          recordingBrowserCommandSentAt: null,
          operationId,
          errorCode: "RECORDING_START_BROWSER_CONTEXT_MISMATCH",
        };
      }

      const existingOwner = relayOwnerRef.current;
      if (existingOwner && existingOwner.operationId === operationId) {
        const ownerMatches =
          existingOwner.role === "FACILITATOR" &&
          existingOwner.connectionId === contextConnectionId;
        if (!ownerMatches) {
          return {
            ...base,
            ok: false,
            recordingBrowserCallReferenceFound: false,
            recordingBrowserCallId: null,
            recordingBrowserCallState: null,
            recordingBrowserSendMessageInvokedAt: null,
            recordingBrowserSendMessageCompletedAt: null,
            recordingBrowserSendMessageErrorCode:
              "RECORDING_START_BROWSER_CONTEXT_MISMATCH",
            recordingBrowserCommandSentAt: null,
            operationId,
            errorCode: "RECORDING_START_BROWSER_CONTEXT_MISMATCH",
          };
        }
      } else {
        relayOwnerRef.current = {
          operationId,
          role: "FACILITATOR",
          participantId: contextParticipantId,
          connectionId: contextConnectionId,
          claimedAt: now,
        };
      }

      if (!joinedRef.current) {
        return {
          ...base,
          ok: false,
          recordingBrowserCallReferenceFound: false,
          recordingBrowserCallId: null,
          recordingBrowserCallState: null,
          recordingBrowserSendMessageInvokedAt: null,
          recordingBrowserSendMessageCompletedAt: null,
          recordingBrowserSendMessageErrorCode:
            "RECORDING_START_BROWSER_CALL_NOT_CONNECTED",
          recordingBrowserCommandSentAt: null,
          operationId,
          relayOwnerRole: "FACILITATOR",
          relayOwnerParticipantId: contextParticipantId,
          relayOwnerConnectionId: contextConnectionId,
          errorCode: "RECORDING_START_BROWSER_CALL_NOT_CONNECTED",
        };
      }

      relayOperationMetaRef.current.set(operationId, nextMeta);
      const sendResult = await sendConferenceMessageDetailedRef.current(
        JSON.stringify(scenarioMessage as RecordingControlMessage),
        {
          enforcePocRelay: true,
          relayContextRole: String(contextRole),
          operationId,
          expectedConferenceName,
        },
      );
      const relayResult = projectRelayResult(
        {
          ...base,
          relayOwnerRole: "FACILITATOR",
          relayOwnerParticipantId: contextParticipantId,
          relayOwnerConnectionId: contextConnectionId,
          operationId,
          relayClaimedAt: relayOwnerRef.current?.claimedAt ?? now,
          relayConsumedAt: new Date().toISOString(),
        },
        sendResult,
      );
      relayOperationResultRef.current.set(operationId, relayResult);
      return relayResult;
    };

    const w = window as Window & {
      __voxPocRelayRecordingStart?: (
        input: unknown,
      ) => Promise<PocRelayRecordingStartResult>;
    };
    w.__voxPocRelayRecordingStart = relayRecordingStart;
    return () => {
      if (w.__voxPocRelayRecordingStart === relayRecordingStart) {
        delete w.__voxPocRelayRecordingStart;
      }
    };
  }, [projectRelayResult, props.sessionId]);

  /** Prevents duplicate stop calls from double-clicks or re-renders. */
  const stopInFlightRef = useRef(false);

  const relayVoximplantRecording = useCallback(
    async (action: "start" | "stop", consentGiven = false) => {
      if (staleConnectionRef.current) return;
      if (action === "start") {
        // Guard: skip duplicate start if DB/UI already shows recording active.
        const status = recordingState?.status;
        if (status === "STARTING" || status === "RECORDING") {
          console.log("[VoxRecording] start skipped — already", status);
          postRecordingDebug("relayVoximplantRecording:start:skipped", `start skipped — already ${status}`, { status });
          return;
        }

        // Conference must be connected to relay the start scenario message.
        if (!joined || !sendMessageAvailable) {
          setRecordingRelayError(
            "Запись не может быть запущена: конференция ещё не подключена.",
          );
          postRecordingDebug("relayVoximplantRecording:start:notReady", "start skipped — conference not ready", { joined, sendMessageAvailable }, "warn");
          return;
        }
      }

      if (action === "stop") {
        // Guard: prevent duplicate stop calls.
        if (stopInFlightRef.current) {
          console.log("[VoxRecording] stop skipped — stop already in flight");
          return;
        }
        stopInFlightRef.current = true;
      }

      setRecordingRelayError(null);

      if (action === "start") {
        console.log("[VoxRecording] relayVoximplantRecording — start called");
        postRecordingDebug("relayVoximplantRecording:start:called", "relayVoximplantRecording start called");
      } else {
        console.log("[VoxRecording] relayVoximplantRecording — stop called");
        postRecordingDebug("relayVoximplantRecording:stop:called", "relayVoximplantRecording stop called");
      }

      try {
        const body: Record<string, unknown> = {
          ...roomAuthBody(roomAuth, { connectionId: roomConnectionId ?? undefined }),
          action,
        };
        if (action === "start") {
          body.recordingConsentConfirmed = consentGiven;
        }

        postRecordingDebug(`recording-control:${action}:fetch`, `/recording-control ${action} fetch started`);

        const response = await fetch(
          `/api/sessions/${encodeURIComponent(props.sessionId)}/recording-control`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        const payload = (await response.json().catch(() => ({}))) as RecordingControlResponse;
        if (payload.code === "STALE_CONNECTION" || staleConnectionRef.current) {
          activateStaleConnection();
          return;
        }

        console.log(`[VoxRecording] /recording-control ${action} response — provider:`, payload.provider, "scenarioMessage.action:", payload.scenarioMessage?.action, "recording.status:", payload.recording?.status);

        if (!response.ok) {
          if (response.status === 409) {
            if (payload.code === "STALE_CONNECTION") {
              activateStaleConnection();
              return;
            }
            if (
              (payload.code === "ROOM_CLOSED" || payload.code === "EVENT_CLOSED") &&
              payload.redirectTo
            ) {
              window.location.replace(payload.redirectTo);
              return;
            }
          }
          postRecordingDebug(
            `recording-control:${action}:response:error`,
            `/recording-control ${action} failed: ${payload.error ?? response.status}`,
            { status: response.status },
            "error",
          );
          if (action === "start") {
            setRecordingRelayError(payload.error ?? "Не удалось запустить запись.");
          } else {
            console.warn("[VoxRecording] stop request failed:", payload.error);
          }
          return;
        }

        postRecordingDebug(
          `recording-control:${action}:response:ok`,
          `/recording-control ${action} ok — recordingStatus=${payload.recording?.status ?? "null"}`,
          {
            provider: payload.provider ?? null,
            recordingStatus: payload.recording?.status ?? null,
            scenarioMessageAction: payload.scenarioMessage?.action ?? null,
            webhookBaseUrl: payload.scenarioMessage?.webhookBaseUrl ?? null,
          },
          "success",
        );

        // Update optimistic recording state from server response.
        if (payload.recording) {
          setRecordingState(payload.recording);
        }

        // Relay the typed scenario message to the Voximplant conference.
        if (payload.scenarioMessage) {
          const relayed = sendConferenceMessage(JSON.stringify(payload.scenarioMessage));
          console.log(`[VoxRecording] sendConferenceMessage ${action}:`, relayed ? "success" : "failed — conference not ready");
          postRecordingDebug(
            `sendConferenceMessage:${action}`,
            `sendConferenceMessage ${action}: ${relayed ? "success" : "failed — conference not ready"}`,
            { relayed },
            relayed ? "success" : "error",
          );
          if (!relayed && action === "start") {
            setRecordingRelayError(
              "Команда записи отправлена, но не передана в конференцию. " +
                "Проверьте подключение SDK.",
            );
          }
        } else if (payload.provider === "voximplant") {
          if (action === "start") {
            setRecordingRelayError("Сервер не вернул сообщение для конференции.");
            postRecordingDebug("recording-control:start:noScenarioMessage", "Server returned no scenarioMessage", {}, "error");
          }
        }

        if (payload.warning && action === "start") {
          setRecordingRelayError(payload.warning);
          postRecordingDebug("recording-control:start:warning", payload.warning, {}, "warn");
        }
      } catch {
        postRecordingDebug(`relayVoximplantRecording:${action}:networkError`, `network error during ${action} relay`, {}, "error");
        if (action === "start") {
          setRecordingRelayError("Ошибка сети при отправке команды записи.");
        } else {
          console.warn("[VoxRecording] stop relay network error (non-critical).");
        }
      } finally {
        if (action === "stop") {
          stopInFlightRef.current = false;
        }
      }
    },
    [
      activateStaleConnection,
      joined,
      sendMessageAvailable,
      roomAuth,
      roomConnectionId,
      props.sessionId,
      recordingState,
      sendConferenceMessage,
      setRecordingState,
      postRecordingDebug,
    ],
  );

  const waitMs = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }, []);

  const attemptAuthorizedStopRelay = useCallback(
    async (reason: string) => {
      if (staleConnectionRef.current) return;
      const hint = recordingStopRelayHint;
      if (!hint || !roomConnectionId || !joined || !sendMessageAvailable) {
        return;
      }
      if (relayInFlightOperationsRef.current.has(hint.operationId)) {
        return;
      }

      relayInFlightOperationsRef.current.add(hint.operationId);
      try {
        // Reduce relay stampede when multiple tabs observe the same stop intent.
        await waitMs(150 + Math.floor(Math.random() * 500));

        const claimResponse = await fetch(
          `/api/sessions/${encodeURIComponent(props.sessionId)}/recording-control`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...roomAuthBody(roomAuth, { connectionId: roomConnectionId ?? undefined }),
              action: "relay_stop",
              stopOperationId: hint.operationId,
            }),
          },
        );

        const claimPayload = (await claimResponse.json().catch(() => ({}))) as RecordingControlResponse;
        if (claimPayload.code === "STALE_CONNECTION" || staleConnectionRef.current) {
          activateStaleConnection();
          return;
        }
        if (!claimResponse.ok || !claimPayload.stopRelay?.scenarioMessage) {
          return;
        }

        const relayed = sendConferenceMessage(
          JSON.stringify(claimPayload.stopRelay.scenarioMessage),
        );
        if (!relayed) {
          void fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/recording-control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...roomAuthBody(roomAuth, { connectionId: roomConnectionId ?? undefined }),
              action: "relay_stop_report",
              stopOperationId: claimPayload.stopRelay.operationId,
              relayOutcome: "SEND_FAILED",
            }),
          }).catch(() => undefined);
          return;
        }

        let acknowledged = false;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await waitMs(700);
          const status = recordingStateRef.current?.status ?? null;
          if (
            status === "STOPPED" ||
            status === "PROCESSING" ||
            status === "COMPLETED"
          ) {
            acknowledged = true;
            break;
          }
        }

        await fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/recording-control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...roomAuthBody(roomAuth, { connectionId: roomConnectionId ?? undefined }),
            action: "relay_stop_report",
            stopOperationId: claimPayload.stopRelay.operationId,
            relayOutcome: acknowledged ? "ACKNOWLEDGED" : "TIMEOUT",
          }),
        });

        postRecordingDebug(
          "relay-stop",
          `authorized relay ${acknowledged ? "acknowledged" : "timed out"}`,
          { reason, operationId: claimPayload.stopRelay.operationId, acknowledged },
          acknowledged ? "success" : "warn",
        );
      } catch {
        // Best-effort relay only.
      } finally {
        relayInFlightOperationsRef.current.delete(hint.operationId);
      }
    },
    [
      activateStaleConnection,
      joined,
      postRecordingDebug,
      props.sessionId,
      recordingStopRelayHint,
      roomAuth,
      roomConnectionId,
      sendConferenceMessage,
      sendMessageAvailable,
      waitMs,
    ],
  );

  useEffect(() => {
    if (!recordingStopRelayHint) return;
    if (!joined || !sendMessageAvailable) return;
    void attemptAuthorizedStopRelay("control-state");
  }, [
    attemptAuthorizedStopRelay,
    joined,
    recordingStopRelayHint,
    sendMessageAvailable,
  ]);

  useEffect(() => {
    if (!recordingStopRelayHint) return;
    if (!sessionCloseState.isClosed) return;
    if (!joined || !sendMessageAvailable) return;
    void attemptAuthorizedStopRelay("event-hard-close");
  }, [
    attemptAuthorizedStopRelay,
    joined,
    recordingStopRelayHint,
    sendMessageAvailable,
    sessionCloseState.isClosed,
  ]);

  // Callbacks wired to FacilitatorRoomControls negotiation lifecycle.
  const handleNegotiationStarted = useCallback(() => {
    console.log("[VoxRecording] onNegotiationStarted callback invoked");
    postRecordingDebug("handleNegotiationStarted:invoked", "handleNegotiationStarted invoked — triggering start");
    void relayVoximplantRecording("start", true);
  }, [relayVoximplantRecording, postRecordingDebug]);

  const handleNegotiationFinished = useCallback(() => {
    console.log("[VoxRecording] onNegotiationFinished callback invoked");
    postRecordingDebug(
      "handleNegotiationFinished:invoked",
      "handleNegotiationFinished invoked — waiting for authorized stop relay hint",
    );
    void attemptAuthorizedStopRelay("finish-callback");
  }, [attemptAuthorizedStopRelay, postRecordingDebug]);

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    if (explicitLeaveInFlightRef.current || !roomConnectionId) {
      return;
    }
    explicitLeaveInFlightRef.current = true;
    try {
      const shouldAttemptRelayBeforeLeave =
        Boolean(recordingStopRelayHint) &&
        (controlState?.negotiationState === "FINISHED" || sessionCloseState.isClosed);
      if (shouldAttemptRelayBeforeLeave) {
        await Promise.race([
          attemptAuthorizedStopRelay("explicit-leave"),
          waitMs(1800),
        ]);
      }

      await fetch(`/api/sessions/${props.sessionId}/presence/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          roomAuthBody(roomAuth, { connectionId: roomConnectionId ?? undefined }),
        ),
        keepalive: true,
      });
    } catch {
      // Best-effort explicit leave. Expiry sweep still guarantees eventual cleanup.
    }
    markSessionLeftFlag(props.sessionId);
    await leave();
    router.push(materialsUrl);
  }, [
    attemptAuthorizedStopRelay,
    controlState,
    leave,
    materialsUrl,
    props.sessionId,
    recordingStopRelayHint,
    roomAuth,
    roomConnectionId,
    router,
    sessionCloseState,
    waitMs,
  ]);

  useEffect(() => {
    clearSessionLeftFlag(props.sessionId);
  }, [props.sessionId]);

  const handleInvalidToken = useCallback(() => {
    clearRecoveryContext();
  }, []);
  const handleStaleConnection = useCallback(() => {
    activateStaleConnection();
  }, [activateStaleConnection]);
  const policyMutedBySystemRef = useRef(false);

  useEffect(() => {
    if (staleConnection && joined) {
      void leave();
    }
  }, [joined, leave, staleConnection]);

  useEffect(() => {
    if (!joined || staleConnection || !controlState || !effectiveParticipantType) {
      return;
    }
    const shouldMuteByPolicy = !controlState.micAllowed;
    if (shouldMuteByPolicy && !isMicMuted) {
      policyMutedBySystemRef.current = true;
      toggleMic();
      return;
    }
    if (!shouldMuteByPolicy && policyMutedBySystemRef.current && isMicMuted) {
      toggleMic();
      policyMutedBySystemRef.current = false;
      return;
    }
    if (!shouldMuteByPolicy && !isMicMuted) {
      policyMutedBySystemRef.current = false;
    }
  }, [
    controlState,
    effectiveParticipantType,
    isMicMuted,
    joined,
    staleConnection,
    toggleMic,
  ]);

  useEffect(() => {
    if (!joined || staleConnection) {
      return;
    }
    const payloadKey = JSON.stringify({
      micEnabled: !isMicMuted,
      cameraEnabled: isCameraOn,
      connectionId: roomConnectionId,
    });
    if (payloadKey === lastPublishedMediaStatusRef.current) {
      return;
    }
    lastPublishedMediaStatusRef.current = payloadKey;
    void (async () => {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(props.sessionId)}/media-status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...roomAuthBody(roomAuth, {
                connectionId: roomConnectionId ?? undefined,
              }),
              micEnabled: !isMicMuted,
              cameraEnabled: isCameraOn,
            }),
          },
        );
        if (await isStaleConnectionResponse(response)) {
          activateStaleConnection();
        } else {
          const redirectTarget =
            await getRoomClosureRedirectFromConflict(response);
          if (redirectTarget) {
            window.location.replace(redirectTarget);
          }
        }
      } catch {
        // Ignore transient network errors.
      }
    })();
  }, [
    activateStaleConnection,
    isCameraOn,
    isMicMuted,
    joined,
    props.sessionId,
    roomAuth,
    roomConnectionId,
    staleConnection,
  ]);

  // ── Loading / error states ─────────────────────────────────────────────────
  const isLoading = mediaLoading || businessLoading;
  const error = mediaError ?? businessError;

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-white">
        <p className="text-sm text-slate-300">
          {t("room.connectingToVideoRoom")}
        </p>
      </div>
    );
  }

  if (error || !sidebar || !controlState) {
    const friendlyError = t("room.unableToJoinRoom");
    const lobbyUrl = sidebar?.event?.lobbyUrl ?? null;
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 app-gradient-bg px-4 text-center">
        <div>
          <h1 className="text-lg font-bold text-slate-50">{t("room.unableToJoinVideoRoom")}</h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            {friendlyError}
          </p>
          {error ? (
            <p className="mt-2 max-w-md text-xs text-slate-500" data-testid="room-entry-error-details">
              {error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="rounded-lg border border-slate-500/40 bg-slate-900/40 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800/40"
          onClick={() => window.location.reload()}
          data-testid="retry-room-entry-button"
        >
          {t("common.retry")}
        </button>
        {lobbyUrl ? (
          <GradientButtonLink href={lobbyUrl} data-testid="return-to-event-lobby-button">
            {t("room.returnToEventLobby")}
          </GradientButtonLink>
        ) : null}
        <GradientButtonLink href={materialsUrl}>
          {t("room.backToSessionMaterials")}
        </GradientButtonLink>
        <GradientButtonLink href="/rejoin">{t("rejoin.rejoin")}</GradientButtonLink>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-slate-950"
      data-testid="session-room-page"
    >
      <SharedRoomShell
        sessionId={props.sessionId}
        roomAuth={roomAuth}
        materialsUrl={materialsUrl}
        sidebar={sidebar}
        controlState={controlState}
        recordingState={recordingState}
        recordingStopOperationState={recordingStopRelayHint?.operationState ?? null}
        sessionCloseState={sessionCloseState}
        participantType={effectiveParticipantType ?? "OBSERVER"}
        participantTypeLabel={participantTypeLabel}
        displayName={effectiveDisplayName}
        onControlStateChange={setControlState}
        onRecordingStateChange={setRecordingState}
        connectionId={roomConnectionId ?? undefined}
        staleConnection={staleConnection}
        onNegotiationStarted={
          effectiveParticipantType === "FACILITATOR"
            ? handleNegotiationStarted
            : undefined
        }
        onNegotiationFinished={
          effectiveParticipantType === "FACILITATOR"
            ? handleNegotiationFinished
            : undefined
        }
        onInvalidToken={handleInvalidToken}
        onStaleConnection={handleStaleConnection}
        onLeave={() => void handleLeave()}
        // ── Voximplant-specific slots ────────────────────────────────────────
        audioRenderer={null}
        micEnforcement={null}
        speakingTracker={
          localMicTelemetryEnabled ? (
            <VoximplantSpeakingActivityTracker
              sessionId={props.sessionId}
              roomAuth={roomAuth}
              sessionParticipantId={trackerSessionParticipantId}
              participantIdentity={sidebar.displayName ?? localDisplayName ?? null}
              localAudioStreamPresent={localAudioStreamCreated}
              micLevel={micLevel}
              muted={isMicMuted || !controlState.micAllowed}
              enabled={joined && !staleConnection}
              connectionId={roomConnectionId ?? undefined}
              audioProcessingEnabled={audioProcessingEnabled}
              recordingStatus={recordingState?.status ?? null}
              debug={
                (props.debugAudio === true ||
                  process.env.NEXT_PUBLIC_VOX_SPEAKING_TRACKER_DEBUG === "true") &&
                (effectiveParticipantType === "FACILITATOR" || effectiveParticipantType === "OBSERVER")
              }
            />
          ) : null
        }
        providerBanner={null}
        recordingControls={
          recordingRelayError && effectiveParticipantType === "FACILITATOR" ? (
            <p
              className="text-xs text-rose-400"
              data-testid="vox-recording-relay-error"
            >
              {recordingRelayError}
            </p>
          ) : null
        }
        mediaArea={
          <VoximplantVideoLayout
            localParticipant={localParticipant}
            remoteParticipants={remoteParticipants}
            roster={sidebar.roster}
            currentParticipantId={sidebar.currentParticipantId}
            controlState={{
              ...controlState,
              participantType: effectiveParticipantType ?? "OBSERVER",
            }}
            isCameraOn={isCameraOn}
            isMicMuted={isMicMuted}
            localMicSystemMuted={!controlState.micAllowed}
            micLevel={micLevel}
            sessionId={props.sessionId}
            roomAuth={roomAuth}
            connectionId={roomConnectionId ?? undefined}
            remoteTelemetryDebugEnabled={remoteTelemetryDebugEnabled}
            remoteTelemetryCaptureEnabled={remoteTelemetryCaptureEnabled}
            canReportRemoteTelemetry={effectiveParticipantType === "FACILITATOR"}
            joined={joined}
            staleConnection={staleConnection}
            recordingStatus={recordingState?.status ?? null}
            audioProcessingEnabled={audioProcessingEnabled}
          />
        }
        controlBar={
          <VoximplantControlBar
            joined={joined}
            micCaptureStatus={micCaptureStatus}
            micAllowed={controlState.micAllowed}
            isCameraOn={isCameraOn}
            cameraUnavailable={cameraUnavailable}
            toggleMic={toggleMic}
            toggleCamera={toggleCamera}
            disabled={staleConnection}
          />
        }
        leaveButton={
          <VoximplantLeaveButton
            isLeaving={isLeaving}
            onLeave={() => void handleLeave()}
          />
        }
        mediaWarnings={mediaWarnings}
        autoplayUnlockBanner={
          remotePlaybackBlocked ? (
            <div className="shrink-0 flex items-center justify-between border-t border-blue-700/40 bg-blue-950/30 px-4 py-2">
              <p className="text-xs text-blue-300">
                {t("room.autoplayBlocked")}
              </p>
              <button
                type="button"
                onClick={unlockAudioPlayback}
                className="ml-4 shrink-0 rounded-md border border-blue-500/50 bg-blue-900/30 px-3 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-900/50"
              >
                {t("room.allowAudio")}
              </button>
            </div>
          ) : null
        }
        debugPanel={null}
      />
    </div>
  );
}
