"use client";

import "@livekit/components-styles";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
} from "@livekit/components-react";
import { ParticipantType } from "@/app/generated/prisma/enums";
import { FacilitatorRoomControls } from "@/components/facilitator-room-controls";
import { MicEnforcement } from "@/components/mic-enforcement";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import { RestrictedControlBar } from "@/components/restricted-control-bar";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { StructuredVideoLayout } from "@/components/structured-video-layout";
import type { ControlState } from "@/lib/negotiation-control";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import Link from "next/link";
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
  const notesConfig =
    sidebar.participantType === ParticipantType.PARTICIPANT
      ? {
          title: "Preparation",
          description:
            "Capture your negotiation plan, opening moves, and priorities during the session.",
          placeholder: "Your strategy, target outcomes, walk-away points...",
        }
      : sidebar.participantType === ParticipantType.OBSERVER
        ? {
            title: "Observer notes",
            description:
              "Record your observations and notes for this session.",
            placeholder: "Record observations about the negotiation...",
          }
        : {
            title: "Facilitator notes",
            description:
              "Capture guidance, debrief points, and session observations.",
            placeholder: "Session guidance, debrief points, observations...",
          };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Session panel</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {sidebar.displayName} · {sidebar.participantType}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div className="space-y-4">
        {sidebar.participantType === ParticipantType.PARTICIPANT &&
        sidebar.caseRole ? (
          <RoleBriefingCard
            title={`Your role: ${sidebar.caseRole.name}`}
            subtitle="Private briefing — visible only to you."
            role={sidebar.caseRole}
          />
        ) : null}

        {sidebar.participantType === ParticipantType.FACILITATOR ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Facilitator panel
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Participant role briefings for this session.
              </p>
            </div>
            {sidebar.facilitatorBriefings.length === 0 ? (
              <p className="text-sm text-slate-600">
                No participant roles assigned yet.
              </p>
            ) : (
              sidebar.facilitatorBriefings.map((briefing) => (
                <RoleBriefingCard
                  key={`${briefing.displayName}-${briefing.role.name}`}
                  title={`${briefing.displayName} — ${briefing.role.name}`}
                  subtitle="Private briefing for this participant."
                  role={briefing.role}
                />
              ))
            )}
          </div>
        ) : null}

        {sidebar.participantType === ParticipantType.OBSERVER ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Observer notes
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Record observations during the live session.
            </p>
          </div>
        ) : null}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">
            {notesConfig.title}
          </h3>
          <ParticipantNotesPanel
            joinToken={joinToken}
            initialNotes={sidebar.notes}
            description={notesConfig.description}
            placeholder={notesConfig.placeholder}
          />
        </div>
        </div>
      </div>
    </aside>
  );
}

function LeaveRoomButton({ joinToken }: { joinToken: string }) {
  const router = useRouter();
  const room = useRoomContext();

  const handleLeave = useCallback(async () => {
    await room.disconnect();
    router.push(`/join/${joinToken}`);
  }, [joinToken, room, router]);

  return (
    <button
      type="button"
      onClick={() => void handleLeave()}
      className="inline-flex items-center justify-center rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
    >
      Leave Room
    </button>
  );
}

function ConnectedRoom({
  joinToken,
  sessionId,
  tokenResponse,
  sidebar,
  controlState,
  onControlStateChange,
}: {
  joinToken: string;
  sessionId: string;
  tokenResponse: LiveKitTokenResponse;
  sidebar: RoomSidebarData;
  controlState: ControlState;
  onControlStateChange: (state: ControlState) => void;
}) {
  const router = useRouter();

  const handleDisconnected = useCallback(() => {
    router.push(`/join/${joinToken}`);
  }, [joinToken, router]);

  return (
    <LiveKitRoom
      token={tokenResponse.token}
      serverUrl={tokenResponse.serverUrl}
      connect
      audio
      video
      onDisconnected={handleDisconnected}
      data-lk-theme="default"
      className="flex h-dvh flex-col overflow-hidden bg-slate-950"
    >
      <RoomAudioRenderer />
      <MicEnforcement controlState={controlState} />
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{sidebar.sessionTitle}</p>
          <p className="truncate text-xs text-slate-400">
            {tokenResponse.displayName} · {tokenResponse.participantType}
          </p>
        </div>
        <LeaveRoomButton joinToken={joinToken} />
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden bg-[#0f172a]">
            <StructuredVideoLayout
              roster={sidebar.roster}
              controlState={controlState}
              participantType={tokenResponse.participantType}
            />
          </div>

          {controlState.canControl ? (
            <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-4 py-3">
              <FacilitatorRoomControls
                sessionId={sessionId}
                joinToken={joinToken}
                controlState={controlState}
                onControlStateChange={onControlStateChange}
              />
            </div>
          ) : null}

          <div className="shrink-0 border-t border-slate-800 bg-slate-900">
            <RestrictedControlBar micAllowed={controlState.micAllowed} />
          </div>
        </div>

        <div className="hidden h-full min-h-0 w-96 shrink-0 overflow-hidden lg:block">
          <RoomSidebar joinToken={joinToken} sidebar={sidebar} />
        </div>
      </div>
    </LiveKitRoom>
  );
}

export default function VideoRoomPage({
  sessionId,
  joinToken,
}: VideoRoomPageProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenResponse, setTokenResponse] = useState<LiveKitTokenResponse | null>(
    null,
  );
  const [sidebar, setSidebar] = useState<RoomSidebarData | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);

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
          | ControlState
          | { error?: string };

        if (!tokenResult.ok) {
          throw new Error(
            "error" in tokenPayload && tokenPayload.error
              ? tokenPayload.error
              : "Unable to join the video room.",
          );
        }

        if (!sidebarResult.ok) {
          throw new Error(
            "error" in sidebarPayload && sidebarPayload.error
              ? sidebarPayload.error
              : "Unable to load session panel.",
          );
        }

        if (!controlResult.ok) {
          throw new Error(
            "error" in controlPayload && controlPayload.error
              ? controlPayload.error
              : "Unable to load negotiation state.",
          );
        }

        if (
          !("token" in tokenPayload) ||
          tokenPayload.sessionId !== sessionId
        ) {
          throw new Error("This join link does not match the session room.");
        }

        if (!cancelled) {
          setTokenResponse(tokenPayload);
          setSidebar(sidebarPayload as RoomSidebarData);
          setControlState(controlPayload as ControlState);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to join the video room.",
          );
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
  }, [joinToken, sessionId]);

  useEffect(() => {
    if (isLoading || error) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/sessions/${sessionId}/control-state?joinToken=${encodeURIComponent(joinToken)}`,
        );

        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as ControlState;
        setControlState(nextState);
      } catch {
        // Ignore transient polling errors.
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [error, isLoading, joinToken, sessionId]);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-white">
        <p className="text-sm text-slate-300">Connecting to video room...</p>
      </div>
    );
  }

  if (error || !tokenResponse || !sidebar || !controlState) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Unable to join video room
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-600">
            {error ?? "Something went wrong while connecting."}
          </p>
        </div>
        <Link
          href={`/join/${joinToken}`}
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Back to session briefing
        </Link>
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
      onControlStateChange={setControlState}
    />
  );
}
