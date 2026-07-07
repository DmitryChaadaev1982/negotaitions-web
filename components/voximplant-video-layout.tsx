"use client";

import { ParticipantType } from "@/app/generated/prisma/enums";
import { VoximplantRemoteSpeakingActivityTracker } from "@/components/voximplant-remote-speaking-activity-tracker";
import { RoomTimerPanel } from "@/components/room-timer-panel";
import {
  VoximplantParticipantTile,
  type VoxTileMicState,
} from "@/components/voximplant-participant-tile";
import { useI18n } from "@/lib/i18n/useI18n";
import type { ControlState } from "@/lib/negotiation-control";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import { REMOTE_SPEAKING_LEVEL_THRESHOLD } from "@/lib/telemetry/speaking-activity-config";
import { useRemoteSpeaking } from "@/lib/voximplant/remote-speaking";
import {
  resolveRemoteMicStateByPolicy,
  resolveConnectionState,
  resolveRosterVisualRoles,
  type RosterConnectionState,
} from "@/lib/voximplant/room-layout-model";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { ReactNode } from "react";
import { useMemo } from "react";

type VoxTileParticipant = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  stream: MediaStream | null;
  audioStream?: MediaStream | null;
};

function NoVideoPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-2 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

type ResolvedRosterTile = {
  rosterEntry: SessionRosterEntry;
  participant: VoxTileParticipant;
  matchedRemoteId: string | null;
  zone: "facilitator" | "participant_a" | "participant_b" | "observer" | "unknown";
  connectionState: RosterConnectionState;
  isLocal: boolean;
};

function normalizeEndpointUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.includes("@") ? normalized.split("@")[0] ?? null : normalized;
}

function RoleSection({
  title,
  testId,
  className,
  children,
}: {
  title: string;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`space-y-2 ${className ?? ""}`} data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export function buildRemoteSpeakingInput(remoteParticipants: VoxTileParticipant[]) {
  return remoteParticipants.map((participant) => ({
    id: participant.id,
    stream: participant.audioStream ?? participant.stream,
  }));
}

export default function VoximplantVideoLayout({
  localParticipant,
  remoteParticipants,
  roster,
  currentParticipantId,
  controlState,
  localParticipantType,
  localCaseRoleName,
  isCameraOn,
  isMicMuted,
  localMicSystemMuted,
  micLevel,
  localRoleLabel,
  sessionId,
  roomAuth,
  connectionId,
  remoteTelemetryDebugEnabled,
  remoteTelemetryCaptureEnabled,
  canReportRemoteTelemetry,
  joined,
  staleConnection,
  recordingStatus,
  audioProcessingEnabled,
}: {
  localParticipant: VoxTileParticipant | null;
  remoteParticipants: VoxTileParticipant[];
  roster: SessionRosterEntry[];
  currentParticipantId: string;
  controlState: ControlState;
  localParticipantType: ParticipantType;
  localCaseRoleName: string | null;
  isCameraOn?: boolean;
  isMicMuted?: boolean;
  localMicSystemMuted?: boolean;
  micLevel?: number;
  /**
   * Translated participant type label for the local user (e.g. "Участник", "Фасилитатор").
   * Resolved server-side via the sidebar API — same source as the LiveKit room.
   */
  localRoleLabel?: string;
  sessionId: string;
  roomAuth: RoomAuthToken;
  connectionId?: string;
  remoteTelemetryDebugEnabled: boolean;
  remoteTelemetryCaptureEnabled: boolean;
  canReportRemoteTelemetry: boolean;
  joined: boolean;
  staleConnection: boolean;
  recordingStatus?: string | null;
  audioProcessingEnabled?: boolean;
}) {
  const { t } = useI18n();
  const isSpeaking =
    !isMicMuted && micLevel !== undefined && micLevel > REMOTE_SPEAKING_LEVEL_THRESHOLD;

  // Bug 1 fix: derive real speaking state for remote participants from their
  // audio streams. Memoized so meters are not rebuilt on local mic-level ticks.
  const remoteSpeakingInput = useMemo(
    () => buildRemoteSpeakingInput(remoteParticipants),
    [remoteParticipants],
  );
  const remoteSpeakingById = useRemoteSpeaking(remoteSpeakingInput);

  const remoteByVoxUsername = useMemo(() => {
    const map = new Map<string, VoxTileParticipant>();
    let collapsedDuplicates = 0;
    for (const participant of remoteParticipants) {
      const normalized = normalizeEndpointUsername(participant.endpointUsername);
      if (!normalized) {
        continue;
      }
      // Bug 2 mitigation: quick leave/re-enter can briefly surface two remote
      // endpoints for the same login. Render only one tile per stable identity
      // (normalized Vox username), preferring a connected (streamed) endpoint
      // and otherwise the most recent entry. This hides the stale endpoint
      // instead of rendering a duplicate tile.
      const existing = map.get(normalized);
      if (!existing) {
        map.set(normalized, participant);
        continue;
      }
      collapsedDuplicates += 1;
      const existingHasStream = Boolean(existing.stream);
      const candidateHasStream = Boolean(participant.stream);
      if (candidateHasStream || !existingHasStream) {
        map.set(normalized, participant);
      }
    }
    if (collapsedDuplicates > 0 && process.env.NODE_ENV !== "production") {
      console.debug(
        `[vox-layout] collapsed ${collapsedDuplicates} duplicate remote endpoint(s) by stable identity`,
      );
    }
    return map;
  }, [remoteParticipants]);

  const visualRolesByRosterId = useMemo(
    () => resolveRosterVisualRoles(roster),
    [roster],
  );

  const resolvedRosterTiles = useMemo<ResolvedRosterTile[]>(() => {
    return roster.map((entry) => {
      const isLocal = entry.id === currentParticipantId;
      const remoteKey = normalizeEndpointUsername(entry.voximplantProviderUsername);
      const matchedRemote = remoteKey ? remoteByVoxUsername.get(remoteKey) : null;
      const participant: VoxTileParticipant = isLocal
        ? {
            id: entry.id,
            displayName: entry.displayName,
            endpointUsername: localParticipant?.endpointUsername ?? null,
            stream: localParticipant?.stream ?? null,
            audioStream: localParticipant?.audioStream ?? null,
          }
        : {
            id: matchedRemote?.id ?? entry.id,
            displayName: matchedRemote?.displayName ?? entry.displayName,
            endpointUsername: matchedRemote?.endpointUsername ?? entry.voximplantProviderUsername,
            stream: matchedRemote?.stream ?? null,
            audioStream: matchedRemote?.audioStream ?? null,
          };

      const visual = visualRolesByRosterId.get(entry.id) ?? {
        zone: "unknown" as const,
      };
      const connectionState = resolveConnectionState({
        hasVideoStream: Boolean(participant.stream),
        isLocal,
        isCameraOn: Boolean(isCameraOn),
        lastSeenAt: entry.lastSeenAt ?? null,
      });
      return {
        rosterEntry: entry,
        participant,
        matchedRemoteId: matchedRemote?.id ?? null,
        zone: visual.zone,
        connectionState,
        isLocal,
      };
    });
  }, [currentParticipantId, isCameraOn, localParticipant, remoteByVoxUsername, roster, visualRolesByRosterId]);

  const facilitatorTiles = resolvedRosterTiles.filter((tile) => tile.zone === "facilitator");
  const observerTiles = resolvedRosterTiles.filter((tile) => tile.zone === "observer");
  const participantATiles = resolvedRosterTiles.filter((tile) => tile.zone === "participant_a");
  const participantBTiles = resolvedRosterTiles.filter((tile) => tile.zone === "participant_b");
  const remoteTelemetryTargets = useMemo(
    () =>
      resolvedRosterTiles
        .filter((tile) => !tile.isLocal)
        .filter((tile) => tile.rosterEntry.participantType === ParticipantType.PARTICIPANT)
        .filter((tile) => Boolean(tile.matchedRemoteId))
        .map((tile) => ({
          sessionParticipantId: tile.rosterEntry.id,
          participantIdentity: tile.rosterEntry.displayName ?? null,
          isSpeaking: remoteSpeakingById[tile.participant.id] ?? false,
        })),
    [remoteSpeakingById, resolvedRosterTiles],
  );

  const localSubtitle = `${localRoleLabel ?? t(`participantType.${localParticipantType}` as `participantType.${typeof localParticipantType}`)}${
    localCaseRoleName ? ` · ${localCaseRoleName}` : ""
  }${isMicMuted ? ` · ${t("room.mediaMicOff")}` : ""}${!isCameraOn ? ` · ${t("room.mediaCameraOff")}` : ""}`;

  const toStateLabel = (state: RosterConnectionState): string => {
    if (state === "video_on") return t("room.videoOn");
    if (state === "camera_off") return t("room.mediaCameraOff");
    if (state === "connecting") return t("room.connectingVideo");
    return t("room.notConnected");
  };

  const renderRosterTile = (
    tile: ResolvedRosterTile,
    options?: { observerCompact?: boolean },
  ) => {
    const localizedRoleLabel =
      tile.zone === "facilitator"
        ? t("room.facilitator")
        : tile.zone === "participant_a"
          ? t("room.participantA")
          : tile.zone === "participant_b"
            ? t("room.participantB")
            : tile.zone === "observer"
              ? t("room.observer")
              : t("room.unknownRole");
    const tileMicState: VoxTileMicState = tile.isLocal
      ? localMicSystemMuted
        ? "system_muted"
        : isMicMuted
          ? "off"
          : "on"
      : resolveRemoteMicStateByPolicy({
          negotiationState: controlState.negotiationState,
          participantType: tile.rosterEntry.participantType,
        });
    const tileMicStateHint = tile.isLocal
      ? tileMicState === "system_muted"
        ? t("room.mediaMicLocked")
        : tileMicState === "on"
          ? t("room.mediaMicOn")
          : t("room.mediaMicOff")
      : tileMicState === "system_muted"
        ? t("room.mediaMicLocked")
        : t("room.remoteMicDerivedByPolicy");
    const tileMicStateLabel =
      tileMicState === "system_muted"
        ? t("room.mediaMicLocked")
        : tileMicState === "on"
          ? t("room.mediaMicOn")
          : t("room.mediaMicOff");
    const subtitle = tile.isLocal
      ? `${localSubtitle} · ${toStateLabel(tile.connectionState)}`
      : `${localizedRoleLabel}${tile.rosterEntry.caseRoleName ? ` · ${tile.rosterEntry.caseRoleName}` : ""} · ${toStateLabel(tile.connectionState)}`;
    return (
      <div key={tile.rosterEntry.id} className={options?.observerCompact ? "w-[220px] max-w-full shrink-0" : ""}>
        <VoximplantParticipantTile
          stream={tile.participant.stream}
          muted={tile.isLocal}
          title={tile.isLocal ? `${tile.rosterEntry.displayName} (${t("common.you")})` : tile.rosterEntry.displayName}
          subtitle={subtitle}
          micState={tileMicState}
          micStateLabel={tileMicStateLabel}
          micStateHint={tileMicStateHint}
          micLevel={tile.isLocal ? micLevel : undefined}
          isSpeaking={
            tile.isLocal
              ? isSpeaking
              : // Remote tile: highlight when the matched remote endpoint is
                // producing audio. Muted/disconnected remotes report ~0 level.
                (remoteSpeakingById[tile.participant.id] ?? false)
          }
        />
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-testid="vox-layout-root">
      <VoximplantRemoteSpeakingActivityTracker
        sessionId={sessionId}
        roomAuth={roomAuth}
        connectionId={connectionId}
        enabled={joined && !staleConnection && remoteTelemetryCaptureEnabled}
        debugEnabled={remoteTelemetryDebugEnabled}
        canReportRemoteTelemetry={canReportRemoteTelemetry}
        recordingStatus={recordingStatus}
        audioProcessingEnabled={audioProcessingEnabled}
        targets={remoteTelemetryTargets}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <RoleSection title={t("room.observersSection")} testId="vox-zone-observers">
          {observerTiles.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2 pb-1" data-testid="vox-observer-row">
              {observerTiles.map((tile) => renderRosterTile(tile, { observerCompact: true }))}
            </div>
          ) : (
            <div
              className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-1 text-xs text-slate-300"
              data-testid="vox-observers-empty-state"
            >
              {t("room.observersNotConnected")}
            </div>
          )}
        </RoleSection>

        <div
          className="hidden min-h-0 flex-1 gap-2 lg:grid lg:grid-cols-[38%_24%_38%]"
          data-testid="vox-zone-main-desktop"
        >
          <RoleSection title={t("room.participantA")} testId="vox-zone-participant-a" className="min-h-0">
            {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantAEmpty")} />}
          </RoleSection>

          <div className="flex min-h-0 flex-col gap-2" data-testid="vox-zone-center">
            <RoleSection title={t("room.timer")} testId="vox-zone-timer" className="shrink-0">
              <RoomTimerPanel controlState={controlState} />
            </RoleSection>
            <RoleSection title={t("room.facilitator")} testId="vox-zone-facilitator" className="min-h-0 flex-1">
              {facilitatorTiles.length > 0
                ? facilitatorTiles.map((tile) => renderRosterTile(tile))
                : <NoVideoPlaceholder message={t("room.slotFacilitatorEmpty")} />}
            </RoleSection>
          </div>

          <RoleSection title={t("room.participantB")} testId="vox-zone-participant-b" className="min-h-0">
            {participantBTiles[0] ? renderRosterTile(participantBTiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantBEmpty")} />}
          </RoleSection>
        </div>

        <div className="space-y-2 overflow-auto lg:hidden" data-testid="vox-zone-main-mobile">
          <RoleSection title={t("room.timer")} testId="vox-zone-timer-mobile">
            <RoomTimerPanel controlState={controlState} />
          </RoleSection>
          <RoleSection title={t("room.participants")} testId="vox-zone-participants-mobile">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantAEmpty")} />}
              {participantBTiles[0] ? renderRosterTile(participantBTiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantBEmpty")} />}
            </div>
          </RoleSection>
          <RoleSection title={t("room.facilitator")} testId="vox-zone-facilitator-mobile">
            {facilitatorTiles.length > 0
              ? facilitatorTiles.map((tile) => renderRosterTile(tile))
              : <NoVideoPlaceholder message={t("room.slotFacilitatorEmpty")} />}
          </RoleSection>
        </div>

      </div>
    </section>
  );
}
