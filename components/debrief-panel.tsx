"use client";

import { SessionPostProcessingPanel } from "@/components/session-post-processing-panel";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import { useI18n } from "@/lib/i18n/useI18n";

type DebriefPanelProps = {
  sessionId: string;
  roomAuth: RoomAuthToken;
  participantType: "FACILITATOR" | "PARTICIPANT" | "OBSERVER";
  eventLobbyUrl: string | null | undefined;
  sidebarData: RoomSidebarData;
};

export function DebriefPanel({
  sessionId,
  roomAuth,
  participantType,
  eventLobbyUrl,
  sidebarData,
}: DebriefPanelProps) {
  const { t } = useI18n();
  const debriefNotes = sidebarData.debriefNotes;
  const debriefNotesContent =
    debriefNotes.length > 0 ? (
      <GlassCard data-testid="debrief-meeting-notes-section">
        <GlassCardContent className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-50">
              {t("room.meetingNotes")}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              {t("room.meetingNotesReadOnly")}
            </p>
          </div>
          <div className="space-y-3">
            {debriefNotes.map((note) => {
              const roleLabel = t(
                `room.debriefNoteRole.${note.roleLabel}` as
                  | "room.debriefNoteRole.PARTICIPANT_A"
                  | "room.debriefNoteRole.PARTICIPANT_B"
                  | "room.debriefNoteRole.PARTICIPANT"
                  | "room.debriefNoteRole.OBSERVER"
                  | "room.debriefNoteRole.FACILITATOR",
              );
              return (
                <article
                  key={note.ownerKey}
                  className="rounded-lg border border-slate-700/45 bg-slate-950/45 p-3"
                  data-testid="debrief-meeting-note"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words text-sm font-medium text-slate-100">
                      {note.displayName}
                    </p>
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100">
                      {note.roleName ? `${roleLabel} · ${note.roleName}` : roleLabel}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                    {note.notes}
                  </p>
                </article>
              );
            })}
          </div>
        </GlassCardContent>
      </GlassCard>
    ) : null;

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
        roomAuth={roomAuth}
        variant="sidebar"
        participantType={participantType}
        showNavigation
        eventLobbyUrl={eventLobbyUrl}
        fallbackContext={{
          participantType: sidebarData.participantType,
          publicContext: sidebarData.publicContext,
          caseRole: sidebarData.caseRole,
        }}
        debriefNotesContent={debriefNotesContent}
      />
    </div>
  );
}
