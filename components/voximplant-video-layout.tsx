"use client";

import { ParticipantType } from "@/app/generated/prisma/enums";
import { VoximplantRemoteSpeakingActivityTracker } from "@/components/voximplant-remote-speaking-activity-tracker";
import { RoomTimerPanel } from "@/components/room-timer-panel";
import { VoximplantParticipantTile } from "@/components/voximplant-participant-tile";
import { useI18n } from "@/lib/i18n/useI18n";
import type { ControlState } from "@/lib/negotiation-control";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import { REMOTE_SPEAKING_LEVEL_THRESHOLD } from "@/lib/telemetry/speaking-activity-config";
import { useRemoteSpeaking } from "@/lib/voximplant/remote-speaking";
import {
  resolveRosterVisualRoles,
  shouldRenderObserverRailTile,
} from "@/lib/voximplant/room-layout-model";
import {
  buildParticipantReconnectMediaState,
  canShowSpeakingHighlight,
  normalizeParticipantPresenceMedia,
  type ParticipantReconnectMediaState,
  type ParticipantPresenceMediaModel,
} from "@/lib/voximplant/participant-presence-media-model";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { KeyboardEvent, ReactNode, WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  mediaModel: ParticipantPresenceMediaModel;
  reconnectMediaState: ParticipantReconnectMediaState;
  isLocal: boolean;
};

const OBSERVER_RAIL_SCROLL_TOLERANCE_PX = 2;

type ObserverRailScrollState = {
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
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

type RemoteSpeakingParticipantInput = VoxTileParticipant & {
  microphoneEnabled?: boolean;
  generation?: string | number | null;
};

export function buildRemoteSpeakingInput(remoteParticipants: RemoteSpeakingParticipantInput[]) {
  return remoteParticipants.map((participant) => ({
    id: participant.id,
    stream: participant.audioStream ?? participant.stream,
    microphoneEnabled: participant.microphoneEnabled,
    generation: participant.generation,
  }));
}

function getMediaStreamId(stream: MediaStream | null | undefined): string | null {
  return typeof stream?.id === "string" ? stream.id : null;
}

export default function VoximplantVideoLayout({
  localParticipant,
  remoteParticipants,
  roster,
  currentParticipantId,
  controlState,
  isCameraOn,
  isMicMuted,
  localMicSystemMuted,
  micLevel,
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
  isCameraOn?: boolean;
  isMicMuted?: boolean;
  localMicSystemMuted?: boolean;
  micLevel?: number;
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
    !isMicMuted &&
    !localMicSystemMuted &&
    micLevel !== undefined &&
    micLevel > REMOTE_SPEAKING_LEVEL_THRESHOLD;

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
      const roleLabel =
        visual.zone === "facilitator"
          ? t("room.facilitator")
          : visual.zone === "participant_a"
            ? t("room.participantA")
            : visual.zone === "participant_b"
              ? t("room.participantB")
              : visual.zone === "observer"
                ? t("room.observer")
                : t("room.unknownRole");
      const isLogicallyAbsent = entry.isLogicallyPresent === false;
      const mediaModel = normalizeParticipantPresenceMedia({
        displayName: entry.displayName,
        displayRole: roleLabel,
        // Logical room presence (SessionRoomConnection) is authoritative for who
        // is currently in the room; provider endpoint media remains authoritative
        // for actual A/V streams of those present users.
        connectedSignal: isLocal ? joined : Boolean(matchedRemote) && !isLogicallyAbsent,
        allowConnectedWithoutMediaTile: true,
        lastSeenAt: entry.lastSeenAt ?? null,
        videoStream: participant.stream,
        audioStream: isLocal ? participant.audioStream : (participant.audioStream ?? participant.stream),
        micSignal: isLocal
          ? localMicSystemMuted
            ? "off"
            : isMicMuted
              ? "off"
              : "on"
          : entry.micEnabled === null || entry.micEnabled === undefined
            ? undefined
            : entry.micEnabled
              ? "on"
              : "off",
        cameraSignal: isLocal
          ? (isCameraOn ? "on" : "off")
          : entry.cameraEnabled === null || entry.cameraEnabled === undefined
            ? undefined
            : entry.cameraEnabled
              ? "on"
              : "off",
      });
      const reconnectMediaState = buildParticipantReconnectMediaState({
        userId: entry.userId,
        role: entry.participantType,
        connectionGeneration: entry.logicalConnectionId ?? null,
        providerEndpointId: matchedRemote?.id ?? null,
        streamId: getMediaStreamId(participant.audioStream ?? participant.stream),
        audioStream: isLocal
          ? participant.audioStream
          : (participant.audioStream ?? participant.stream),
        microphoneEnabled:
          mediaModel.connectionStatus === "connected" && mediaModel.micStatus !== "unknown"
            ? mediaModel.micStatus === "on"
            : null,
        cameraEnabled:
          mediaModel.connectionStatus === "connected" && mediaModel.cameraStatus !== "unknown"
            ? mediaModel.cameraStatus === "on"
            : null,
        lastMediaUpdateAt: entry.mediaStatusUpdatedAt ?? null,
      });
      return {
        rosterEntry: entry,
        participant,
        matchedRemoteId: matchedRemote?.id ?? null,
        zone: visual.zone,
        mediaModel,
        reconnectMediaState,
        isLocal,
      };
    });
  }, [
    currentParticipantId,
    isCameraOn,
    isMicMuted,
    joined,
    localMicSystemMuted,
    localParticipant,
    remoteByVoxUsername,
    roster,
    t,
    visualRolesByRosterId,
  ]);

  const activeTiles = resolvedRosterTiles.filter((tile) => tile.mediaModel.shouldRenderActiveTile);
  const facilitatorTiles = activeTiles.filter((tile) => tile.zone === "facilitator");
  // Speaking meters are bound after roster/provider merge so they inherit the
  // same reconnect-generation and mic-state contract as the rendered tiles.
  const remoteSpeakingInput = useMemo(
    () =>
      resolvedRosterTiles
        .filter((tile) => !tile.isLocal)
        .map((tile) => ({
          id: tile.participant.id,
          stream: tile.participant.audioStream ?? tile.participant.stream,
          microphoneEnabled: tile.reconnectMediaState.microphoneEnabled === true,
          generation: [
            tile.rosterEntry.id,
            tile.reconnectMediaState.connectionGeneration ?? "unknown-connection",
            tile.reconnectMediaState.providerEndpointId ?? "unknown-endpoint",
            tile.reconnectMediaState.streamId ?? "unknown-stream",
            tile.reconnectMediaState.lastMediaUpdateAt ?? "unknown-media-time",
          ].join(":"),
        })),
    [resolvedRosterTiles],
  );
  const remoteSpeakingById = useRemoteSpeaking(remoteSpeakingInput);
  const observerTiles = useMemo(() => {
    // Stable roster order is the visual order. Camera, microphone, connection,
    // and speaking state are represented within each tile without reordering.
    return resolvedRosterTiles.filter((tile) =>
      shouldRenderObserverRailTile({
        entry: tile.rosterEntry,
        zone: tile.zone,
        hasActiveMediaPresence: tile.mediaModel.shouldRenderActiveTile,
      }),
    );
  }, [resolvedRosterTiles]);
  const participantATiles = activeTiles.filter((tile) => tile.zone === "participant_a");
  const participantBTiles = activeTiles.filter((tile) => tile.zone === "participant_b");
  const observerRailRef = useRef<HTMLDivElement | null>(null);
  const observerRailContentRef = useRef<HTMLDivElement | null>(null);
  const [observerRailScrollState, setObserverRailScrollState] =
    useState<ObserverRailScrollState>({
      hasOverflow: false,
      canScrollLeft: false,
      canScrollRight: false,
    });
  const updateObserverRailScrollState = useCallback(() => {
    const viewport = observerRailRef.current;
    const content = observerRailContentRef.current;
    if (!viewport || !content) {
      setObserverRailScrollState({
        hasOverflow: false,
        canScrollLeft: false,
        canScrollRight: false,
      });
      return;
    }

    const viewportWidth = viewport.clientWidth;
    const contentWidth = content.getBoundingClientRect().width;
    const hasOverflow =
      contentWidth > viewportWidth + OBSERVER_RAIL_SCROLL_TOLERANCE_PX;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const nextState: ObserverRailScrollState = hasOverflow
      ? {
          hasOverflow: true,
          canScrollLeft: viewport.scrollLeft > OBSERVER_RAIL_SCROLL_TOLERANCE_PX,
          canScrollRight:
            viewport.scrollLeft <
            maxScrollLeft - OBSERVER_RAIL_SCROLL_TOLERANCE_PX,
        }
      : {
          hasOverflow: false,
          canScrollLeft: false,
          canScrollRight: false,
        };

    setObserverRailScrollState((current) =>
      current.hasOverflow === nextState.hasOverflow &&
      current.canScrollLeft === nextState.canScrollLeft &&
      current.canScrollRight === nextState.canScrollRight
        ? current
        : nextState,
    );
  }, []);
  useEffect(() => {
    const viewport = observerRailRef.current;
    const content = observerRailContentRef.current;
    if (!viewport || !content) return;

    const frame = window.requestAnimationFrame(updateObserverRailScrollState);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateObserverRailScrollState);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(content);
    window.addEventListener("resize", updateObserverRailScrollState);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateObserverRailScrollState);
    };
  }, [observerTiles.length, updateObserverRailScrollState]);
  const scrollObserverRail = useCallback((direction: "left" | "right") => {
    const node = observerRailRef.current;
    if (!node) return;
    const delta = Math.max(180, Math.floor(node.clientWidth * 0.75));
    node.scrollBy({
      left: direction === "left" ? -delta : delta,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    window.requestAnimationFrame(updateObserverRailScrollState);
  }, [updateObserverRailScrollState]);
  const handleObserverRailKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const node = observerRailRef.current;
      if (!node) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        scrollObserverRail("left");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        scrollObserverRail("right");
      } else if (event.key === "Home") {
        event.preventDefault();
        node.scrollTo({ left: 0 });
      } else if (event.key === "End") {
        event.preventDefault();
        node.scrollTo({ left: node.scrollWidth });
      }
    },
    [scrollObserverRail],
  );
  const handleObserverRailWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const node = observerRailRef.current;
      if (!node || node.scrollWidth <= node.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const nextLeft = node.scrollLeft + event.deltaY;
      const canScroll =
        (event.deltaY < 0 && node.scrollLeft > 0) ||
        (event.deltaY > 0 && node.scrollLeft < node.scrollWidth - node.clientWidth);
      if (!canScroll) return;
      event.preventDefault();
      node.scrollLeft = nextLeft;
    },
    [],
  );
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

  const renderRosterTile = (
    tile: ResolvedRosterTile,
    options?: { observerCompact?: boolean },
  ) => {
    const subtitle =
      tile.zone === "participant_a" || tile.zone === "participant_b"
        ? (tile.rosterEntry.caseRoleName ?? undefined)
        : tile.zone === "observer"
          ? (tile.rosterEntry.caseRoleName ?? undefined)
          : undefined;
    const micLabel =
      tile.mediaModel.connectionStatus !== "connected"
        ? t("room.notConnected")
        : tile.mediaModel.micStatus === "on"
          ? t("room.mediaMicOn")
          : tile.mediaModel.micStatus === "off"
            ? t("room.mediaMicOff")
            : t("room.unknownMicState");
    const cameraLabel =
      tile.mediaModel.connectionStatus !== "connected"
        ? t("room.notConnected")
        : tile.mediaModel.cameraStatus === "on"
          ? t("room.mediaCameraOn")
          : tile.mediaModel.cameraStatus === "off"
            ? t("room.mediaCameraOff")
            : t("room.mediaCameraOff");
    const connectionLabel =
      tile.mediaModel.connectionStatus === "connected"
        ? t("room.presenceOnline")
        : tile.mediaModel.connectionStatus === "disconnected"
          ? t("room.presenceRecentlyDisconnected")
          : t("room.presenceOffline");
    const observerTileLabel = options?.observerCompact
      ? t("room.observerTileAriaLabel", {
          name: tile.isLocal
            ? `${tile.rosterEntry.displayName} (${t("common.you")})`
            : tile.rosterEntry.displayName,
          connection: connectionLabel,
          mic: micLabel,
          camera: cameraLabel,
        })
      : undefined;
    return (
      <div
        key={tile.rosterEntry.id}
        className={
          options?.observerCompact
            ? "w-40 min-w-0 max-w-full shrink-0 snap-start rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:w-48 lg:w-52"
            : "min-w-0"
        }
        role={options?.observerCompact ? "listitem" : undefined}
        tabIndex={options?.observerCompact ? 0 : undefined}
        aria-label={observerTileLabel}
        data-testid={options?.observerCompact ? "vox-observer-tile" : undefined}
        data-observer-id={options?.observerCompact ? tile.rosterEntry.id : undefined}
      >
        <VoximplantParticipantTile
          stream={tile.participant.stream}
          muted={tile.isLocal}
          title={tile.isLocal ? `${tile.rosterEntry.displayName} (${t("common.you")})` : tile.rosterEntry.displayName}
          subtitle={subtitle}
          connectionStatus={tile.mediaModel.connectionStatus}
          micStatus={tile.mediaModel.micStatus}
          cameraStatus={tile.mediaModel.cameraStatus}
          micLabel={micLabel}
          cameraLabel={cameraLabel}
          micLevel={tile.isLocal ? micLevel : undefined}
          isSpeaking={
            canShowSpeakingHighlight({
              connectionStatus: tile.mediaModel.connectionStatus,
              micStatus: tile.mediaModel.micStatus,
              isSpeaking: tile.isLocal
                ? isSpeaking
                : (remoteSpeakingById[tile.participant.id] ?? false),
            })
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
        <RoleSection
          title={t("room.observerCountLabel", { count: observerTiles.length })}
          testId="vox-zone-observers"
          className="h-[10rem] shrink-0 overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900/45 p-2 sm:h-[11.25rem] lg:h-[11.75rem]"
        >
          {observerTiles.length > 0 ? (
            <div className="relative min-w-0" data-testid="vox-observer-rail-shell">
              {observerRailScrollState.hasOverflow &&
              observerRailScrollState.canScrollLeft ? (
                <button
                  type="button"
                  className="absolute left-1 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-600/80 bg-slate-950/80 text-xs text-slate-200 shadow-lg hover:border-cyan-400/60 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  aria-label={t("room.scrollObserversLeft")}
                  onClick={(event) => {
                    event.preventDefault();
                    scrollObserverRail("left");
                  }}
                  data-testid="vox-observer-scroll-left"
                >
                  ←
                </button>
              ) : null}
              <div
                ref={observerRailRef}
                className="flex min-w-0 snap-x overflow-x-auto overflow-y-hidden overscroll-x-contain pb-3 [scrollbar-color:rgba(148,163,184,0.65)_rgba(15,23,42,0.35)] [scrollbar-width:thin]"
                data-testid="vox-observer-row"
                role="list"
                tabIndex={0}
                aria-label={t("room.observerRailRegionLabel", {
                  count: observerTiles.length,
                })}
                onKeyDown={handleObserverRailKeyDown}
                onScroll={updateObserverRailScrollState}
                onWheel={handleObserverRailWheel}
              >
                <div
                  ref={observerRailContentRef}
                  className={`flex w-max flex-none gap-2 ${
                    observerRailScrollState.hasOverflow ? "mx-0" : "mx-auto"
                  }`}
                  data-testid="vox-observer-content"
                >
                  {observerTiles.map((tile) =>
                    renderRosterTile(tile, { observerCompact: true }),
                  )}
                </div>
              </div>
              {observerRailScrollState.hasOverflow &&
              observerRailScrollState.canScrollRight ? (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-600/80 bg-slate-950/80 text-xs text-slate-200 shadow-lg hover:border-cyan-400/60 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  aria-label={t("room.scrollObserversRight")}
                  onClick={(event) => {
                    event.preventDefault();
                    scrollObserverRail("right");
                  }}
                  data-testid="vox-observer-scroll-right"
                >
                  →
                </button>
              ) : null}
            </div>
          ) : (
            <div
              className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-300"
              data-testid="vox-observers-empty-state"
            >
              {t("room.observersNotConnected")}
            </div>
          )}
        </RoleSection>

        <div
          className="hidden min-h-0 flex-1 gap-2 lg:grid lg:grid-cols-[minmax(0,38fr)_minmax(0,24fr)_minmax(0,38fr)]"
          data-testid="vox-zone-main-desktop"
        >
          <RoleSection title={t("room.participantA")} testId="vox-zone-participant-a" className="min-h-0 min-w-0">
            {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantAEmpty")} />}
          </RoleSection>

          <div className="flex min-h-0 min-w-0 flex-col gap-2" data-testid="vox-zone-center">
            <RoleSection title={t("room.timer")} testId="vox-zone-timer" className="shrink-0">
              <RoomTimerPanel controlState={controlState} />
            </RoleSection>
            <RoleSection title={t("room.facilitator")} testId="vox-zone-facilitator" className="min-h-0 min-w-0 flex-1">
              {facilitatorTiles.length > 0
                ? facilitatorTiles.map((tile) => renderRosterTile(tile))
                : <NoVideoPlaceholder message={t("room.slotFacilitatorEmpty")} />}
            </RoleSection>
          </div>

          <RoleSection title={t("room.participantB")} testId="vox-zone-participant-b" className="min-h-0 min-w-0">
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
