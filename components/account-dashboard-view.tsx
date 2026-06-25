"use client";

import Link from "next/link";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { useI18n } from "@/lib/i18n/useI18n";

type DashboardAction = {
  href: string;
  labelKey:
    | "dashboard.openLobby"
    | "dashboard.continueSession"
    | "dashboard.openRoom"
    | "dashboard.openMaterials";
};

type DashboardEventItem = {
  id: string;
  title: string;
  status: string;
  scheduledAt: string | null;
  roleKey: "dashboard.roleHost" | "dashboard.roleFacilitator" | "dashboard.roleParticipant" | "dashboard.roleObserver";
  totalSessions: number;
  activeSessions: number;
  finishedSessions: number;
  primaryAction: DashboardAction | null;
};

type DashboardSessionItem = {
  id: string;
  title: string;
  eventTitle: string | null;
  status: string;
  roleKey: "dashboard.roleHost" | "dashboard.roleFacilitator" | "dashboard.roleParticipant" | "dashboard.roleObserver";
  recordingStage: string | null;
  transcriptStage: string | null;
  speakerMappingStage: string | null;
  aiStage: string | null;
  openRoomHref: string;
  openMaterialsHref: string;
  eventLobbyHref: string | null;
};

type ContinueItem = {
  title: string;
  subtitle: string;
  action: DashboardAction;
};

type AccountDashboardViewProps = {
  continueItem: ContinueItem | null;
  activeEvents: DashboardEventItem[];
  activeSessions: DashboardSessionItem[];
  completedSessions: DashboardSessionItem[];
  hostedEvents: DashboardEventItem[];
  isAdmin: boolean;
};

export function AccountDashboardView({
  continueItem,
  activeEvents,
  activeSessions,
  completedSessions,
  hostedEvents,
  isAdmin,
}: AccountDashboardViewProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("dashboard.title")}
        description={isAdmin ? t("dashboard.adminOwnDataHint") : t("dashboard.accountScopedHint")}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.continue")}</h2>
        {continueItem ? (
          <GlassCard>
            <GlassCardContent className="space-y-2 py-5">
              <p className="text-sm font-semibold text-slate-100">{continueItem.title}</p>
              <p className="text-sm text-slate-400">{continueItem.subtitle}</p>
              <Link className="text-sm font-semibold text-cyan-400 hover:text-cyan-300" href={continueItem.action.href}>
                {t(continueItem.action.labelKey)}
              </Link>
            </GlassCardContent>
          </GlassCard>
        ) : (
          <EmptyState message={t("rejoin.noRecentSession")} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.myActiveEvents")}</h2>
        {activeEvents.length === 0 ? (
          <EmptyState message={t("dashboard.noEventsYet")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {activeEvents.map((event) => (
              <GlassCard key={event.id}>
                <GlassCardHeader>
                  <p className="font-semibold text-slate-100">{event.title}</p>
                </GlassCardHeader>
                <GlassCardContent className="space-y-2 text-sm text-slate-300">
                  <Badge variant="info">{t(event.roleKey)}</Badge>
                  <p>{t(`events.status.${event.status}` as never)}</p>
                  <p>{event.scheduledAt ?? "—"}</p>
                  <p>{`${event.totalSessions}/${event.activeSessions}/${event.finishedSessions}`}</p>
                  {event.primaryAction ? (
                    <Link href={event.primaryAction.href} className="font-semibold text-cyan-400 hover:text-cyan-300">
                      {t(event.primaryAction.labelKey)}
                    </Link>
                  ) : null}
                </GlassCardContent>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.myActiveSessions")}</h2>
        {activeSessions.length === 0 ? (
          <EmptyState message={t("dashboard.noSessionsYet")} />
        ) : (
          <SessionCards sessions={activeSessions} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.myCompletedSessions")}</h2>
        {completedSessions.length === 0 ? (
          <EmptyState message={t("dashboard.noSessionsYet")} />
        ) : (
          <SessionCards sessions={completedSessions} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.eventsIHost")}</h2>
        {hostedEvents.length === 0 ? (
          <EmptyState message={t("dashboard.noEventsYet")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {hostedEvents.map((event) => (
              <GlassCard key={event.id}>
                <GlassCardContent className="space-y-2 py-4">
                  <p className="font-semibold text-slate-100">{event.title}</p>
                  {event.primaryAction ? (
                    <Link href={event.primaryAction.href} className="font-semibold text-cyan-400 hover:text-cyan-300">
                      {t(event.primaryAction.labelKey)}
                    </Link>
                  ) : null}
                </GlassCardContent>
              </GlassCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SessionCards({ sessions }: { sessions: DashboardSessionItem[] }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sessions.map((session) => (
        <GlassCard key={session.id}>
          <GlassCardContent className="space-y-2 py-4">
            <p className="font-semibold text-slate-100">{session.title}</p>
            <p className="text-sm text-slate-400">{session.eventTitle ?? "—"}</p>
            <Badge variant="default">{t(session.roleKey)}</Badge>
            <p className="text-xs text-slate-500">{session.status}</p>
            <p className="text-xs text-slate-500">
              {`${session.recordingStage ?? "-"} / ${session.transcriptStage ?? "-"} / ${session.speakerMappingStage ?? "-"} / ${session.aiStage ?? "-"}`}
            </p>
            <div className="flex gap-3">
              <Link href={session.openRoomHref} className="text-sm font-semibold text-cyan-400 hover:text-cyan-300">
                {t("dashboard.openRoom")}
              </Link>
              <Link href={session.openMaterialsHref} className="text-sm font-semibold text-cyan-400 hover:text-cyan-300">
                {t("dashboard.openMaterials")}
              </Link>
              {session.eventLobbyHref ? (
                <Link href={session.eventLobbyHref} className="text-sm font-semibold text-cyan-400 hover:text-cyan-300">
                  {t("dashboard.returnToEventLobby")}
                </Link>
              ) : null}
            </div>
          </GlassCardContent>
        </GlassCard>
      ))}
    </div>
  );
}
