"use client";

/**
 * DEPRECATED — Stage 5.3
 *
 * This component is no longer used by VoximplantNegotiationRoomPage.
 * Business sidebar (role briefings, notes, role management, observer content)
 * is now fully handled by the shared RoomSidebar inside SharedRoomShell,
 * which is provider-agnostic and guarantees 1:1 parity with the LiveKit room.
 *
 * This file is retained to avoid breaking any direct imports during the
 * transition. It will be removed in Stage 5.4 cleanup.
 *
 * DO NOT add new logic here. Any sidebar changes must go to:
 *   components/shared-room-shell.tsx (the RoomSidebar function inside it)
 */

import { ParticipantType } from "@/app/generated/prisma/enums";
import { RoleBriefingCard } from "@/components/role-briefing-card";
import { ParticipantNotesPanel } from "@/components/participant-notes-panel";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { RoomSidebarData } from "@/lib/room-sidebar-types";
import { useI18n } from "@/lib/i18n/useI18n";

/** @deprecated Use SharedRoomShell which includes the shared RoomSidebar. */
export default function VoximplantRoomSidebar({
  roomAuth,
  sidebar,
}: {
  roomAuth: RoomAuthToken;
  sidebar: RoomSidebarData;
}) {
  const { t } = useI18n();
  const isUnassignedParticipant =
    sidebar.participantType === ParticipantType.PARTICIPANT && !sidebar.hasAssignedRole;

  const participantTypeLabel = t(
    `participantType.${sidebar.participantType}` as `participantType.${typeof sidebar.participantType}`,
  );

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-700 bg-slate-950/80">
      <div className="border-b border-slate-700 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">{t("room.sessionPanel")}</h2>
        <p className="mt-1 text-xs text-slate-400">
          {sidebar.displayName} · {participantTypeLabel}
          {isUnassignedParticipant ? (
            <span className="ml-2 text-amber-400">
              · {t("sessions.noRoleAssignedBadge")}
            </span>
          ) : null}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
          <h3 className="text-sm font-semibold text-slate-100">{t("join.publicContext")}</h3>
          <p className="whitespace-pre-wrap text-sm text-slate-400">
            {sidebar.publicContext.description}
          </p>
          <p className="whitespace-pre-wrap text-sm text-slate-400">
            {sidebar.publicContext.publicInstructions}
          </p>
        </section>

        {sidebar.participantType === ParticipantType.PARTICIPANT ? (
          isUnassignedParticipant ? (
            <section className="rounded-lg border border-amber-600/40 bg-amber-950/20 p-3 text-sm text-amber-300">
              {t("sessions.waitingForRoleAssignment")}
            </section>
          ) : sidebar.caseRole ? (
            <RoleBriefingCard
              title={t("join.yourRoleTitle", { name: sidebar.caseRole.name })}
              subtitle={t("join.privateBriefingVisible")}
              role={sidebar.caseRole}
            />
          ) : null
        ) : null}

        {sidebar.participantType === ParticipantType.FACILITATOR &&
        sidebar.facilitatorBriefings.length > 0
          ? sidebar.facilitatorBriefings.map((briefing) => (
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
          : null}

        <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
          <h3 className="text-sm font-semibold text-slate-100">
            {sidebar.participantType === ParticipantType.FACILITATOR
              ? t("join.facilitatorNotes")
              : sidebar.participantType === ParticipantType.OBSERVER
                ? t("join.observerNotes")
                : t("join.preparation")}
          </h3>
          {isUnassignedParticipant ? (
            <p className="text-sm text-amber-300">{t("sessions.preparationLockedNoRole")}</p>
          ) : (
            <ParticipantNotesPanel
              {...(roomAuth.type === "account"
                ? { authMode: "account" as const, participantId: roomAuth.participantId }
                : { joinToken: roomAuth.value })}
              initialNotes={sidebar.notes}
              description={t("join.preparationDescription")}
              placeholder={t("join.preparationPlaceholder")}
            />
          )}
        </section>
      </div>
    </aside>
  );
}
