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
import { RecordingConsentModal } from "@/components/recording-consent-modal";
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
import { useCallback, useEffect, useMemo, useState } from "react";

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
    }
  | {
      sessionId: string;
      authMode: "account";
      participantId: string;
      joinToken?: never;
      disableInitialCamera?: boolean;
      disableInitialMic?: boolean;
      debugAudio?: boolean;
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
  micCaptureStatus,
  isCameraOn,
  toggleMic,
  toggleCamera,
}: {
  joined: boolean;
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
        disabled={!joined}
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
        disabled={!joined}
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

// ─── VoximplantRecordingControls ─────────────────────────────────────────────
//
// Stage 5.4: Recording start/stop control for facilitators.
//
// Flow:
//  1. Facilitator clicks Start/Stop.
//  2. Browser calls POST recording-control → receives { scenarioMessage }.
//  3. Browser relays scenarioMessage via sendConferenceMessage().
//  4. VoxEngine scenario records audio and later sends a status webhook.
//  5. Webhook creates/updates Recording row; polling picks it up.
//
// Security: no secrets returned; relay failures show a safe UI error only.
// Do not mark recording as completed client-side.

type RecordingControlResponse = {
  ok: boolean;
  provider?: string;
  scenarioMessage?: RecordingControlMessage;
  recording?: { status: string; errorMessage: string | null } | null;
  warning?: string;
  error?: string;
  fileKeyHandoff?: "webhook";
  fileKeyHandoffDeferred?: boolean;
};

function VoximplantRecordingControls({
  sessionId,
  roomAuth,
  joined,
  sendConferenceMessage,
  sendMessageAvailable,
  recordingStatus,
  onRecordingStateChange,
}: {
  sessionId: string;
  roomAuth: RoomAuthToken;
  joined: boolean;
  sendConferenceMessage: (text: string) => boolean;
  sendMessageAvailable: boolean;
  recordingStatus: string | null | undefined;
  onRecordingStateChange: (state: RoomRecordingState) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [showRecordingConsent, setShowRecordingConsent] = useState(false);

  const isActiveRecording =
    recordingStatus === "RECORDING" || recordingStatus === "STARTING";
  const isStoppingRecording = recordingStatus === "STOPPING" || recordingStatus === "STOPPED";
  const canStart = joined && sendMessageAvailable && !isSubmitting && !isActiveRecording && !isStoppingRecording;
  const canStop = joined && sendMessageAvailable && !isSubmitting && (isActiveRecording || recordingStatus === "STOPPING");

  const runRecordingAction = useCallback(
    async (action: "start" | "stop", recordingConsentConfirmed = false) => {
      setIsSubmitting(true);
      setRelayError(null);

      try {
        const body: Record<string, unknown> = {
          ...roomAuthBody(roomAuth),
          action,
        };
        if (action === "start") {
          body.recordingConsentConfirmed = recordingConsentConfirmed;
        }

        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/recording-control`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        const payload = (await response.json().catch(() => ({}))) as RecordingControlResponse;

        if (!response.ok) {
          setRelayError(payload.error ?? "Recording control request failed.");
          return;
        }

        // Update optimistic recording state from server response.
        if (payload.recording) {
          onRecordingStateChange(payload.recording);
        }

        // Relay the typed scenario message to the Voximplant conference.
        if (payload.scenarioMessage) {
          const relayed = sendConferenceMessage(JSON.stringify(payload.scenarioMessage));
          if (!relayed) {
            setRelayError(
              "Recording command sent to server but could not be relayed to the conference. " +
              "Ensure the conference is connected and the SDK version supports messaging.",
            );
          }
        } else if (payload.provider === "voximplant") {
          // scenarioMessage absent — server returned a dispatch but no message.
          setRelayError("Server returned no scenario message to relay.");
        }

        if (payload.warning) {
          setRelayError(payload.warning);
        }
      } catch {
        setRelayError("Network error when sending recording command.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [roomAuth, sessionId, sendConferenceMessage, onRecordingStateChange],
  );

  const handleStartRecordingClick = useCallback(() => {
    setShowRecordingConsent(true);
  }, []);

  const handleRecordingConsentConfirm = useCallback(() => {
    setShowRecordingConsent(false);
    void runRecordingAction("start", true);
  }, [runRecordingAction]);

  const handleRecordingConsentCancel = useCallback(() => {
    setShowRecordingConsent(false);
  }, []);

  if (!joined) return null;

  const buttonClass =
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <>
      {showRecordingConsent ? (
        <RecordingConsentModal
          onConfirm={handleRecordingConsentConfirm}
          onCancel={handleRecordingConsentCancel}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
      {!sendMessageAvailable ? (
        <p className="text-xs text-amber-400">
          Запись недоступна: SDK не поддерживает отправку сообщений в конференцию.
        </p>
      ) : (
        <>
          {!isActiveRecording && !isStoppingRecording ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={handleStartRecordingClick}
              className={`${buttonClass} bg-rose-700 text-white hover:bg-rose-600`}
              data-testid="vox-start-recording"
            >
              {isSubmitting && !isActiveRecording ? "Запуск..." : "Начать запись"}
            </button>
          ) : null}
          {isActiveRecording || isStoppingRecording ? (
            <button
              type="button"
              disabled={!canStop}
              onClick={() => void runRecordingAction("stop")}
              className={`${buttonClass} border border-slate-600 text-white hover:bg-slate-800`}
              data-testid="vox-stop-recording"
            >
              {isSubmitting ? "Остановка..." : "Остановить запись"}
            </button>
          ) : null}
        </>
      )}
      {relayError ? (
        <p className="w-full text-xs text-rose-400" data-testid="vox-recording-relay-error">
          {relayError}
        </p>
      ) : null}
      </div>
    </>
  );
}

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

  // Initial load of sidebar + control state
  useEffect(() => {
    let cancelled = false;

    const loadBusiness = async () => {
      setBusinessLoading(true);
      setBusinessError(null);

      try {
        const [sidebarResult, controlResult] = await Promise.all([
          fetch(`/api/livekit/sidebar?${roomAuthQuery(roomAuth)}`, {
            cache: "no-store",
          }),
          fetch(
            `/api/sessions/${props.sessionId}/control-state?${roomAuthQuery(roomAuth)}`,
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
  }, [roomAuth, props.sessionId, t]);

  // Polling (mirrors VideoRoomPage — 1-second interval)
  useEffect(() => {
    if (businessLoading || businessError) return;

    const intervalId = window.setInterval(async () => {
      touchRecoveryContext();

      try {
        const [controlResponse, sidebarResponse] = await Promise.all([
          fetch(
            `/api/sessions/${props.sessionId}/control-state?${roomAuthQuery(roomAuth)}`,
            { cache: "no-store" },
          ),
          fetch(`/api/livekit/sidebar?${roomAuthQuery(roomAuth)}`, {
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
        }

        if (sidebarResponse.ok) {
          const nextSidebar = (await sidebarResponse.json()) as RoomSidebarData;
          setSidebar(nextSidebar);
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [businessLoading, businessError, roomAuth, props.sessionId]);

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

  // ── Diagnostics ───────────────────────────────────────────────────────────
  const showDiagnostics =
    props.debugAudio === true || !!lastAudioError || !!lastRemoteAudioError;

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    await leave();
    router.push(materialsUrl);
  }, [leave, materialsUrl, router]);

  const handleInvalidToken = useCallback(() => {
    clearRecoveryContext();
  }, []);

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
        onInvalidToken={handleInvalidToken}
        onLeave={() => void handleLeave()}
        // ── Voximplant-specific slots ────────────────────────────────────────
        audioRenderer={null}
        micEnforcement={null}
        speakingTracker={null}
        providerBanner={null}
        recordingControls={
          effectiveParticipantType === "FACILITATOR" ? (
            <VoximplantRecordingControls
              sessionId={props.sessionId}
              roomAuth={roomAuth}
              joined={joined}
              sendConferenceMessage={sendConferenceMessage}
              sendMessageAvailable={sendMessageAvailable}
              recordingStatus={recordingState?.status}
              onRecordingStateChange={setRecordingState}
            />
          ) : null
        }
        mediaArea={
          <VoximplantVideoLayout
            localParticipant={localParticipant}
            remoteParticipants={remoteParticipants}
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
          showDiagnostics ? (
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
          ) : null
        }
      />
    </div>
  );
}
