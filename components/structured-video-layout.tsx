"use client";

import {
  ParticipantTile,
  useLocalParticipant,
  useRemoteParticipants,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";
import type { ControlState } from "@/lib/negotiation-control";
import { formatSecondsAsMmSs } from "@/lib/negotiation-duration";
import { parseLiveKitParticipantMetadata } from "@/lib/livekit-participant-metadata";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import type { Participant } from "livekit-client";
import { Track } from "livekit-client";
import { useEffect, useMemo, useState } from "react";

type LayoutParticipant = SessionRosterEntry & {
  livekitParticipant: Participant | null;
};

type StructuredVideoLayoutProps = {
  roster: SessionRosterEntry[];
  controlState: ControlState;
  participantType: ParticipantType;
};

/** Height:width = 3:4 → CSS aspect-ratio width/height = 4/3 */
function AspectVideoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden [container-type:size]">
      <div className="aspect-[4/3] w-[min(100cqw,calc(100cqh*4/3))] max-w-full shrink-0">
        <div className="h-full w-full min-h-0 min-w-0">{children}</div>
      </div>
    </div>
  );
}

function useLayoutGeneration() {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let frameId = 0;

    const scheduleUpdate = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        setGeneration((value) => value + 1);
      });
    };

    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("visibilitychange", scheduleUpdate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("visibilitychange", scheduleUpdate);
    };
  }, []);

  return generation;
}

function getStateMessage(
  negotiationState: NegotiationState,
  participantType: ParticipantType,
) {
  switch (negotiationState) {
    case NegotiationState.LOBBY:
      return {
        title: "Lobby / preparation",
        subtitle: "Waiting for facilitator to start negotiation",
      };
    case NegotiationState.RUNNING:
      return {
        title: "Negotiation in progress",
        subtitle:
          participantType === ParticipantType.PARTICIPANT
            ? null
            : "Your microphone is muted during negotiation",
      };
    case NegotiationState.PAUSED:
      return {
        title: "Paused by facilitator",
        subtitle: null,
      };
    case NegotiationState.FINISHED:
      return {
        title: "Negotiation finished — debrief mode",
        subtitle: null,
      };
    default:
      return { title: "", subtitle: null };
  }
}

function CenterTimer({ controlState }: { controlState: ControlState }) {
  const { negotiationState, remainingSeconds, durationSeconds } = controlState;
  const isExpired =
    negotiationState === NegotiationState.RUNNING && remainingSeconds === 0;

  let timerLabel: string;
  if (negotiationState === NegotiationState.LOBBY) {
    timerLabel = `${formatSecondsAsMmSs(durationSeconds)} — not started`;
  } else if (negotiationState === NegotiationState.FINISHED) {
    timerLabel = formatSecondsAsMmSs(remainingSeconds);
  } else {
    timerLabel = isExpired ? "00:00" : formatSecondsAsMmSs(remainingSeconds);
  }

  const stateMessage = getStateMessage(
    negotiationState,
    controlState.participantType,
  );

  return (
    <div className="w-full shrink-0 rounded-xl bg-slate-800/90 px-3 py-2 text-center shadow-lg sm:rounded-2xl sm:px-4 sm:py-3">
      <div
        className={`font-mono text-2xl font-semibold tabular-nums sm:text-3xl lg:text-4xl ${
          isExpired
            ? "text-rose-400"
            : remainingSeconds <= 60 &&
                negotiationState === NegotiationState.RUNNING
              ? "text-amber-400"
              : negotiationState === NegotiationState.LOBBY
                ? "text-slate-300"
                : "text-emerald-400"
        }`}
      >
        {timerLabel}
      </div>
      <p className="mt-1 text-xs font-medium text-white/90 sm:text-sm">
        {stateMessage.title}
      </p>
      {stateMessage.subtitle ? (
        <p className="mt-0.5 text-[10px] text-white/60 sm:text-xs">
          {stateMessage.subtitle}
        </p>
      ) : null}
    </div>
  );
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
  const { livekitParticipant, displayName, caseRoleName } = layoutParticipant;

  const placeholderLabel =
    layoutParticipant.participantType === ParticipantType.OBSERVER
      ? "Observer"
      : layoutParticipant.participantType === ParticipantType.FACILITATOR
        ? "Facilitator"
        : "Participant";

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
          {livekitParticipant ? "Connecting video..." : "Waiting to join..."}
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

function useLayoutParticipants(roster: SessionRosterEntry[]): LayoutParticipant[] {
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  return useMemo(() => {
    const connected = new Map<string, Participant>();

    if (localParticipant) {
      connected.set(localParticipant.identity, localParticipant);
    }

    for (const participant of remoteParticipants) {
      connected.set(participant.identity, participant);
    }

    const rosterIds = new Set(roster.map((entry) => entry.id));
    const layoutEntries: LayoutParticipant[] = roster.map((entry) => ({
      ...entry,
      livekitParticipant: connected.get(entry.id) ?? null,
    }));

    for (const participant of connected.values()) {
      if (rosterIds.has(participant.identity)) {
        continue;
      }

      const metadata = parseLiveKitParticipantMetadata(participant.metadata);
      layoutEntries.push({
        id: participant.identity,
        displayName: participant.name || participant.identity,
        participantType:
          metadata?.participantType ?? ParticipantType.PARTICIPANT,
        caseRoleName: metadata?.caseRoleName ?? null,
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
}: {
  participants: LayoutParticipant[];
  speakingIds: Set<string>;
  trackRefByIdentity: Map<string, TrackReferenceOrPlaceholder>;
  layoutGeneration: number;
}) {
  if (participants.length === 0) {
    return <div className="h-full min-h-0 min-w-[5rem]" />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-[5rem] flex-col items-stretch justify-center gap-2">
      {participants.map((participant) => (
        <div
          key={participant.id}
          className="flex min-h-[5rem] flex-1 items-center justify-center"
        >
          <AspectVideoFrame>
            <RoleVideoTile
              layoutParticipant={participant}
              isSpeaking={speakingIds.has(participant.id)}
              trackRef={trackRefByIdentity.get(participant.id)}
              layoutGeneration={layoutGeneration}
            />
          </AspectVideoFrame>
        </div>
      ))}
    </div>
  );
}

export function StructuredVideoLayout({
  roster,
  controlState,
  participantType,
}: StructuredVideoLayoutProps) {
  const layoutGeneration = useLayoutGeneration();
  const layoutParticipants = useLayoutParticipants(roster);
  const cameraTracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  const trackRefByIdentity = useMemo(() => {
    const map = new Map<string, TrackReferenceOrPlaceholder>();

    for (const trackRef of cameraTracks) {
      map.set(trackRef.participant.identity, trackRef);
    }

    return map;
  }, [cameraTracks]);

  const speakingParticipants = useSpeakingParticipants();
  const speakingIds = useMemo(
    () => new Set(speakingParticipants.map((participant) => participant.identity)),
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

  const layoutControlState = {
    ...controlState,
    participantType,
  };

  const hasObservers = observers.length > 0;

  return (
    <div
      className={`grid h-full min-h-0 overflow-hidden p-2 sm:p-3 ${
        hasObservers
          ? "grid-rows-[minmax(4rem,22%)_minmax(0,1fr)] gap-2 sm:gap-3"
          : "grid-rows-[minmax(0,1fr)]"
      }`}
    >
      {hasObservers ? (
        <section
          aria-label="Observers"
          className="flex h-full min-h-0 items-stretch justify-center gap-2 overflow-hidden sm:gap-3"
        >
          {observers.map((observer) => (
            <div
              key={observer.id}
              className="flex h-full min-h-0 min-w-[4rem] flex-1 items-center justify-center"
            >
              <AspectVideoFrame>
                <RoleVideoTile
                  layoutParticipant={observer}
                  isSpeaking={speakingIds.has(observer.id)}
                  trackRef={trackRefByIdentity.get(observer.id)}
                  layoutGeneration={layoutGeneration}
                />
              </AspectVideoFrame>
            </div>
          ))}
        </section>
      ) : null}

      <section
        aria-label="Negotiation table"
        className="grid h-full min-h-0 grid-cols-[minmax(5rem,1fr)_minmax(10rem,14rem)_minmax(5rem,1fr)] items-stretch gap-2 overflow-hidden sm:gap-3"
      >
        <ParticipantColumn
          participants={leftParticipants}
          speakingIds={speakingIds}
          trackRefByIdentity={trackRefByIdentity}
          layoutGeneration={layoutGeneration}
        />

        <div className="flex h-full min-h-0 min-w-[10rem] flex-col items-stretch justify-center gap-2 overflow-hidden">
          <CenterTimer controlState={layoutControlState} />
          <div className="flex min-h-[5rem] flex-1 items-center justify-center">
            {facilitator ? (
              <AspectVideoFrame>
                <RoleVideoTile
                  layoutParticipant={facilitator}
                  isSpeaking={speakingIds.has(facilitator.id)}
                  trackRef={trackRefByIdentity.get(facilitator.id)}
                  layoutGeneration={layoutGeneration}
                />
              </AspectVideoFrame>
            ) : (
              <AspectVideoFrame>
                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/30 text-xs text-slate-500 sm:rounded-2xl sm:text-sm">
                  Facilitator
                </div>
              </AspectVideoFrame>
            )}
          </div>
        </div>

        <ParticipantColumn
          participants={rightParticipants}
          speakingIds={speakingIds}
          trackRefByIdentity={trackRefByIdentity}
          layoutGeneration={layoutGeneration}
        />
      </section>
    </div>
  );
}
