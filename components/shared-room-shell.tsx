"use client";

/**
 * Stage 5.3 — Shared provider-agnostic room/session orchestration layer.
 *
 * Owns:
 *   - access and roles (sidebar data)
 *   - session participant resolution (via sidebar)
 *   - negotiation state machine (control state)
 *   - timer/countdown
 *   - sidebar (briefings, notes, role management)
 *   - privacy (via sidebar serializer — server-resolved)
 *   - materials (nav link)
 *   - analysis/debrief visibility
 *   - role management (SessionRoleManagementPanel — facilitator only, PREPARATION phase)
 *   - facilitator controls (FacilitatorRoomControls)
 *   - recording UI/policy/orchestration (RecordingIndicator)
 *   - post-processing pipeline entrypoints (DebriefPanel)
 *
 * Provider-specific slots (injected by each provider):
 *   - leaveButton      — provider leave action
 *   - controlBar       — mic/camera toggles
 *   - mediaArea        — video grid
 *   - audioRenderer    — LiveKit RoomAudioRenderer (null for Voximplant)
 *   - micEnforcement   — LiveKit MicEnforcement (null for Voximplant)
 *   - speakingTracker  — LiveKit SpeakingActivityTracker (null for Voximplant)
 *   - providerBanner   — LiveKit reconnect banner (null for Voximplant)
 *   - mediaWarnings    — non-fatal device warnings
 *   - autoplayUnlockBanner — Voximplant autoplay unlock (null for LiveKit)
 *   - debugPanel       — Voximplant AudioDiagnosticsPanel (null for LiveKit)
 */

import type { ReactNode } from "react";

import { ParticipantType } from "@/app/generated/prisma/enums";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DebriefPanel } from "@/components/debrief-panel";
import { FacilitatorRoomControls } from "@/components/facilitator-room-controls";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import { RecordingIndicator } from "@/components/recording-indicator";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { SessionRoleManagementPanel } from "@/components/session-role-management-panel";
import { SessionRoomPresenceHeartbeat } from "@/components/session-room-presence-heartbeat";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { GradientButtonLink, SecondaryButtonLink } from "@/components/ui/buttons";
import { VisibilityBadge } from "@/components/visibility-badge";
import type { ControlState } from "@/lib/negotiation-control";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import { useI18n } from "@/lib/i18n/useI18n";
import type { RoomRecordingState, ShellSessionCloseState } from "@/lib/room-provider/types";

// ─── RoomSidebar ─────────────────────────────────────────────────────────────
// Authoritative sidebar for all providers. Shows role briefings, notes,
// role management (facilitator + PREPARATION phase), observer content.

function RoomSidebar({
  roomAuth,
  sidebar,
  negotiationState,
}: {
  roomAuth: RoomAuthToken;
  sidebar: RoomSidebarData;
  negotiationState: ControlState["negotiationState"];
}) {
  const { t } = useI18n();

  const isUnassignedParticipant =
    sidebar.participantType === ParticipantType.PARTICIPANT && !sidebar.hasAssignedRole;

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

  const roleManagementParticipants =
    sidebar.sessionRolesForFacilitator.length > 0
      ? sidebar.roster.map((entry) => ({
          id: entry.id,
          displayName: entry.displayName,
          type: entry.participantType as string,
          currentRoleId: entry.sessionRoleId ?? null,
          currentRoleName: entry.caseRoleName,
          joinedAt: entry.joinedAt,
          lastSeenAt: entry.lastSeenAt,
        }))
      : [];
  const canManageRolesBeforePreparation = negotiationState === "PREPARATION";

  return (
    <aside className="glass-panel flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-600/25 bg-[#020617]/90">
      <div className="shrink-0 border-b border-slate-600/25 px-4 py-3.5">
        <h2 className="text-sm font-bold text-slate-50">{t("room.sessionPanel")}</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {sidebar.displayName} · {participantTypeLabel}
          {isUnassignedParticipant ? (
            <span className="ml-2 text-amber-400" data-testid="room-unassigned-badge">
              · {t("sessions.noRoleAssignedBadge")}
            </span>
          ) : null}
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

          {/* PARTICIPANT: role briefing or waiting message */}
          {sidebar.participantType === ParticipantType.PARTICIPANT ? (
            isUnassignedParticipant ? (
              <GlassCard elevated>
                <GlassCardContent>
                  <h3 className="mb-2 text-sm font-semibold text-slate-50">
                    {t("join.yourRole")}
                  </h3>
                  <p
                    className="text-sm text-amber-400"
                    data-testid="room-waiting-role-message"
                  >
                    {t("sessions.waitingForRoleAssignment")}
                  </p>
                </GlassCardContent>
              </GlassCard>
            ) : sidebar.caseRole ? (
              <RoleBriefingCard
                title={t("join.yourRoleTitle", { name: sidebar.caseRole.name })}
                subtitle={t("join.privateBriefingVisible")}
                role={sidebar.caseRole}
              />
            ) : null
          ) : null}

          {/* FACILITATOR: all participant briefings */}
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

          {/* FACILITATOR: role management in PREPARATION phase */}
          {sidebar.participantType === ParticipantType.FACILITATOR &&
          sidebar.sessionRolesForFacilitator.length > 0 &&
          canManageRolesBeforePreparation ? (
            <GlassCard elevated>
              <GlassCardContent>
                <h3 className="mb-3 text-sm font-semibold text-slate-50">
                  {t("sessions.roleManagementTitle")}
                </h3>
                <SessionRoleManagementPanel
                  sessionId={sidebar.sessionId}
                  participants={roleManagementParticipants}
                  availableRoles={sidebar.sessionRolesForFacilitator}
                  compact
                />
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {/* OBSERVER: notes hint */}
          {sidebar.participantType === ParticipantType.OBSERVER ? (
            <div>
              <h3 className="text-sm font-semibold text-slate-50">
                {t("join.observerNotes")}
              </h3>
              <p className="mt-1 text-sm text-slate-400">{t("room.observerNotesLive")}</p>
            </div>
          ) : null}

          {/* Notes panel (all types) */}
          <GlassCard elevated>
            <GlassCardContent>
              <h3 className="mb-3 text-sm font-semibold text-slate-50">
                {notesConfig.title}
              </h3>
              {isUnassignedParticipant ? (
                <p
                  className="text-sm text-amber-400"
                  data-testid="room-notes-locked-message"
                >
                  {t("sessions.preparationLockedNoRole")}
                </p>
              ) : (
                <ParticipantNotesPanel
                  {...(roomAuth.type === "account"
                    ? { authMode: "account" as const, participantId: roomAuth.participantId }
                    : { joinToken: roomAuth.value })}
                  initialNotes={sidebar.notes}
                  description={notesConfig.description}
                  placeholder={notesConfig.placeholder}
                />
              )}
            </GlassCardContent>
          </GlassCard>
        </div>
      </div>
    </aside>
  );
}

// ─── SessionClosedOverlay ─────────────────────────────────────────────────────

function SessionClosedOverlay({
  materialsUrl,
  closeMessageKey,
  recordingStatus,
  eventLobbyUrl,
  eventCompleted,
  onLeave,
}: {
  materialsUrl: string;
  closeMessageKey: NonNullable<ShellSessionCloseState["closeMessageKey"]>;
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
        <h2
          className="text-lg font-bold text-slate-50"
          data-testid="session-finished-message"
        >
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
            href={materialsUrl}
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

// ─── SharedRoomShell props ────────────────────────────────────────────────────

export type SharedRoomShellProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  materialsUrl: string;

  /** DB-resolved sidebar data (roles, privacy, briefings, roster). */
  sidebar: RoomSidebarData;
  /** Negotiation state machine (control state). */
  controlState: ControlState;
  /** Recording status from the recording-control API. */
  recordingState: RoomRecordingState;
  /** Session closed/debrief state. */
  sessionCloseState: ShellSessionCloseState;

  /** DB-resolved participant type for the current user. */
  participantType: ParticipantType;
  /** Translated participant type label (e.g. "Участник", "Фасилитатор"). */
  participantTypeLabel: string;
  /** Server-resolved display name. */
  displayName: string;

  /** Called when control state changes (facilitator actions). */
  onControlStateChange: (state: ControlState) => void;
  /** Called when recording state changes. */
  onRecordingStateChange: (state: RoomRecordingState) => void;
  /** Called when the presence heartbeat detects an invalid token. */
  onInvalidToken: () => void;
  /** Navigate away after leaving (for SessionClosedOverlay). */
  onLeave: () => void;

  // ── Provider-specific slots ──────────────────────────────────────────────

  /**
   * Leave button slot.
   * - LiveKit: <LeaveRoomButton materialsUrl={...} /> (uses useRoomContext)
   * - Voximplant: a plain button that calls leave() + router.push()
   */
  leaveButton: ReactNode;

  /**
   * Media control bar slot.
   * - LiveKit: <RestrictedControlBar micAllowed={...} onLeave={...} />
   * - Voximplant: <VoximplantControlBar .../>
   */
  controlBar: ReactNode;

  /**
   * Video layout slot.
   * - LiveKit: <StructuredVideoLayout .../>
   * - Voximplant: <VoximplantVideoLayout .../>
   */
  mediaArea: ReactNode;

  /**
   * LiveKit-specific invisible renderers.
   * Pass <RoomAudioRenderer /> for LiveKit; null for Voximplant.
   */
  audioRenderer?: ReactNode;

  /**
   * LiveKit MicEnforcement (enforces mic policy from control state).
   * Pass <MicEnforcement controlState={...} /> for LiveKit; null for Voximplant.
   */
  micEnforcement?: ReactNode;

  /**
   * LiveKit SpeakingActivityTracker.
   * Pass <SpeakingActivityTracker ... /> for LiveKit; null for Voximplant.
   * (Voximplant endpoint->userId mapping is deferred to Stage 5.4.)
   */
  speakingTracker?: ReactNode;

  /**
   * LiveKit reconnect banner.
   * Pass <LiveKitReconnectBanner ... /> for LiveKit; null for Voximplant.
   */
  providerBanner?: ReactNode;

  /**
   * Non-fatal device acquisition warnings (camera busy, mic unavailable).
   * LiveKit: managed internally by LiveKit components.
   * Voximplant: from useVoximplantRoom.mediaWarnings.
   */
  mediaWarnings?: string[];

  /**
   * Autoplay-blocked unlock banner.
   * Voximplant: shown when remote audio is blocked by browser autoplay policy.
   * LiveKit: null (handled by browser natively for most cases).
   */
  autoplayUnlockBanner?: ReactNode;

  /**
   * Provider diagnostics panel.
   * Voximplant: <AudioDiagnosticsPanel ... /> when ?debugAudio=1.
   * LiveKit: null.
   */
  debugPanel?: ReactNode;

  /**
   * Provider-specific recording controls (facilitator only).
   * Voximplant: start/stop recording buttons that relay typed scenario messages.
   * LiveKit: null (recording is triggered automatically on negotiation start).
   * Rendered inside the facilitator controls area when provided.
   */
  recordingControls?: ReactNode;
};

// ─── SharedRoomShell ─────────────────────────────────────────────────────────

/**
 * Provider-agnostic room/session orchestration shell.
 *
 * Render this component:
 * - For LiveKit: inside <LiveKitRoom> context (slots like RestrictedControlBar
 *   and LeaveRoomButton use LiveKit hooks internally).
 * - For Voximplant: without a LiveKit wrapper; pass null for LiveKit-specific slots.
 */
export function SharedRoomShell({
  sessionId,
  roomAuth,
  materialsUrl,
  sidebar,
  controlState,
  recordingState,
  sessionCloseState,
  participantType,
  participantTypeLabel,
  displayName,
  onControlStateChange,
  onRecordingStateChange,
  onInvalidToken,
  onLeave,
  leaveButton,
  controlBar,
  mediaArea,
  audioRenderer,
  micEnforcement,
  speakingTracker,
  providerBanner,
  mediaWarnings,
  autoplayUnlockBanner,
  debugPanel,
  recordingControls,
}: SharedRoomShellProps) {
  const { t } = useI18n();

  // Normal session FINISH → debrief mode (stay in room, show debrief panel)
  const isDebriefMode =
    sessionCloseState.isClosed &&
    sessionCloseState.closeMessageKey === "join.sessionFinishedMessage";

  // Event-closed or other closures → blocking overlay
  const isEventClosed = sessionCloseState.isClosed && !isDebriefMode;

  return (
    <>
      {/* Provider-specific invisible renderers */}
      {audioRenderer}
      {micEnforcement}
      {speakingTracker}

      {/* Presence heartbeat (works for both providers via roomAuth) */}
      <SessionRoomPresenceHeartbeat
        sessionId={sessionId}
        roomAuth={roomAuth}
        onInvalidToken={onInvalidToken}
      />

      {/* Session closed overlay (event-close / early close) */}
      {isEventClosed && sessionCloseState.closeMessageKey ? (
        <SessionClosedOverlay
          materialsUrl={materialsUrl}
          closeMessageKey={sessionCloseState.closeMessageKey}
          recordingStatus={recordingState?.status}
          eventLobbyUrl={sidebar.event?.lobbyUrl}
          eventCompleted={sidebar.event?.status === "COMPLETED"}
          onLeave={onLeave}
        />
      ) : null}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="glass-header flex shrink-0 items-center justify-between gap-3 border-b border-slate-600/25 px-4 py-3"
        data-testid="session-room-header"
      >
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            {/* Session title — always the domain title, never the provider conference name */}
            <p className="truncate text-sm font-semibold text-slate-50">
              {sidebar.sessionTitle}
            </p>
            <VisibilityBadge visibility={sidebar.visibility} showLabel={false} />
          </div>
          <p className="truncate text-xs text-slate-400">
            {displayName} · {participantTypeLabel}
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
              participantType={participantType}
              isFacilitator={controlState.canControl}
              errorMessage={recordingState?.errorMessage}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          <SecondaryButtonLink
            href="/sessions"
            className="px-3 py-1.5 text-xs"
            aria-label={t("events.backToSessionsCompact")}
            title={t("events.backToSessionsCompact")}
            data-testid="back-to-sessions-button"
          >
            {t("events.backToSessionsCompact")}
          </SecondaryButtonLink>
          {sidebar.event?.lobbyUrl ? (
            <SecondaryButtonLink
              href={sidebar.event.lobbyUrl}
              className="hidden px-3 py-1.5 text-xs sm:inline-flex"
              aria-label={t("events.backToLobbyCompact")}
              title={t("events.backToLobbyCompact")}
              data-testid="back-to-event-lobby-button"
            >
              {t("events.backToLobbyCompact")}
            </SecondaryButtonLink>
          ) : null}
          {!isDebriefMode ? (
            <GradientButtonLink
              href={materialsUrl}
              className="hidden px-3 py-1.5 text-xs sm:inline-flex"
              data-testid="session-materials-link"
            >
              {t("room.sessionMaterials")}
            </GradientButtonLink>
          ) : null}
          <RejoinNavLink />
          <LanguageSwitcher />
          {/* Provider-specific leave button slot */}
          {leaveButton}
        </div>
      </header>

      {/* ── Main content area ───────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Provider-specific reconnect/status banner (LiveKit reconnect banner) */}
        {providerBanner}

        {/* Left column: video + controls */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Video layout */}
          <div className="min-h-0 flex-1 overflow-hidden bg-[#0f172a]">
            {mediaArea}
          </div>

          {/* Non-fatal device warnings */}
          {mediaWarnings && mediaWarnings.length > 0 ? (
            <div className="shrink-0 border-t border-amber-700/40 bg-amber-950/30 px-4 py-2">
              {mediaWarnings.map((warning) => (
                <p key={warning} className="text-xs text-amber-300">
                  ⚠ {warning}
                </p>
              ))}
            </div>
          ) : null}

          {/* Autoplay unlock banner (Voximplant) */}
          {autoplayUnlockBanner}

          {/* Facilitator controls — hidden in debrief/closed states */}
          {controlState.canControl && !sessionCloseState.isClosed ? (
            <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-3 space-y-2">
              <FacilitatorRoomControls
                sessionId={sessionId}
                roomAuth={roomAuth}
                controlState={controlState}
                onControlStateChange={onControlStateChange}
                onRecordingStateChange={onRecordingStateChange}
              />
              {/* Provider-specific recording controls (Voximplant only) */}
              {recordingControls}
            </div>
          ) : null}

          {/* Provider-specific media control bar (mic/camera/leave) */}
          <div className="shrink-0 border-t border-slate-800 bg-slate-900">
            {controlBar}
          </div>

          {/* Provider diagnostics panel (Voximplant ?debugAudio=1) */}
          {debugPanel}
        </div>

        {/* Right sidebar: debrief panel when finished, regular sidebar otherwise */}
        <div className="hidden h-full min-h-0 w-[28rem] shrink-0 overflow-hidden border-l border-slate-800 xl:w-[32rem] lg:block">
          {isDebriefMode ? (
            <DebriefPanel
              sessionId={sessionId}
              roomAuth={roomAuth}
              participantType={participantType}
              eventLobbyUrl={sidebar.event?.lobbyUrl}
            />
          ) : (
            <RoomSidebar
              roomAuth={roomAuth}
              sidebar={sidebar}
              negotiationState={controlState.negotiationState}
            />
          )}
        </div>
      </div>
    </>
  );
}
