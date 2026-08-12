"use client";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { SemanticActionLink } from "@/components/semantic-action";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { VisibilityBadge } from "@/components/visibility-badge";
import { useI18n } from "@/lib/i18n/useI18n";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import type { SemanticActionKind } from "@/lib/ui/semantic-action-model";

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
  visibility: "PUBLIC" | "PRIVATE";
  status: string;
  scheduledAt: string | null;
  timeZone: string;
  estimatedDurationSeconds: number | null;
  roleKey: "dashboard.roleHost" | "dashboard.roleFacilitator" | "dashboard.roleParticipant" | "dashboard.roleObserver";
  totalSessions: number;
  activeSessions: number;
  finishedSessions: number;
  primaryAction: DashboardAction | null;
};

type DashboardSessionItem = {
  id: string;
  title: string;
  visibility: "PUBLIC" | "PRIVATE";
  eventTitle: string | null;
  status: SessionDisplayStatus;
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

function semanticKindForDashboardAction(action: DashboardAction): SemanticActionKind {
  if (action.labelKey === "dashboard.openRoom" || action.labelKey === "dashboard.continueSession") {
    return "PRIMARY_PROGRESS";
  }
  if (action.labelKey === "dashboard.openMaterials") {
    return "REVIEW_RESULTS";
  }
  return "NAVIGATION";
}

export function AccountDashboardView({
  continueItem,
  activeEvents,
  activeSessions,
  completedSessions,
  hostedEvents,
  isAdmin,
}: AccountDashboardViewProps) {
  const { t, locale } = useI18n();
  const dateTimeLocale = locale === "ru" ? "ru-RU" : "en-US";
  const activeEventIds = new Set(activeEvents.map((event) => event.id));
  const managedOnlyEvents = hostedEvents.filter((event) => !activeEventIds.has(event.id));
  const hasUpcomingOrActive = activeEvents.length > 0 || activeSessions.length > 0;

  const formatDate = (iso: string | null, timeZone: string) => {
    if (!iso) return "—";
    return new Intl.DateTimeFormat(dateTimeLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(new Date(iso));
  };

  const formatTime = (iso: string | null, timeZone: string) => {
    if (!iso) return "—";
    return new Intl.DateTimeFormat(dateTimeLocale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(iso));
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds || seconds <= 0) return "—";
    const totalMinutes = Math.round(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (locale === "ru") {
      if (hours > 0 && minutes > 0) {
        return `${hours} ч ${minutes} мин`;
      }
      if (hours > 0) {
        return `${hours} ч`;
      }
      return `${minutes} мин`;
    }

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (hours > 0) {
      return `${hours}h`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("dashboard.title")}
        description={isAdmin ? t("dashboard.adminOwnDataHint") : t("dashboard.accountScopedHint")}
      />

      <section className="space-y-3" data-testid="dashboard-current-section">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.currentSection")}</h2>
        {continueItem ? (
          <GlassCard className="border-cyan-500/25">
            <GlassCardContent className="space-y-3 py-5">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-100">{continueItem.title}</p>
                {continueItem.subtitle ? (
                  <p className="truncate text-sm text-slate-400">{continueItem.subtitle}</p>
                ) : null}
              </div>
              <SemanticActionLink
                href={continueItem.action.href}
                actionKind={semanticKindForDashboardAction(continueItem.action)}
                actionTarget={continueItem.action.href}
                data-testid="dashboard-current-action"
              >
                {t(continueItem.action.labelKey)}
              </SemanticActionLink>
            </GlassCardContent>
          </GlassCard>
        ) : (
          <EmptyState message={t("dashboard.noCurrentActivity")} />
        )}
      </section>

      <section className="space-y-3" data-testid="dashboard-upcoming-active-section">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.upcomingAndActive")}</h2>
        {!hasUpcomingOrActive ? (
          <EmptyState message={t("dashboard.noUpcomingActivity")} />
        ) : (
          <div className="space-y-5">
            {activeEvents.length > 0 ? (
              <DashboardEventCards
                events={activeEvents}
                formatDate={formatDate}
                formatTime={formatTime}
                formatDuration={formatDuration}
                managedEventIds={new Set(hostedEvents.map((event) => event.id))}
              />
            ) : null}
            {activeSessions.length > 0 ? (
              <SessionCards sessions={activeSessions} archived={false} />
            ) : null}
          </div>
        )}
      </section>

      {managedOnlyEvents.length > 0 ? (
        <section className="space-y-3" data-testid="dashboard-managed-events-section">
          <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.managedEvents")}</h2>
          <DashboardEventCards
            events={managedOnlyEvents}
            formatDate={formatDate}
            formatTime={formatTime}
            formatDuration={formatDuration}
            compact
            managedEventIds={new Set(managedOnlyEvents.map((event) => event.id))}
          />
        </section>
      ) : null}

      <section className="space-y-3" data-testid="dashboard-archive-section">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.archiveCompleted")}</h2>
        {completedSessions.length === 0 ? (
          <EmptyState message={t("dashboard.noCompletedActivity")} />
        ) : (
          <details className="rounded-2xl border border-slate-700/40 bg-slate-900/25" data-testid="dashboard-archive-disclosure">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-100">
              {t("dashboard.archiveSummary", { count: completedSessions.length })}
            </summary>
            <div className="border-t border-slate-700/30 p-3">
              <SessionCards sessions={completedSessions} archived />
            </div>
          </details>
        )}
      </section>

      <p className="rounded-xl border border-slate-700/30 bg-slate-900/20 px-4 py-3 text-xs text-slate-500">
        {t("dashboard.futureDashboardArea")}
      </p>
    </div>
  );
}

function DashboardEventCards({
  events,
  formatDate,
  formatTime,
  formatDuration,
  managedEventIds,
  compact = false,
}: {
  events: DashboardEventItem[];
  formatDate: (iso: string | null, timeZone: string) => string;
  formatTime: (iso: string | null, timeZone: string) => string;
  formatDuration: (seconds: number | null) => string;
  managedEventIds: Set<string>;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {events.map((event) => (
        <GlassCard key={event.id}>
          <GlassCardHeader>
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate font-semibold text-slate-100">{event.title}</p>
              <VisibilityBadge visibility={event.visibility} showLabel={false} />
            </div>
          </GlassCardHeader>
          <GlassCardContent className="space-y-2 text-sm text-slate-300">
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">{t(event.roleKey)}</Badge>
              {managedEventIds.has(event.id) ? (
                <Badge variant="default">{t("dashboard.managedMarker")}</Badge>
              ) : null}
            </div>
            {!compact ? (
              <>
                <p>{t(`events.status.${event.status}` as never)}</p>
                <p>{formatDate(event.scheduledAt, event.timeZone)}</p>
                <p>
                  {t("dashboard.eventTimeDuration", {
                    time: formatTime(event.scheduledAt, event.timeZone),
                    duration: formatDuration(event.estimatedDurationSeconds),
                  })}
                </p>
              </>
            ) : null}
            {event.primaryAction ? (
              <SemanticActionLink
                href={event.primaryAction.href}
                actionKind={semanticKindForDashboardAction(event.primaryAction)}
                actionTarget={event.primaryAction.href}
                size="compact"
              >
                {t(event.primaryAction.labelKey)}
              </SemanticActionLink>
            ) : null}
          </GlassCardContent>
        </GlassCard>
      ))}
    </div>
  );
}

function SessionCards({
  sessions,
  archived,
}: {
  sessions: DashboardSessionItem[];
  archived: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`grid gap-3 ${archived ? "" : "md:grid-cols-2"}`}>
      {sessions.map((session) => (
        <GlassCard key={session.id} className={archived ? "bg-slate-950/30" : undefined}>
          <GlassCardContent className={archived ? "space-y-2 py-3" : "space-y-2 py-4"}>
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate font-semibold text-slate-100">{session.title}</p>
              <VisibilityBadge visibility={session.visibility} showLabel={false} />
            </div>
            <p className="truncate text-sm text-slate-400">{session.eventTitle ?? "—"}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">{t(session.roleKey)}</Badge>
              <SessionStatusBadge status={session.status} />
            </div>
            {!archived ? (
              <p className="text-xs text-slate-500">
                {`${session.recordingStage ?? "-"} / ${session.transcriptStage ?? "-"} / ${session.speakerMappingStage ?? "-"} / ${session.aiStage ?? "-"}`}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!archived ? (
                <SemanticActionLink
                  href={session.openRoomHref}
                  actionKind="PRIMARY_PROGRESS"
                  actionTarget={session.openRoomHref}
                  size="compact"
                  data-testid="dashboard-session-room-action"
                >
                {t("dashboard.openRoom")}
                </SemanticActionLink>
              ) : null}
              <SemanticActionLink
                href={session.openMaterialsHref}
                actionKind="REVIEW_RESULTS"
                actionTarget={session.openMaterialsHref}
                size="compact"
                data-testid="dashboard-session-materials-action"
              >
                {t("dashboard.openMaterials")}
              </SemanticActionLink>
              {session.eventLobbyHref ? (
                <SemanticActionLink
                  href={session.eventLobbyHref}
                  actionKind="NAVIGATION"
                  actionTarget={session.eventLobbyHref}
                  size="compact"
                  data-testid="dashboard-event-lobby-action"
                >
                  {t("dashboard.returnToEventLobby")}
                </SemanticActionLink>
              ) : null}
            </div>
          </GlassCardContent>
        </GlassCard>
      ))}
    </div>
  );
}
