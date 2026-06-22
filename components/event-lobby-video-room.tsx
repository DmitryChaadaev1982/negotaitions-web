"use client";

import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { isTrackReference } from "@livekit/components-core";
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import { LiveKitReconnectBanner } from "@/components/livekit-reconnect-banner";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

const PARTICIPANT_TILE_CLASS =
  "h-full w-full [&_.lk-participant-media-video]:h-full [&_.lk-participant-media-video]:w-full [&_.lk-participant-media-video]:object-cover [&_.lk-participant-metadata]:hidden [&_.lk-participant-placeholder]:h-full [&_.lk-participant-placeholder]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover";

type EventLobbyVideoRoomProps = {
  token: string;
  serverUrl: string;
  onDeviceWarning?: (message: string | null) => void;
};

function EventLobbyVideoGrid() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );

  const sortedTracks = useMemo(() => {
    return [...tracks].sort((a, b) => {
      const nameA = a.participant.name || a.participant.identity;
      const nameB = b.participant.name || b.participant.identity;
      return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
    });
  }, [tracks]);

  if (sortedTracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-slate-400">
        Waiting for participants…
      </div>
    );
  }

  if (sortedTracks.length <= 4) {
    return (
      <div className="grid h-full min-h-0 auto-rows-fr grid-cols-1 gap-2 p-3 sm:grid-cols-2">
        {sortedTracks.map((trackRef) => (
          <EventLobbyParticipantTile key={trackKey(trackRef)} trackRef={trackRef} />
        ))}
      </div>
    );
  }

  return (
    <div className="lk-grid-layout-wrapper h-full min-h-0 w-full">
      <GridLayout tracks={sortedTracks} className="h-full w-full">
        <ParticipantTile className={PARTICIPANT_TILE_CLASS} />
      </GridLayout>
    </div>
  );
}

function trackKey(trackRef: TrackReferenceOrPlaceholder) {
  if (isTrackReference(trackRef)) {
    return `${trackRef.participant.identity}:${trackRef.source}:${trackRef.publication.trackSid}:${trackRef.publication.isSubscribed}`;
  }

  return `${trackRef.participant.identity}:${trackRef.source}:placeholder`;
}

function EventLobbyParticipantTile({
  trackRef,
}: {
  trackRef: TrackReferenceOrPlaceholder;
}) {
  const displayName = trackRef.participant.name || trackRef.participant.identity;

  return (
    <div className="relative min-h-[160px] overflow-hidden rounded-xl border border-slate-600/30 bg-slate-900 shadow-lg">
      <ParticipantTile trackRef={trackRef} className={PARTICIPANT_TILE_CLASS} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2">
        <p className="truncate text-sm font-medium text-white">{displayName}</p>
      </div>
    </div>
  );
}

const mediaPublishAttemptedForToken = new Set<string>();

/**
 * Publish mic/camera after a stable connection instead of on LiveKitRoom mount.
 * Prevents NotReadableError when React Strict Mode remounts or another tab holds the device.
 */
function EventLobbyMediaPublisher({
  token,
  onDeviceWarning,
}: {
  token: string;
  onDeviceWarning?: (message: string | null) => void;
}) {
  const room = useRoomContext();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!room || attemptedRef.current) {
      return;
    }

    let cancelled = false;

    const enableMedia = async () => {
      if (cancelled || attemptedRef.current) {
        return;
      }

      attemptedRef.current = true;
      await new Promise((resolve) => window.setTimeout(resolve, 600));

      if (cancelled || room.state !== ConnectionState.Connected) {
        attemptedRef.current = false;
        return;
      }

      let warning: string | null = null;

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        warning = "microphoneUnavailable";
      }

      try {
        await room.localParticipant.setCameraEnabled(true);
        mediaPublishAttemptedForToken.add(token);
      } catch {
        warning = warning ?? "cameraUnavailable";
      }

      onDeviceWarning?.(warning);
    };

    if (room.state === ConnectionState.Connected) {
      void enableMedia();
    }

    room.on(RoomEvent.Connected, enableMedia);

    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, enableMedia);
    };
  }, [room, onDeviceWarning, token]);

  return null;
}

export const EventLobbyVideoRoom = memo(function EventLobbyVideoRoom({
  token,
  serverUrl,
  onDeviceWarning,
}: EventLobbyVideoRoomProps) {
  const [room] = useState(
    () =>
      new Room({
        adaptiveStream: true,
        dynacast: true,
      }),
  );

  const connectOptions = useMemo(
    () => ({
      autoSubscribe: true as const,
    }),
    [],
  );

  const handleError = useCallback(
    (error: Error) => {
      if (
        error.name === "NotReadableError" ||
        error.name === "NotAllowedError" ||
        error.message.toLowerCase().includes("device in use")
      ) {
        onDeviceWarning?.("cameraUnavailable");
        return;
      }

      console.warn("[EventLobby] LiveKit error:", error.message);
    },
    [onDeviceWarning],
  );

  const handleDeviceError = useCallback(() => {
    onDeviceWarning?.("cameraUnavailable");
  }, [onDeviceWarning]);

  return (
    <LiveKitRoom
      room={room}
      token={token}
      serverUrl={serverUrl}
      connect
      video={false}
      audio={false}
      connectOptions={connectOptions}
      onError={handleError}
      data-lk-theme="default"
      className="lk-room-container flex h-full min-h-[360px] flex-col bg-[#0f172a]"
    >
      <EventLobbyMediaPublisher token={token} onDeviceWarning={onDeviceWarning} />
      <RoomAudioRenderer />
      <div className="lk-video-conference flex min-h-0 flex-1 flex-col">
        <div className="lk-video-conference-inner relative min-h-0 flex-1 overflow-hidden">
          <LiveKitReconnectBanner onManualRejoin={() => window.location.reload()} />
          <EventLobbyVideoGrid />
        </div>
        <ControlBar
          controls={{
            microphone: true,
            camera: true,
            screenShare: false,
            chat: false,
            settings: false,
            leave: false,
          }}
          onDeviceError={handleDeviceError}
          className="shrink-0 border-t border-slate-800 bg-slate-900"
        />
      </div>
    </LiveKitRoom>
  );
});
