"use client";

import "@livekit/components-styles";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import { ParticipantType } from "@/app/generated/prisma/enums";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DebriefPanel } from "@/components/debrief-panel";
import { FacilitatorRoomControls } from "@/components/facilitator-room-controls";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LiveKitReconnectBanner } from "@/components/livekit-reconnect-banner";
import { MicEnforcement } from "@/components/mic-enforcement";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { SessionRoomPresenceHeartbeat } from "@/components/session-room-presence-heartbeat";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import { RecordingIndicator } from "@/components/recording-indicator";
import { RestrictedControlBar } from "@/components/restricted-control-bar";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { StructuredVideoLayout } from "@/components/structured-video-layout";
import { GradientButtonLink } from "@/components/ui/buttons";
import { buildSessionMaterialsPath } from "@/lib/config";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import type { ControlState } from "@/lib/negotiation-control";
import type { SessionCloseState } from "@/lib/session-close-state";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import {
  clearRecoveryContext,
  saveRecoveryContext,
  touchRecoveryContext,
} from "@/lib/rejoin/recovery-storage";
import { useI18n } from "@/lib/i18n/useI18n";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type LiveKitTokenResponse = {
  token: string;
  serverUrl: string;
  sessionId: string;
  participantId: string;
  participantType: RoomSidebarData["participantType"];
  displayName: string;
};

type RoomControlPayload = ControlState &
  SessionCloseState & {
  recording?: {
    status: string;
    errorMessage: string | null;
  } | null;
  recordingWarning?: string;
  closeMessageKey?:
    | "events.sessionClosedByEvent"
    | "events.sessionClosedBeforeNegotiation"
    | "join.sessionFinishedMessage"
    | null;
};

type VideoRoomPageProps = {
  sessionId: string;
  joinToken: string;
};

function RoomSidebar({
  joinToken,
  sidebar,
}: {
  joinToken: string;
  sidebar: RoomSidebarData;
}) {
  const { t } = useI18n();

  const notesConfig =
    sidebar.participantType === ParticipantType.PARTICIPANT
      ? {
          title: t("join.preparation"),
          description: t("join.preparationDescription"),
          placeholder: t("join.preparationPlaceholder"),
        }
      : sidebar.participantType === ParticipantType.OBSERVER
        ? {
            title: t("join.observerNotes"),
            description: t("join.observerNotesDescription"),
            placeholder: t("join.observerNotesPlaceholder"),
          }
        : {
            title: t("join.facilitatorNotes"),
            description: t("join.facilitatorNotesDescription"),
            placeholder: t("join.facilitatorNotesPlaceholder"),
          };

  const participantTypeLabel = t(
    `participantType.${sidebar.participantType}` as `participantType.${typeof sidebar.participantType}`,
  );

  return (
    <aside className="glass-panel flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-600/25 bg-[#020617]/90">
      <div className="shrink-0 border-b border-slate-600/25 px-4 py-3.5">
        <h2 className="text-sm font-bold text-slate-50">
          {t("room.sessionPanel")}
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {sidebar.displayName} · {participantTypeLabel}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="space-y-4">
          <GlassCard elevated>
            <GlassCardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-50">
                  {t("join.publicContext")}
                </h3>
                <CaseLanguageBadge caseLanguage={sidebar.publicContext.caseLanguage} />
              </div>
              <div>
                <h4 className="text-sm font-medium text-slate-300">
                  {t("join.caseDescription")}
                </h4>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">
                  {sidebar.publicContext.description}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-slate-300">
                  {t("join.publicInstructions")}
                </h4>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-400">
                  {sidebar.publicContext.publicInstructions}
                </p>
              </div>
            </GlassCardContent>
          </GlassCard>

        {sidebar.participantType === ParticipantType.PARTICIPANT &&
        sidebar.caseRole ? (
          <RoleBriefingCard
            title={t("join.yourRoleTitle", { name: sidebar.caseRole.name })}
            subtitle={t("join.privateBriefingVisible")}
            role={sidebar.caseRole}
          />
        ) : null}

        {sidebar.participantType === ParticipantType.FACILITATOR ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-50">
                {t("room.facilitatorPanel")}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                {t("room.participantRoleBriefingsDescription")}
              </p>
            </div>
            {sidebar.facilitatorBriefings.length === 0 ? (
              <p className="text-sm text-slate-400">
                {t("room.noParticipantRolesAssigned")}
              </p>
            ) : (
              sidebar.facilitatorBriefings.map((briefing) => (
                <RoleBriefingCard
                  key={`${briefing.displayName}-${briefing.role.name}`}
                  title={t("join.participantBriefingTitle", {
                    name: briefing.displayName,
                    role: briefing.role.name,
                  })}
                  subtitle={t("join.privateBriefingForParticipant")}
                  role={briefing.role}
                />
              ))
            )}
          </div>
        ) : null}

        {sidebar.participantType === ParticipantType.OBSERVER ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-50">
              {t("join.observerNotes")}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {t("room.observerNotesLive")}
            </p>
          </div>
        ) : null}

        <GlassCard elevated>
          <GlassCardContent>
            <h3 className="mb-3 text-sm font-semibold text-slate-50">
              {notesConfig.title}
            </h3>
            <ParticipantNotesPanel
              joinToken={joinToken}
              initialNotes={sidebar.notes}
              description={notesConfig.description}
              placeholder={notesConfig.placeholder}
            />
          </GlassCardContent>
        </GlassCard>
        </div>
      </div>
    </aside>
  );
}

function LeaveRoomButton({ joinToken }: { joinToken: string }) {
  const router = useRouter();
  const room = useRoomContext();
  const { t } = useI18n();

  const handleLeave = useCallback(() => {
    router.push(buildSessionMaterialsPath(joinToken));
    void room.disconnect();
  }, [joinToken, room, router]);

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

function SessionClosedOverlay({
  joinToken,
  closeMessageKey,
  recordingStatus,
  eventLobbyUrl,
  eventCompleted,
  onLeave,
}: {
  joinToken: string;
  closeMessageKey: NonNullable<RoomControlPayload["closeMessageKey"]>;
  recordingStatus?: string | null;
  eventLobbyUrl?: string | null;
  eventCompleted?: boolean;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const hadRecording =
    recordingStatus &&
    recordingStatus !== "NOT_STARTED" &&
    recordingStatus !== "FAILED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-600/40 bg-slate-900 p-6 text-center shadow-xl">
        <h2 className="text-lg font-bold text-slate-50" data-testid="session-finished-message">
          {t(closeMessageKey)}
        </h2>
        {hadRecording && closeMessageKey === "events.sessionClosedByEvent" ? (
          <p className="text-sm text-slate-400">{t("events.recordingFinalizing")}</p>
        ) : null}
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {eventLobbyUrl ? (
            <GradientButtonLink
              href={eventLobbyUrl}
              data-testid="return-to-event-lobby-button"
              className={eventCompleted ? "pointer-events-none opacity-60" : undefined}
              aria-disabled={eventCompleted}
            >
              {t("events.returnToEventLobby")}
            </GradientButtonLink>
          ) : null}
          <GradientButtonLink
            href={buildSessionMaterialsPath(joinToken)}
            data-testid="open-session-materials-button"
          >
            {t("room.backToSessionMaterials")}
          </GradientButtonLink>
          <button
            type="button"
            className="btn-secondary rounded-lg px-4 py-2 text-sm font-semibold"
            onClick={onLeave}
          >
            {t("events.leaveRoom")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectedRoom({
  joinToken,
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
  joinToken: string;
  sessionId: string;
  tokenResponse: LiveKitTokenResponse;
  sidebar: RoomSidebarData;
  controlState: ControlState;
  recordingState: RoomControlPayload["recording"];
  sessionCloseState: Pick<
    RoomControlPayload,
    "isClosed" | "closeMessageKey" | "closedBeforeNegotiation"
  >;
  onControlStateChange: (state: ControlState) => void;
  onRecordingStateChange: (state: RoomControlPayload["recording"]) => void;
  onInvalidToken: () => void;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const handleLeaveClosed = useCallback(() => {
    router.push(buildSessionMaterialsPath(joinToken));
  }, [joinToken, router]);

  const handleLeaveRoom = useCallback(() => {
    router.push(buildSessionMaterialsPath(joinToken));
  }, [joinToken, router]);

  const handleManualRejoin = useCallback(() => {
    router.push(`/rejoin`);
  }, [router]);

  const participantTypeLabel = t(
    `participantType.${tokenResponse.participantType}` as `participantType.${typeof tokenResponse.participantType}`,
  );

  // Normal session FINISH → debrief mode (stay in room, show debrief panel)
  const isDebriefMode =
    sessionCloseState.isClosed &&
    sessionCloseState.closeMessageKey === "join.sessionFinishedMessage";

  // Event-closed or other closures → blocking overlay
  const isEventClosed =
    sessionCloseState.isClosed && !isDebriefMode;

  return (
    <>
      {isEventClosed && sessionCloseState.closeMessageKey ? (
        <SessionClosedOverlay
          joinToken={joinToken}
          closeMessageKey={sessionCloseState.closeMessageKey}
          recordingStatus={recordingState?.status}
          eventLobbyUrl={sidebar.event?.lobbyUrl}
          eventCompleted={sidebar.event?.status === "COMPLETED"}
          onLeave={handleLeaveClosed}
        />
      ) : null}
      <SessionRoomPresenceHeartbeat
        sessionId={sessionId}
        joinToken={joinToken}
        onInvalidToken={onInvalidToken}
      />
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
        <RoomAudioRenderer />
        <MicEnforcement controlState={controlState} />
        <header
          className="glass-header flex shrink-0 items-center justify-between gap-3 border-b border-slate-600/25 px-4 py-3"
          data-testid="session-room-header"
        >
          <div className="min-w-0 space-y-2">
            <p className="truncate text-sm font-semibold text-slate-50">
              {sidebar.sessionTitle}
            </p>
            <p className="truncate text-xs text-slate-400">
              {tokenResponse.displayName} · {participantTypeLabel}
            </p>
            {isDebriefMode ? (
              <span
                className="inline-block rounded-full border border-amber-500/40 bg-amber-900/20 px-2 py-0.5 text-xs text-amber-300"
                data-testid="debrief-mode-badge"
              >
                {t("room.debriefTitle")}
              </span>
            ) : (
              <RecordingIndicator
                status={recordingState?.status}
                negotiationState={controlState.negotiationState}
                participantType={tokenResponse.participantType}
                isFacilitator={controlState.canControl}
                errorMessage={recordingState?.errorMessage}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            {!isDebriefMode ? (
              <GradientButtonLink
                href={buildSessionMaterialsPath(joinToken)}
                className="hidden px-3 py-1.5 text-xs sm:inline-flex"
                data-testid="session-materials-link"
              >
                {t("room.sessionMaterials")}
              </GradientButtonLink>
            ) : null}
            <RejoinNavLink />
            <LanguageSwitcher />
            <LeaveRoomButton joinToken={joinToken} />
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <LiveKitReconnectBanner onManualRejoin={handleManualRejoin} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden bg-[#0f172a]">
              <StructuredVideoLayout
                roster={sidebar.roster}
                controlState={controlState}
                participantType={tokenResponse.participantType}
              />
            </div>

            {/* Facilitator controls — hidden in debrief mode */}
            {controlState.canControl && !sessionCloseState.isClosed ? (
              <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-3">
                <FacilitatorRoomControls
                  sessionId={sessionId}
                  joinToken={joinToken}
                  controlState={controlState}
                  onControlStateChange={(state) => {
                    onControlStateChange(state);
                  }}
                  onRecordingStateChange={onRecordingStateChange}
                />
              </div>
            ) : null}

            <div className="shrink-0 border-t border-slate-800 bg-slate-900">
              <RestrictedControlBar
                micAllowed={controlState.micAllowed}
                onLeave={handleLeaveRoom}
              />
            </div>
          </div>

          {/* Right sidebar: debrief panel when finished, regular sidebar otherwise */}
          <div className="hidden h-full min-h-0 w-96 shrink-0 overflow-hidden border-l border-slate-800 lg:block">
            {isDebriefMode ? (
              <DebriefPanel
                sessionId={sessionId}
                joinToken={joinToken}
                participantType={tokenResponse.participantType}
                eventLobbyUrl={sidebar.event?.lobbyUrl}
              />
            ) : (
              <RoomSidebar joinToken={joinToken} sidebar={sidebar} />
            )}
          </div>
        </div>
      </LiveKitRoom>
    </>
  );
}

export default function VideoRoomPage({
  sessionId,
  joinToken,
}: VideoRoomPageProps) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenResponse, setTokenResponse] = useState<LiveKitTokenResponse | null>(
    null,
  );
  const [sidebar, setSidebar] = useState<RoomSidebarData | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);
  const [recordingState, setRecordingState] =
    useState<RoomControlPayload["recording"]>(null);
  const [sessionCloseState, setSessionCloseState] = useState<
    Pick<RoomControlPayload, "isClosed" | "closeMessageKey" | "closedBeforeNegotiation">
  >({
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
            body: JSON.stringify({ joinToken }),
          }),
          fetch(
            `/api/livekit/sidebar?joinToken=${encodeURIComponent(joinToken)}`,
          ),
          fetch(
            `/api/sessions/${sessionId}/control-state?joinToken=${encodeURIComponent(joinToken)}`,
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

        if (
          !("token" in tokenPayload) ||
          tokenPayload.sessionId !== sessionId
        ) {
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
            closeMessageKey: payload.closeMessageKey,
            closedBeforeNegotiation: payload.closedBeforeNegotiation,
          });

          saveRecoveryContext({
            type: "SESSION_ROOM",
            sessionId,
            joinToken,
            displayName: tokenPayload.displayName,
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          const message =
            loadError instanceof Error
              ? loadError.message
              : t("room.unableToJoinRoom");

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
  }, [joinToken, sessionId, t]);

  useEffect(() => {
    if (isLoading || error) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      touchRecoveryContext();

      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/control-state?joinToken=${encodeURIComponent(joinToken)}`,
        );

        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as RoomControlPayload;
        setControlState(nextState);
        setRecordingState(nextState.recording ?? null);
        setSessionCloseState({
          isClosed: nextState.isClosed,
          closeMessageKey: nextState.closeMessageKey,
          closedBeforeNegotiation: nextState.closedBeforeNegotiation,
        });
      } catch {
        // Ignore transient polling errors.
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [error, isLoading, joinToken, sessionId]);

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
          <h1 className="text-lg font-bold text-slate-50">
            {t("room.unableToJoinVideoRoom")}
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            {error ?? t("room.somethingWentWrongConnecting")}
          </p>
        </div>
        <GradientButtonLink href={buildSessionMaterialsPath(joinToken)}>
          {t("room.backToSessionMaterials")}
        </GradientButtonLink>
        <GradientButtonLink href="/rejoin">{t("rejoin.rejoin")}</GradientButtonLink>
      </div>
    );
  }

  return (
    <ConnectedRoom
      joinToken={joinToken}
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
