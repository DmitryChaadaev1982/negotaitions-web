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
import { RecordingDebugPanel } from "@/components/recording-debug-panel";
import { SharedRoomShell } from "@/components/shared-room-shell";
import VoximplantVideoLayout from "@/components/voximplant-video-layout";
import { buildSessionMaterialsPath } from "@/lib/config";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
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

// ─── Audio diagnostics panel ──────────────────────────────────────────────────
// Hidden by default. Visible only when ?debugAudio=1 or an audio error surfaces.
// The technical conference name and raw transport role are shown here only —
// not in the main UI header.

function AudioDiagnosticsPanel({
  joined,
  status,
  conferenceName,
  transportRole,
  micCaptureStatus,
  localAudioStreamCreated,
  localAudioStreamAddedToConference,
  isMicMuted,
  micLevel,
  remoteStreamCount,
  remoteAudioElementCount,
  remotePlaybackBlocked,
  lastAudioError,
  lastRemoteAudioError,
}: {
  joined: boolean;
  status: string;
  conferenceName: string;
  transportRole: string;
  micCaptureStatus: string;
  localAudioStreamCreated: boolean;
  localAudioStreamAddedToConference: boolean;
  isMicMuted: boolean;
  micLevel: number;
  remoteStreamCount: number;
  remoteAudioElementCount: number;
  remotePlaybackBlocked: boolean;
  lastAudioError: string | null;
  lastRemoteAudioError: string | null;
}) {
  const [open, setOpen] = useState(true);

  const row = (label: string, value: string | boolean | number) => (
    <div key={label} className="flex justify-between gap-4 py-0.5">
      <span className="text-slate-400">{label}</span>
      <span
        className={`font-mono text-xs ${
          value === true || value === "active"
            ? "text-green-400"
            : value === false || value === "unavailable" || value === "error"
              ? "text-red-400"
              : "text-slate-200"
        }`}
      >
        {typeof value === "boolean" ? (value ? "да" : "нет") : String(value)}
      </span>
    </div>
  );

  return (
    <div className="shrink-0 border-t border-slate-700 bg-slate-900/80 text-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2 text-slate-400 hover:text-slate-200"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold text-slate-300">Диагностика аудио</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-x-8 px-4 pb-3 sm:grid-cols-2">
          {row("SDK подключён", joined)}
          {conferenceName ? row("Конференция (техн.)", conferenceName) : null}
          {row("Роль (транспорт)", transportRole)}
          {row("Статус", status)}
          {row("micCaptureStatus", micCaptureStatus)}
          {row("localAudioStreamCreated", localAudioStreamCreated)}
          {row("localAudioStreamAddedToConf", localAudioStreamAddedToConference)}
          {row("isMicMuted", isMicMuted)}
          {row("micLevel", micLevel)}
          {row("remoteStreamCount", remoteStreamCount)}
          {row("remoteAudioElements", remoteAudioElementCount)}
          {row("autoplay блокирован", remotePlaybackBlocked)}
          {lastAudioError ? row("lastAudioError", lastAudioError) : null}
          {lastRemoteAudioError ? row("lastRemoteAudioError", lastRemoteAudioError) : null}
        </div>
      )}
    </div>
  );
}

// ─── VoximplantControlBar ─────────────────────────────────────────────────────
// Provider-specific control bar that mirrors the shape of RestrictedControlBar.

function VoximplantControlBar({
  joined,
  disabled,
  micCaptureStatus,
  isCameraOn,
  toggleMic,
  toggleCamera,
}: {
  joined: boolean;
  disabled?: boolean;
  micCaptureStatus: string;
  isCameraOn: boolean;
  toggleMic: () => void;
  toggleCamera: () => void;
}) {
  const { t } = useI18n();
  const micLabel =
    micCaptureStatus === "active" ? t("room.microphone") + " (вкл)" : t("room.microphone") + " (выкл)";

  return (
    <div className="lk-control-bar">
      <button
        type="button"
        onClick={toggleMic}
        className={`lk-button ${
          micCaptureStatus === "active"
            ? ""
            : micCaptureStatus === "unavailable" || micCaptureStatus === "error"
              ? "text-red-400"
              : "text-amber-400"
        }`}
        disabled={!joined || disabled}
        title={
          micCaptureStatus === "unavailable"
            ? "Микрофон недоступен — нажмите для повторной попытки"
            : undefined
        }
        data-testid="vox-mic-toggle"
      >
        {micLabel}
      </button>
      <button
        type="button"
        onClick={toggleCamera}
        className={`lk-button ${isCameraOn ? "" : "text-amber-400"}`}
        disabled={!joined || disabled}
        data-testid="vox-camera-toggle"
      >
        {isCameraOn ? t("room.camera") + " (вкл)" : t("room.camera") + " (выкл)"}
      </button>
    </div>
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
      {isLeaving ? "Выход..." : t("room.leaveRoom")}
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
    status,
    error: mediaError,
    role: transportRole,
    localDisplayName,
    conferenceName,
    participantType: hookParticipantType,
    localParticipant,
    remoteParticipants,
    isMicMuted,
    isCameraOn,
    mediaWarnings,
    toggleMic,
    toggleCamera,
    leave,
    // Audio diagnostics
    micCaptureStatus,
    localAudioStreamCreated,
    localAudioStreamAddedToConference,
    lastAudioError,
    micLevel,
    remoteStreamCount,
    remoteAudioElementCount,
    remotePlaybackBlocked,
    lastRemoteAudioError,
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
    sidebar?.participantType ?? hookParticipantType ?? null;

  const participantTypeLabel = effectiveParticipantType
    ? t(
        `participantType.${effectiveParticipantType}` as `participantType.${typeof effectiveParticipantType}`,
      )
    : "Участник";

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

  /**
   * True once the facilitator has initiated a recording start in this browser
   * session. Used by the stop guard instead of recordingState, because:
   *   - buildVoximplantRecordingDispatch does NOT write a DB recording row.
   *   - The 1-second polling loop reads the DB and overwrites recordingState
   *     with null/NOT_STARTED until VoxEngine's webhook fires.
   *   - Relying on recordingState for the stop guard would suppress the only
   *     stop call in the window between start relay and webhook arrival.
   */
  const recordingStartRequestedRef = useRef(false);
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
        // Guard: skip stop when no start was ever attempted in this browser session.
        // Do NOT use recordingState here — the DB recording row may not exist yet
        // (VoxEngine webhook fires seconds after the start relay), so the polling
        // loop would have overwritten recordingState with null/NOT_STARTED, causing
        // a stale guard to suppress the only stop call.
        if (!recordingStartRequestedRef.current) {
          console.log("[VoxRecording] stop skipped — no start was attempted this session");
          postRecordingDebug("relayVoximplantRecording:stop:skipped", "stop skipped — no start attempted this session", {}, "warn");
          return;
        }
        // Guard: prevent duplicate stop calls.
        if (stopInFlightRef.current) {
          console.log("[VoxRecording] stop skipped — stop already in flight");
          return;
        }
        stopInFlightRef.current = true;
      }

      setRecordingRelayError(null);

      // Mark start as requested before the async call so the stop guard passes
      // even if FINISH arrives before the start API response.
      if (action === "start") {
        recordingStartRequestedRef.current = true;
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

  // ── Diagnostics ───────────────────────────────────────────────────────────
  const showDiagnostics =
    props.debugAudio === true || !!lastAudioError || !!lastRemoteAudioError;

  const isFacilitator = effectiveParticipantType === "FACILITATOR";
  const showRecordingDebugPanel =
    isFacilitator &&
    showRecordingDebug;

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    await leave();
    router.push(materialsUrl);
  }, [leave, materialsUrl, router]);

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
    if (
      !shouldMuteByPolicy &&
      policyMutedBySystemRef.current &&
      isMicMuted &&
      effectiveParticipantType === "PARTICIPANT"
    ) {
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
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 app-gradient-bg px-4 text-center">
        <div>
          <h1 className="text-lg font-bold text-slate-50">{t("room.unableToJoinVideoRoom")}</h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            {error ?? t("room.somethingWentWrongConnecting")}
          </p>
        </div>
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
        participantType={effectiveParticipantType ?? "PARTICIPANT"}
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
        speakingTracker={null}
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
            controlState={{
              ...controlState,
              participantType: effectiveParticipantType ?? "PARTICIPANT",
            }}
            localParticipantType={effectiveParticipantType ?? "PARTICIPANT"}
            localCaseRoleName={sidebar.caseRole?.name ?? null}
            isCameraOn={isCameraOn}
            isMicMuted={isMicMuted}
            micLevel={micLevel}
            localRoleLabel={participantTypeLabel}
          />
        }
        controlBar={
          <VoximplantControlBar
            joined={joined}
            micCaptureStatus={micCaptureStatus}
            isCameraOn={isCameraOn}
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
                Браузер заблокировал звук — нажмите «Разрешить звук» для воспроизведения.
              </p>
              <button
                type="button"
                onClick={unlockAudioPlayback}
                className="ml-4 shrink-0 rounded-md border border-blue-500/50 bg-blue-900/30 px-3 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-900/50"
              >
                Разрешить звук
              </button>
            </div>
          ) : null
        }
        debugPanel={
          showDiagnostics || showRecordingDebugPanel ? (
            <>
              {showDiagnostics && (
                <AudioDiagnosticsPanel
                  joined={joined}
                  status={status}
                  conferenceName={conferenceName}
                  transportRole={transportRole}
                  micCaptureStatus={micCaptureStatus}
                  localAudioStreamCreated={localAudioStreamCreated}
                  localAudioStreamAddedToConference={localAudioStreamAddedToConference}
                  isMicMuted={isMicMuted}
                  micLevel={micLevel}
                  remoteStreamCount={remoteStreamCount}
                  remoteAudioElementCount={remoteAudioElementCount}
                  remotePlaybackBlocked={remotePlaybackBlocked}
                  lastAudioError={lastAudioError}
                  lastRemoteAudioError={lastRemoteAudioError}
                />
              )}
              <RecordingDebugPanel
                sessionId={props.sessionId}
                participantId={
                  props.authMode === "account" ? props.participantId : undefined
                }
                visible={showRecordingDebugPanel}
              />
            </>
          ) : null
        }
      />
    </div>
  );
}
