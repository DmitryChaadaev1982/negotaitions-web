"use client";

import {
  ParticipantTile,
  useLocalParticipant,
  useRemoteParticipants,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import { ParticipantType } from "@/app/generated/prisma/enums";
import { RoomTimerPanel } from "@/components/room-timer-panel";
import type { ControlState } from "@/lib/negotiation-control";
import { useI18n } from "@/lib/i18n/useI18n";
import { parseLiveKitParticipantMetadata } from "@/lib/livekit-participant-metadata";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";

type LayoutParticipant = SessionRosterEntry & {
  livekitParticipant: Participant | null;
};

type StructuredVideoLayoutProps = {
  roster: SessionRosterEntry[];
  controlState: ControlState;
  participantType: ParticipantType;
};

type TileSizes = {
  participant: number;
  observer: number;
  facilitator: number;
  observerRowHeight: number;
};

const TILE_GAP_PX = 8;
const LAYOUT_PADDING_PX = 16;
const TIMER_HEIGHT_PX = 88;
const MIN_TILE_HEIGHT_PX = 80;
const OBSERVER_SCALE = 0.55;
const FACILITATOR_SCALE = 0.75;

/** Height:width = 3:4 */
function tileWidth(height: number) {
  return Math.round((height * 4) / 3);
}

function computeTileSizes(
  width: number,
  height: number,
  leftCount: number,
  rightCount: number,
  observerCount: number,
): TileSizes {
  const innerWidth = Math.max(width - LAYOUT_PADDING_PX, 0);
  const innerHeight = Math.max(height - LAYOUT_PADDING_PX, 0);
  const maxPerSide = Math.max(leftCount, rightCount, 1);

  // Column width ratio: sides 1.2, center 0.9
  const sideColumnWidth = (innerWidth * 1.2) / 3.3;
  const participantHeightFromWidth = (sideColumnWidth * 3) / 4;

  const computeParticipantHeight = (tableHeight: number) => {
    const verticalGaps = TILE_GAP_PX * Math.max(maxPerSide - 1, 0);
    const fromHeight = (tableHeight - verticalGaps) / maxPerSide;
    return Math.max(
      MIN_TILE_HEIGHT_PX,
      Math.min(fromHeight, participantHeightFromWidth),
    );
  };

  if (observerCount === 0) {
    const participant = computeParticipantHeight(innerHeight);
    const facilitatorArea = innerHeight - TIMER_HEIGHT_PX - TILE_GAP_PX;
    const facilitator = Math.max(
      MIN_TILE_HEIGHT_PX * FACILITATOR_SCALE,
      Math.min(participant * FACILITATOR_SCALE, facilitatorArea),
    );

    return {
      participant,
      observer: participant * OBSERVER_SCALE,
      facilitator,
      observerRowHeight: 0,
    };
  }

  let participant = computeParticipantHeight(innerHeight);
  let observer = participant * OBSERVER_SCALE;
  let observerRowHeight = observer + TILE_GAP_PX;
  let tableHeight = innerHeight - observerRowHeight - TILE_GAP_PX;

  participant = computeParticipantHeight(tableHeight);
  observer = participant * OBSERVER_SCALE;
  observerRowHeight = observer + TILE_GAP_PX;
  tableHeight = innerHeight - observerRowHeight - TILE_GAP_PX;
  participant = computeParticipantHeight(tableHeight);

  const facilitatorArea = tableHeight - TIMER_HEIGHT_PX - TILE_GAP_PX;
  const facilitator = Math.max(
    MIN_TILE_HEIGHT_PX * FACILITATOR_SCALE,
    Math.min(participant * FACILITATOR_SCALE, facilitatorArea),
  );

  return {
    participant,
    observer: participant * OBSERVER_SCALE,
    facilitator,
    observerRowHeight,
  };
}

function useVideoTileSizes(
  leftCount: number,
  rightCount: number,
  observerCount: number,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<TileSizes>({
    participant: MIN_TILE_HEIGHT_PX,
    observer: MIN_TILE_HEIGHT_PX * OBSERVER_SCALE,
    facilitator: MIN_TILE_HEIGHT_PX * FACILITATOR_SCALE,
    observerRowHeight: MIN_TILE_HEIGHT_PX * OBSERVER_SCALE + TILE_GAP_PX,
  });
  const [layoutGeneration, setLayoutGeneration] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateSizes = () => {
      const rect = element.getBoundingClientRect();
      setSizes(
        computeTileSizes(
          rect.width,
          rect.height,
          leftCount,
          rightCount,
          observerCount,
        ),
      );
      setLayoutGeneration((value) => value + 1);
    };

    updateSizes();

    const observer = new ResizeObserver(() => {
      updateSizes();
    });

    observer.observe(element);
    window.addEventListener("resize", updateSizes);
    document.addEventListener("visibilitychange", updateSizes);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSizes);
      document.removeEventListener("visibilitychange", updateSizes);
    };
  }, [leftCount, observerCount, rightCount]);

  return { containerRef, sizes, layoutGeneration };
}

function SizedVideoFrame({
  heightPx,
  children,
}: {
  heightPx: number;
  children: React.ReactNode;
}) {
  const widthPx = tileWidth(heightPx);

  return (
    <div className="flex shrink-0 items-center justify-center">
      <div
        className="overflow-hidden"
        style={{ width: widthPx, height: heightPx }}
      >
        {children}
      </div>
    </div>
  );
}

function CenterTimer({ controlState }: { controlState: ControlState }) {
  return <RoomTimerPanel controlState={controlState} />;
}

function RoleVideoTile({
  layoutParticipant,
  isSpeaking,
  trackRef,
  layoutGeneration,
}: {
  layoutParticipant: LayoutParticipant;
  isSpeaking: boolean;
  trackRef?: TrackReferenceOrPlaceholder;
  layoutGeneration: number;
}) {
  const { t } = useI18n();
  const { livekitParticipant, displayName, caseRoleName } = layoutParticipant;

  const placeholderLabel =
    layoutParticipant.participantType === ParticipantType.OBSERVER
      ? t("participantType.OBSERVER")
      : layoutParticipant.participantType === ParticipantType.FACILITATOR
        ? t("participantType.FACILITATOR")
        : t("participantType.PARTICIPANT");

  if (!livekitParticipant || !trackRef) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-600/80 bg-slate-800/60 p-2 sm:rounded-2xl">
        <span className="truncate text-xs font-medium text-white/70 sm:text-sm">
          {displayName}
        </span>
        {caseRoleName ? (
          <span className="mt-0.5 truncate text-[10px] text-white/50 sm:text-xs">
            {caseRoleName}
          </span>
        ) : (
          <span className="mt-0.5 text-[10px] text-white/40 sm:text-xs">
            {placeholderLabel}
          </span>
        )}
        <span className="mt-1 text-[10px] text-white/30 sm:text-xs">
          {livekitParticipant
            ? t("room.connectingVideo")
            : t("room.waitingToJoin")}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-slate-900 shadow-lg transition-shadow sm:rounded-2xl ${
        isSpeaking ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-950" : ""
      }`}
    >
      <ParticipantTile
        key={`${layoutParticipant.id}-${layoutGeneration}`}
        trackRef={trackRef}
        className="h-full w-full [&_.lk-participant-media-video]:h-full [&_.lk-participant-media-video]:w-full [&_.lk-participant-media-video]:object-cover [&_.lk-participant-metadata]:hidden [&_.lk-participant-placeholder]:h-full [&_.lk-participant-placeholder]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white sm:text-sm">
            {displayName}
          </p>
          {caseRoleName ? (
            <p className="truncate text-[10px] text-white/75 sm:text-xs">
              {caseRoleName}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-black/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/70 sm:px-2 sm:text-[10px]">
          {placeholderLabel}
        </span>
      </div>
    </div>
  );
}

function getSessionParticipantId(participant: Participant) {
  const metadata = parseLiveKitParticipantMetadata(participant.metadata);

  return metadata?.participantId ?? participant.identity;
}

function useLayoutParticipants(roster: SessionRosterEntry[]): LayoutParticipant[] {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  return useMemo(() => {
    const connected = new Map<string, Participant>();

    for (const participant of remoteParticipants) {
      connected.set(getSessionParticipantId(participant), participant);
    }

    if (localParticipant) {
      connected.set(getSessionParticipantId(localParticipant), localParticipant);
    }

    const rosterIds = new Set(roster.map((entry) => entry.id));
    const layoutEntries: LayoutParticipant[] = roster.map((entry) => ({
      ...entry,
      livekitParticipant: connected.get(entry.id) ?? null,
    }));

    for (const participant of connected.values()) {
      const participantId = getSessionParticipantId(participant);

      if (rosterIds.has(participantId)) {
        continue;
      }

      const metadata = parseLiveKitParticipantMetadata(participant.metadata);
      layoutEntries.push({
        id: participantId,
        displayName: participant.name || participant.identity,
        participantType:
          metadata?.participantType ?? ParticipantType.PARTICIPANT,
        caseRoleName: metadata?.caseRoleName ?? null,
        userId: null,
        voximplantProviderUsername: null,
        joinedAt: null,
        lastSeenAt: null,
        livekitParticipant: participant,
      });
    }

    return layoutEntries;
  }, [localParticipant, remoteParticipants, roster]);
}

function splitParticipants(participants: LayoutParticipant[]) {
  const left: LayoutParticipant[] = [];
  const right: LayoutParticipant[] = [];

  participants.forEach((participant, index) => {
    if (index % 2 === 0) {
      left.push(participant);
    } else {
      right.push(participant);
    }
  });

  return { left, right };
}

function ParticipantColumn({
  participants,
  speakingIds,
  trackRefByIdentity,
  layoutGeneration,
  tileHeight,
}: {
  participants: LayoutParticipant[];
  speakingIds: Set<string>;
  trackRefByIdentity: Map<string, TrackReferenceOrPlaceholder>;
  layoutGeneration: number;
  tileHeight: number;
}) {
  if (participants.length === 0) {
    return <div className="h-full min-h-0 min-w-0" />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-2">
      {participants.map((participant) => (
        <SizedVideoFrame key={participant.id} heightPx={tileHeight}>
          <RoleVideoTile
            layoutParticipant={participant}
            isSpeaking={speakingIds.has(participant.id)}
            trackRef={trackRefByIdentity.get(participant.id)}
            layoutGeneration={layoutGeneration}
          />
        </SizedVideoFrame>
      ))}
    </div>
  );
}

export function StructuredVideoLayout({
  roster,
  controlState,
  participantType,
}: StructuredVideoLayoutProps) {
  const { t } = useI18n();
  const layoutParticipants = useLayoutParticipants(roster);
  const cameraTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  const trackRefByIdentity = useMemo(() => {
    const map = new Map<string, TrackReferenceOrPlaceholder>();

    for (const trackRef of cameraTracks) {
      map.set(getSessionParticipantId(trackRef.participant), trackRef);
    }

    return map;
  }, [cameraTracks]);

  const speakingParticipants = useSpeakingParticipants();
  const speakingIds = useMemo(
    () =>
      new Set(
        speakingParticipants.map((participant) =>
          getSessionParticipantId(participant),
        ),
      ),
    [speakingParticipants],
  );

  const observers = layoutParticipants.filter(
    (participant) => participant.participantType === ParticipantType.OBSERVER,
  );
  const negotiators = layoutParticipants.filter(
    (participant) => participant.participantType === ParticipantType.PARTICIPANT,
  );
  const facilitators = layoutParticipants.filter(
    (participant) => participant.participantType === ParticipantType.FACILITATOR,
  );

  const facilitator = facilitators[0] ?? null;
  const { left: leftParticipants, right: rightParticipants } =
    splitParticipants(negotiators);

  const { containerRef, sizes, layoutGeneration } = useVideoTileSizes(
    leftParticipants.length,
    rightParticipants.length,
    observers.length,
  );

  const layoutControlState = {
    ...controlState,
    participantType,
  };

  const hasObservers = observers.length > 0;
  const centerColumnWidth = tileWidth(sizes.facilitator);

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-col overflow-hidden p-2 sm:p-3"
      style={{ gap: TILE_GAP_PX }}
    >
      {hasObservers ? (
        <section
          aria-label={t("room.observersSection")}
          className="flex shrink-0 items-center justify-center overflow-hidden"
          style={{
            height: sizes.observerRowHeight,
            gap: TILE_GAP_PX,
          }}
        >
          {observers.map((observer) => (
            <SizedVideoFrame key={observer.id} heightPx={sizes.observer}>
              <RoleVideoTile
                layoutParticipant={observer}
                isSpeaking={speakingIds.has(observer.id)}
                trackRef={trackRefByIdentity.get(observer.id)}
                layoutGeneration={layoutGeneration}
              />
            </SizedVideoFrame>
          ))}
        </section>
      ) : null}

      <section
        aria-label={t("room.negotiationTableSection")}
        className="grid min-h-0 flex-1 items-center overflow-hidden"
        style={{
          gap: TILE_GAP_PX,
          gridTemplateColumns: `minmax(0, 1.2fr) ${centerColumnWidth}px minmax(0, 1.2fr)`,
        }}
      >
        <ParticipantColumn
          participants={leftParticipants}
          speakingIds={speakingIds}
          trackRefByIdentity={trackRefByIdentity}
          layoutGeneration={layoutGeneration}
          tileHeight={sizes.participant}
        />

        <div
          className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden"
          style={{ width: centerColumnWidth, gap: TILE_GAP_PX }}
        >
          <CenterTimer controlState={layoutControlState} />
          {facilitator ? (
            <SizedVideoFrame heightPx={sizes.facilitator}>
              <RoleVideoTile
                layoutParticipant={facilitator}
                isSpeaking={speakingIds.has(facilitator.id)}
                trackRef={trackRefByIdentity.get(facilitator.id)}
                layoutGeneration={layoutGeneration}
              />
            </SizedVideoFrame>
          ) : null}
        </div>

        <ParticipantColumn
          participants={rightParticipants}
          speakingIds={speakingIds}
          trackRefByIdentity={trackRefByIdentity}
          layoutGeneration={layoutGeneration}
          tileHeight={sizes.participant}
        />
      </section>
    </div>
  );
}
