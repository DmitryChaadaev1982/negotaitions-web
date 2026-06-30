"use client";

import "@livekit/components-styles";
import "@/styles/livekit-overrides.css";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import { LiveKitReconnectBanner } from "@/components/livekit-reconnect-banner";
import { MicEnforcement } from "@/components/mic-enforcement";
import { RestrictedControlBar } from "@/components/restricted-control-bar";
import { SharedRoomShell } from "@/components/shared-room-shell";
import { SpeakingActivityTracker } from "@/components/speaking-activity-tracker";
import { StructuredVideoLayout } from "@/components/structured-video-layout";
import type { RoomRecordingState, ShellSessionCloseState } from "@/lib/room-provider/types";
import type { ControlState } from "@/lib/negotiation-control";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import type { RoomAuthToken } from "@/lib/room-auth";
import { GradientButtonLink } from "@/components/ui/buttons";
import { buildSessionMaterialsPath } from "@/lib/config";
import { roomAuthBody, roomAuthQuery } from "@/lib/room-auth";
import {
  clearRecoveryContext,
  saveRecoveryContext,
  touchRecoveryContext,
} from "@/lib/rejoin/recovery-storage";
import { useI18n } from "@/lib/i18n/useI18n";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type LiveKitTokenResponse = {
  token: string;
  serverUrl: string;
  sessionId: string;
  participantId: string;
  participantType: RoomSidebarData["participantType"];
  displayName: string;
};

type RoomControlPayload = ControlState &
  ShellSessionCloseState & {
    recording?: RoomRecordingState;
    recordingWarning?: string;
    closeMessageKey?:
      | "events.sessionClosedByEvent"
      | "events.sessionClosedBeforeNegotiation"
      | "join.sessionFinishedMessage"
      | null;
  };

/**
 * Guest mode: joinToken in URL/props (existing flow, no account login required).
 * Account mode: participantId (non-secret DB UUID) identifies the participant;
 *   all API calls use cookie-based auth. joinToken is never in HTML/props.
 */
type VideoRoomPageProps =
  | { sessionId: string; authMode?: "guest"; joinToken: string; participantId?: never }
  | { sessionId: string; authMode: "account"; participantId: string; joinToken?: never };

// ─── LeaveRoomButton ─────────────────────────────────────────────────────────
// Must stay inside <LiveKitRoom> context (uses useRoomContext).

function LeaveRoomButton({ materialsUrl }: { materialsUrl: string }) {
  const router = useRouter();
  const room = useRoomContext();
  const { t } = useI18n();

  const handleLeave = useCallback(() => {
    router.push(materialsUrl);
    void room.disconnect();
  }, [materialsUrl, room, router]);

  return (
    <button
      type="button"
      onClick={() => void handleLeave()}
      className="btn-secondary inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold transition-all hover:brightness-110"
    >
      {t("room.leaveRoom")}
    </button>
  );
}

// ─── ConnectedRoom ────────────────────────────────────────────────────────────
// Rendered inside <LiveKitRoom>; passes LiveKit-specific slots to SharedRoomShell.

function ConnectedRoom({
  roomAuth,
  materialsUrl,
  sessionId,
  tokenResponse,
  sidebar,
  controlState,
  recordingState,
  sessionCloseState,
  onControlStateChange,
  onRecordingStateChange,
  onInvalidToken,
}: {
  roomAuth: RoomAuthToken;
  materialsUrl: string;
  sessionId: string;
  tokenResponse: LiveKitTokenResponse;
  sidebar: RoomSidebarData;
  controlState: ControlState;
  recordingState: RoomRecordingState;
  sessionCloseState: ShellSessionCloseState;
  onControlStateChange: (state: ControlState) => void;
  onRecordingStateChange: (state: RoomRecordingState) => void;
  onInvalidToken: () => void;
}) {
  const router = useRouter();

  const handleLeave = useCallback(() => {
    router.push(materialsUrl);
  }, [materialsUrl, router]);

  const handleManualRejoin = useCallback(() => {
    router.push("/rejoin");
  }, [router]);

  const participantTypeLabel = useI18n().t(
    `participantType.${tokenResponse.participantType}` as `participantType.${typeof tokenResponse.participantType}`,
  );

  return (
    <LiveKitRoom
      token={tokenResponse.token}
      serverUrl={tokenResponse.serverUrl}
      connect
      audio
      video
      data-lk-theme="default"
      className="flex h-dvh flex-col overflow-hidden bg-slate-950"
      data-testid="session-room-page"
    >
      <SharedRoomShell
        sessionId={sessionId}
        roomAuth={roomAuth}
        materialsUrl={materialsUrl}
        sidebar={sidebar}
        controlState={controlState}
        recordingState={recordingState}
        sessionCloseState={sessionCloseState}
        participantType={tokenResponse.participantType}
        participantTypeLabel={participantTypeLabel}
        displayName={tokenResponse.displayName}
        onControlStateChange={onControlStateChange}
        onRecordingStateChange={onRecordingStateChange}
        onInvalidToken={onInvalidToken}
        onLeave={handleLeave}
        // LiveKit-specific slots
        audioRenderer={<RoomAudioRenderer />}
        micEnforcement={<MicEnforcement controlState={controlState} />}
        speakingTracker={
          <SpeakingActivityTracker
            sessionId={sessionId}
            roomAuth={roomAuth}
            negotiationStartedAt={null}
          />
        }
        providerBanner={<LiveKitReconnectBanner onManualRejoin={handleManualRejoin} />}
        mediaArea={
          <StructuredVideoLayout
            roster={sidebar.roster}
            controlState={controlState}
            participantType={tokenResponse.participantType}
          />
        }
        controlBar={
          <RestrictedControlBar
            micAllowed={controlState.micAllowed}
            onLeave={handleLeave}
          />
        }
        leaveButton={<LeaveRoomButton materialsUrl={materialsUrl} />}
        // LiveKit has no media warnings via this channel (managed by LiveKit components)
        mediaWarnings={[]}
        autoplayUnlockBanner={null}
        debugPanel={null}
      />
    </LiveKitRoom>
  );
}

// ─── VideoRoomPage ────────────────────────────────────────────────────────────

export default function VideoRoomPage(props: VideoRoomPageProps) {
  const { sessionId } = props;
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
        : `/sessions/${sessionId}/materials`,
    [roomAuth, sessionId],
  );

  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenResponse, setTokenResponse] = useState<LiveKitTokenResponse | null>(null);
  const [sidebar, setSidebar] = useState<RoomSidebarData | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);
  const [recordingState, setRecordingState] = useState<RoomRecordingState>(null);
  const [sessionCloseState, setSessionCloseState] = useState<ShellSessionCloseState>({
    isClosed: false,
    closeMessageKey: null,
    closedBeforeNegotiation: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadRoom() {
      setIsLoading(true);
      setError(null);

      try {
        const [tokenResult, sidebarResult, controlResult] = await Promise.all([
          fetch("/api/livekit/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(roomAuthBody(roomAuth)),
          }),
          fetch(`/api/livekit/sidebar?${roomAuthQuery(roomAuth)}`),
          fetch(
            `/api/sessions/${sessionId}/control-state?${roomAuthQuery(roomAuth)}`,
            { cache: "no-store" },
          ),
        ]);

        const tokenPayload = (await tokenResult.json()) as
          | LiveKitTokenResponse
          | { error?: string };
        const sidebarPayload = (await sidebarResult.json()) as
          | RoomSidebarData
          | { error?: string };
        const controlPayload = (await controlResult.json()) as
          | RoomControlPayload
          | { error?: string };

        if (!tokenResult.ok) {
          throw new Error(
            "error" in tokenPayload && tokenPayload.error
              ? tokenPayload.error
              : t("room.unableToJoinRoom"),
          );
        }

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

        if (!("token" in tokenPayload) || tokenPayload.sessionId !== sessionId) {
          throw new Error(t("room.joinLinkMismatch"));
        }

        if (!cancelled) {
          setTokenResponse(tokenPayload);
          setSidebar(sidebarPayload as RoomSidebarData);
          const payload = controlPayload as RoomControlPayload;
          setControlState(payload);
          setRecordingState(payload.recording ?? null);
          setSessionCloseState({
            isClosed: payload.isClosed,
            closeMessageKey: payload.closeMessageKey ?? null,
            closedBeforeNegotiation: payload.closedBeforeNegotiation,
          });

          saveRecoveryContext({ type: "SESSION_ROOM", sessionId });
        }
      } catch (loadError) {
        if (!cancelled) {
          const message =
            loadError instanceof Error ? loadError.message : t("room.unableToJoinRoom");

          if (
            message.includes("session") ||
            message.includes("join") ||
            message.includes("token")
          ) {
            clearRecoveryContext();
          }

          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadRoom();

    return () => {
      cancelled = true;
    };
  }, [roomAuth, sessionId, t]);

  useEffect(() => {
    if (isLoading || error) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      touchRecoveryContext();

      try {
        const [controlResponse, sidebarResponse] = await Promise.all([
          fetch(
            `/api/sessions/${sessionId}/control-state?${roomAuthQuery(roomAuth)}`,
            { cache: "no-store" },
          ),
          fetch(`/api/livekit/sidebar?${roomAuthQuery(roomAuth)}`, {
            cache: "no-store",
          }),
        ]);

        if (controlResponse.ok) {
          const nextState = (await controlResponse.json()) as RoomControlPayload;
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
  }, [error, isLoading, roomAuth, sessionId]);

  const handleInvalidToken = useCallback(() => {
    clearRecoveryContext();
    setError(t("rejoin.sessionNoLongerAvailable"));
  }, [t]);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-white">
        <p className="text-sm text-slate-300">{t("room.connectingToVideoRoom")}</p>
      </div>
    );
  }

  if (error || !tokenResponse || !sidebar || !controlState) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 app-gradient-bg px-4 text-center">
        <div>
          <h1 className="text-lg font-bold text-slate-50">{t("room.unableToJoinVideoRoom")}</h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            {error ?? t("room.somethingWentWrongConnecting")}
          </p>
        </div>
        <GradientButtonLink href={materialsUrl}>{t("room.backToSessionMaterials")}</GradientButtonLink>
        <GradientButtonLink href="/rejoin">{t("rejoin.rejoin")}</GradientButtonLink>
      </div>
    );
  }

  return (
    <ConnectedRoom
      roomAuth={roomAuth}
      materialsUrl={materialsUrl}
      sessionId={sessionId}
      tokenResponse={tokenResponse}
      sidebar={sidebar}
      controlState={controlState}
      recordingState={recordingState}
      sessionCloseState={sessionCloseState}
      onControlStateChange={setControlState}
      onRecordingStateChange={setRecordingState}
      onInvalidToken={handleInvalidToken}
    />
  );
}
