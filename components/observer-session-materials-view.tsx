"use client";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { SecondaryButtonLink } from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import type { ObserverSessionMaterialsData } from "@/lib/observer-session-materials";
import { useI18n } from "@/lib/i18n/useI18n";

type Props = ObserverSessionMaterialsData;

export function ObserverSessionMaterialsView({
  title,
  roomLabel,
  caseTitle,
  caseLanguage,
  negotiationState,
  event,
  businessContext,
  publicInstructions,
  assignedParticipants,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8" data-testid="observer-materials-page">
      <PageHeader
        title={roomLabel ?? title}
        description={caseTitle}
        action={
          <div className="flex flex-wrap gap-2">
            {event.status !== "COMPLETED" ? (
              <SecondaryButtonLink href={event.lobbyUrl}>
                {t("events.openLobby")}
              </SecondaryButtonLink>
            ) : null}
            <SecondaryButtonLink href="/sessions" data-testid="back-to-sessions-link">
              {t("events.backToSessionsCompact")}
            </SecondaryButtonLink>
          </div>
        }
      />

      <GlassCard>
        <GlassCardContent className="flex flex-wrap items-center gap-3 py-4">
          <Badge variant="success">{t("participantType.OBSERVER")}</Badge>
          <Badge variant="default">{t("events.completedSessionStatus")}</Badge>
          <span className="text-xs text-slate-500 uppercase">{caseLanguage}</span>
          <span className="text-xs text-slate-400">
            {t(
              `status.${negotiationState}` as
                | "status.PREPARATION"
                | "status.PREPARATION_RUNNING"
                | "status.PREPARATION_PAUSED"
                | "status.READY_TO_START"
                | "status.RUNNING"
                | "status.PAUSED"
                | "status.FINISHED",
            )}
          </span>
        </GlassCardContent>
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard>
          <GlassCardHeader>
            <p className="font-semibold text-slate-100">{t("join.publicContext")}</p>
          </GlassCardHeader>
          <GlassCardContent className="space-y-3 py-4 text-sm text-slate-300">
            {businessContext ? <p>{businessContext}</p> : null}
            {publicInstructions ? <p className="text-slate-400">{publicInstructions}</p> : null}
          </GlassCardContent>
        </GlassCard>

        <GlassCard>
          <GlassCardHeader>
            <p className="font-semibold text-slate-100">{t("sessions.participants")}</p>
          </GlassCardHeader>
          <GlassCardContent className="py-4">
            {assignedParticipants.length > 0 ? (
              <ul className="space-y-2">
                {assignedParticipants.map((participant) => (
                  <li
                    key={participant.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="font-medium text-slate-200">{participant.displayName}</span>
                    <span className="text-xs text-slate-500">{participant.roleName}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">{t("events.noParticipantsYet")}</p>
            )}
          </GlassCardContent>
        </GlassCard>
      </div>
    </div>
  );
}
