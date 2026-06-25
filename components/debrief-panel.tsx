"use client";

import { SessionPostProcessingPanel } from "@/components/session-post-processing-panel";
import type { RoomAuthToken } from "@/lib/room-auth";
import { useI18n } from "@/lib/i18n/useI18n";

type DebriefPanelProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  participantType: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  eventLobbyUrl: string | null | undefined;
};

export function DebriefPanel({
  sessionId,
  roomAuth,
  participantType,
  eventLobbyUrl,
}: DebriefPanelProps) {
  const { t } = useI18n();

  // Derive joinToken for SessionPostProcessingPanel (guest flow only).
  // For account mode, SessionPostProcessingPanel uses materialsUrl from roomAuth.
  const joinTokenForPanel =
    roomAuth.type === "joinToken" ? roomAuth.value : null;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto bg-slate-900 p-4 text-slate-100"
      data-testid="debrief-panel"
    >
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-50" data-testid="debrief-title">
          {t("room.debriefTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-400" data-testid="debrief-message">
          {t("room.debriefMessage")}
        </p>
      </div>

      {joinTokenForPanel ? (
        <SessionPostProcessingPanel
          sessionId={sessionId}
          joinToken={joinTokenForPanel}
          variant="sidebar"
          participantType={participantType}
          showNavigation={participantType === "FACILITATOR"}
          eventLobbyUrl={eventLobbyUrl}
        />
      ) : (
        <p className="text-sm text-slate-400">{t("room.debriefMessage")}</p>
      )}
    </div>
  );
}
