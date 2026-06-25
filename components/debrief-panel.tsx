"use client";

import { SessionPostProcessingPanel } from "@/components/session-post-processing-panel";
import { useI18n } from "@/lib/i18n/useI18n";

type DebriefPanelProps = {
  sessionId: string;
  joinToken: string;
  participantType: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  eventLobbyUrl: string | null | undefined;
};

export function DebriefPanel({
  sessionId,
  joinToken,
  participantType,
  eventLobbyUrl,
}: DebriefPanelProps) {
  const { t } = useI18n();

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

      <SessionPostProcessingPanel
        sessionId={sessionId}
        joinToken={joinToken}
        variant="sidebar"
        participantType={participantType}
        showNavigation={participantType === "FACILITATOR"}
        eventLobbyUrl={eventLobbyUrl}
      />
    </div>
  );
}
