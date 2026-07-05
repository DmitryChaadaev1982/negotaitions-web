"use client";

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
import type { ParticipantType } from "@/app/generated/prisma/enums";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

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
  recording?: { status: string; errorMessage: string | null } | null;
  warning?: string;
  error?: string;
  code?: string;
  fileKeyHandoff?: "webhook";
  fileKeyHandoffDeferred?: boolean;
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

  const roomConnectionSeed = useId();
  const roomConnectionId = useMemo(
    () => `room-${props.sessionId}-${roomConnectionSeed.replace(/:/g, "")}`,
    [props.sessionId, roomConnectionSeed],
  );

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
    sendMessageAvailable,
  } = useVoximplantRoom({
    sessionId: props.sessionId,
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
  const [sessionCloseState, setSessionCloseState] = useState<ShellSessionCloseState>({
    isClosed: false,
    closeMessageKey: null,
    closedBeforeNegotiation: false,
  });
  const [staleConnection, setStaleConnection] = useState(false);

  // Initial load of sidebar + control state
  useEffect(() => {
    let cancelled = false;

    const loadBusiness = async () => {
      setBusinessLoading(true);
      setBusinessError(null);

      try {
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

        type ControlPayload = ControlState &
          ShellSessionCloseState & {
            recording?: RoomRecordingState;
            closeMessageKey?: ShellSessionCloseState["closeMessageKey"];
          };

        const sidebarPayload = (await sidebarResult.json().catch(() => ({}))) as
          | RoomSidebarData
          | { error?: string };
        const controlPayload = (await controlResult.json().catch(() => ({}))) as
          | ControlPayload
          | { error?: string };

        if (!sidebarResult.ok) {
          if (sidebarResult.status === 409) {
            setStaleConnection(true);
            return;
          }
          throw new Error(
            "error" in sidebarPayload && sidebarPayload.error
              ? sidebarPayload.error
              : t("room.unableToLoadSessionPanel"),
          );
        }
        if (!controlResult.ok) {
          if (controlResult.status === 409) {
            setStaleConnection(true);
            return;
          }
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
  }, [roomAuth, props.sessionId, roomConnectionId, t]);

  // Polling (mirrors VideoRoomPage — 1-second interval)
  useEffect(() => {
    if (businessLoading || businessError) return;

    const intervalId = window.setInterval(async () => {
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

        if (controlResponse.ok) {
          type ControlPayload = ControlState &
            ShellSessionCloseState & {
              recording?: RoomRecordingState;
              closeMessageKey?: ShellSessionCloseState["closeMessageKey"];
            };
          const nextState = (await controlResponse.json()) as ControlPayload;
          setControlState(nextState);
          setRecordingState(nextState.recording ?? null);
          setSessionCloseState({
            isClosed: nextState.isClosed,
            closeMessageKey: nextState.closeMessageKey ?? null,
            closedBeforeNegotiation: nextState.closedBeforeNegotiation,
          });
        } else if (controlResponse.status === 409) {
          setStaleConnection(true);
        }

        if (sidebarResponse.ok) {
          const nextSidebar = (await sidebarResponse.json()) as RoomSidebarData;
          setSidebar(nextSidebar);
        } else if (sidebarResponse.status === 409) {
          setStaleConnection(true);
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [businessLoading, businessError, roomAuth, props.sessionId, roomConnectionId]);

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

  // ── Automatic Voximplant recording relay ──────────────────────────────────
  // Recording is tied to negotiation lifecycle: start → start recording,
  // finish → stop recording. No separate UI button is shown.
  // The browser relays a typed scenarioMessage to VoxEngine; the scenario
  // handles actual recording and later sends a status webhook.

  const [recordingRelayError, setRecordingRelayError] = useState<string | null>(null);

  // ── Recording diagnostics (dev-only) ──────────────────────────────────────
  // postRecordingDebug: fire-and-forget POST to diagnostics API.
  // Never blocks user flow — errors are silently ignored.
  const showRecordingDebug =
    props.debugRecording === true ||
    process.env.NEXT_PUBLIC_RECORDING_DEBUG_PANEL === "true";

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

  /** Prevents duplicate stop calls from double-clicks or re-renders. */
  const stopInFlightRef = useRef(false);

  const relayVoximplantRecording = useCallback(
    async (action: "start" | "stop", consentGiven = false) => {
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

        console.log(`[VoxRecording] /recording-control ${action} response — provider:`, payload.provider, "scenarioMessage.action:", payload.scenarioMessage?.action, "recording.status:", payload.recording?.status);

        if (!response.ok) {
          if (response.status === 409 && payload.code === "STALE_CONNECTION") {
            setStaleConnection(true);
            return;
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

  // Callbacks wired to FacilitatorRoomControls negotiation lifecycle.
  const handleNegotiationStarted = useCallback(() => {
    console.log("[VoxRecording] onNegotiationStarted callback invoked");
    postRecordingDebug("handleNegotiationStarted:invoked", "handleNegotiationStarted invoked — triggering start");
    void relayVoximplantRecording("start", true);
  }, [relayVoximplantRecording, postRecordingDebug]);

  const handleNegotiationFinished = useCallback(() => {
    console.log("[VoxRecording] onNegotiationFinished callback invoked");
    postRecordingDebug("handleNegotiationFinished:invoked", "handleNegotiationFinished invoked — triggering stop");
    void relayVoximplantRecording("stop");
  }, [relayVoximplantRecording, postRecordingDebug]);

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    markSessionLeftFlag(props.sessionId);
    await leave();
    router.push(materialsUrl);
  }, [leave, materialsUrl, props.sessionId, router]);

  useEffect(() => {
    clearSessionLeftFlag(props.sessionId);
  }, [props.sessionId]);

  const handleInvalidToken = useCallback(() => {
    clearRecoveryContext();
  }, []);
  const handleStaleConnection = useCallback(() => {
    setStaleConnection(true);
  }, []);
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
          <VoximplantSpeakingActivityTracker
            sessionId={props.sessionId}
            roomAuth={roomAuth}
            sessionParticipantId={sidebar.currentParticipantId}
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
            localParticipantType={effectiveParticipantType ?? "OBSERVER"}
            localCaseRoleName={sidebar.caseRole?.name ?? null}
            isCameraOn={isCameraOn}
            isMicMuted={isMicMuted}
            localMicSystemMuted={!controlState.micAllowed}
            micLevel={micLevel}
            localRoleLabel={participantTypeLabel}
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
