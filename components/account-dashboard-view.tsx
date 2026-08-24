"use client";

import { Badge } from "@/components/badge";
import { ObjectPictogram } from "@/components/object-pictogram";
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
  ownerLabel: string | null;
  isOwnedByCurrentUser: boolean;
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
  ownerLabel: string | null;
  isOwnedByCurrentUser: boolean;
};

type DashboardEventGroupItem = {
  event: DashboardEventItem;
  sessions: DashboardSessionItem[];
};

type ContinueItem = {
  title: string;
  subtitle: string;
  action: DashboardAction;
};

type AccountDashboardViewProps = {
  continueItem: ContinueItem | null;
  currentEventGroups: DashboardEventGroupItem[];
  futureEventGroups: DashboardEventGroupItem[];
  standaloneActiveSessions: DashboardSessionItem[];
  archiveEventGroups: DashboardEventGroupItem[];
  archiveStandaloneSessions: DashboardSessionItem[];
  isAdmin: boolean;
};

function semanticKindForDashboardAction(action: DashboardAction): SemanticActionKind {
  if (
    action.labelKey === "dashboard.openRoom" ||
    action.labelKey === "dashboard.continueSession" ||
    action.labelKey === "dashboard.openLobby"
  ) {
    return "PRIMARY_PROGRESS";
  }
  if (action.labelKey === "dashboard.openMaterials") {
    return "REVIEW_RESULTS";
  }
  return "NAVIGATION";
}

export function AccountDashboardView({
  continueItem,
  currentEventGroups,
  futureEventGroups,
  standaloneActiveSessions,
  archiveEventGroups,
  archiveStandaloneSessions,
  isAdmin,
}: AccountDashboardViewProps) {
  const { t, locale } = useI18n();
  const dateTimeLocale = locale === "ru" ? "ru-RU" : "en-US";
  const hasUpcomingOrActive =
    currentEventGroups.length > 0 ||
    futureEventGroups.length > 0 ||
    standaloneActiveSessions.length > 0;
  const archivedSessionCount =
    archiveStandaloneSessions.length +
    archiveEventGroups.reduce(
      (count, group) => count + group.sessions.length,
      0,
    );
  const hasArchiveItems =
    archiveEventGroups.length > 0 || archiveStandaloneSessions.length > 0;
  const archiveItemCount = Math.max(
    archivedSessionCount,
    archiveEventGroups.length + archiveStandaloneSessions.length,
  );

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
          <GlassCard
            className="border-cyan-400/60 bg-cyan-950/20"
            data-testid="dashboard-current-card"
            data-card-system="dashboard-object"
            data-current-accent="true"
          >
            <GlassCardContent className="space-y-3 py-5">
              <div className="flex min-w-0 items-center gap-3">
                <ObjectPictogram objectType="room" size={40} className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-100">{continueItem.title}</p>
                {continueItem.subtitle ? (
                  <p className="truncate text-sm text-slate-400">{continueItem.subtitle}</p>
                ) : null}
                </div>
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

      <section
        className="space-y-3"
        data-testid="dashboard-upcoming-active-section"
        data-dashboard-lane="active"
      >
        <div className="space-y-3" data-testid="dashboard-active-section">
        <h2 className="text-lg font-semibold text-slate-100">
          {locale === "ru" ? "Активные" : "Active"}
        </h2>
        {!hasUpcomingOrActive ? (
          <EmptyState message={t("dashboard.noUpcomingActivity")} />
        ) : (
          <div className="space-y-5">
            {currentEventGroups.length > 0 ? (
              <DashboardEventHierarchyCards
                groups={currentEventGroups}
                formatDate={formatDate}
                formatTime={formatTime}
                formatDuration={formatDuration}
              />
            ) : null}
            {futureEventGroups.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {t("dashboard.futureEvents")}
                </h3>
                <DashboardEventHierarchyCards
                  groups={futureEventGroups}
                  formatDate={formatDate}
                  formatTime={formatTime}
                  formatDuration={formatDuration}
                />
              </div>
            ) : null}
            {standaloneActiveSessions.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {t("dashboard.standaloneSessions")}
                </h3>
                <SessionCards sessions={standaloneActiveSessions} archived={false} />
              </div>
            ) : null}
          </div>
        )}
        </div>
      </section>

      <section className="space-y-3" data-testid="dashboard-archive-section">
        <h2 className="text-lg font-semibold text-slate-100">{t("dashboard.archiveCompleted")}</h2>
        {!hasArchiveItems ? (
          <EmptyState message={t("dashboard.noCompletedActivity")} />
        ) : (
          <details className="rounded-2xl border border-slate-700/40 bg-slate-900/25" data-testid="dashboard-archive-disclosure">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-100">
              {t("dashboard.archiveSummary", { count: archiveItemCount })}
            </summary>
            <div className="space-y-4 border-t border-slate-700/30 p-3">
              {archiveEventGroups.length > 0 ? (
                <DashboardEventHierarchyCards
                  groups={archiveEventGroups}
                  formatDate={formatDate}
                  formatTime={formatTime}
                  formatDuration={formatDuration}
                  archived
                />
              ) : null}
              {archiveStandaloneSessions.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                    {t("dashboard.standaloneSessions")}
                  </h3>
                  <SessionCards sessions={archiveStandaloneSessions} archived />
                </div>
              ) : null}
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

function DashboardEventHierarchyCards({
  groups,
  formatDate,
  formatTime,
  formatDuration,
  archived = false,
}: {
  groups: DashboardEventGroupItem[];
  formatDate: (iso: string | null, timeZone: string) => string;
  formatTime: (iso: string | null, timeZone: string) => string;
  formatDuration: (seconds: number | null) => string;
  archived?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <div className={`grid gap-3 ${archived ? "" : "md:grid-cols-2"}`}>
      {groups.map(({ event, sessions }) => (
        <GlassCard
          key={event.id}
          className={archived ? "bg-slate-950/30" : undefined}
          data-testid="dashboard-event-card"
          data-event-id={event.id}
          data-dashboard-lane={archived ? "archive" : "active"}
          data-event-terminal={
            event.status === "COMPLETED" || event.status === "CANCELLED"
              ? "true"
              : "false"
          }
        >
          <GlassCardHeader>
            <div className="flex items-center gap-3">
              <ObjectPictogram
                objectType="event"
                size={40}
                className="h-10 w-10 shrink-0"
              />
              <p className="min-w-0 truncate font-semibold text-slate-100">{event.title}</p>
              <VisibilityBadge visibility={event.visibility} showLabel={false} />
            </div>
          </GlassCardHeader>
          <GlassCardContent className="space-y-2 text-sm text-slate-300">
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">{t(event.roleKey)}</Badge>
            </div>
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
            <p
              className={
                event.isOwnedByCurrentUser
                  ? "text-xs font-semibold text-cyan-200"
                  : "text-xs text-slate-400"
              }
              data-testid={
                event.isOwnedByCurrentUser
                  ? "dashboard-owner-self"
                  : "dashboard-owner-neutral"
              }
              data-owner-accent={event.isOwnedByCurrentUser ? "self" : undefined}
            >
              {event.isOwnedByCurrentUser
                ? locale === "ru"
                  ? "Владелец: Вы"
                  : "Owner: You"
                : `${locale === "ru" ? "Владелец" : "Owner"}: ${event.ownerLabel ?? "—"}`}
            </p>
            {event.primaryAction ? (
              <SemanticActionLink
                href={event.primaryAction.href}
                actionKind={semanticKindForDashboardAction(event.primaryAction)}
                actionTarget={event.primaryAction.href}
                size="compact"
                data-testid="dashboard-event-lobby-action"
              >
                {t(event.primaryAction.labelKey)}
              </SemanticActionLink>
            ) : null}
            <div className="rounded-xl border border-slate-700/40 bg-slate-900/25 p-2">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("events.sessions")}
              </p>
              {sessions.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="rounded-lg border border-slate-700/30 bg-slate-900/35 px-2 py-2"
                      data-testid="dashboard-session-card"
                      data-session-id={session.id}
                    >
                      <div className="flex items-center gap-2">
                        <ObjectPictogram
                          objectType="room"
                          size={24}
                          className="h-6 w-6 shrink-0"
                        />
                        <p className="min-w-0 flex-1 truncate font-medium text-slate-100">
                          {session.title}
                        </p>
                        <SessionStatusBadge status={session.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
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
                        >
                          {t("dashboard.openMaterials")}
                        </SemanticActionLink>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-2 text-xs text-slate-500">
                  {t("events.noSessionsCreatedYet")}
                </p>
              )}
            </div>
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
  const { t, locale } = useI18n();
  return (
    <div className={`grid gap-3 ${archived ? "" : "md:grid-cols-2"}`}>
      {sessions.map((session) => (
        <GlassCard
          key={session.id}
          className={archived ? "bg-slate-950/30" : undefined}
          data-testid="dashboard-session-card"
          data-session-id={session.id}
        >
          <GlassCardContent className={archived ? "space-y-2 py-3" : "space-y-2 py-4"}>
            <div className="flex items-center gap-2">
              <ObjectPictogram
                objectType="room"
                size={archived ? 24 : 32}
                className={archived ? "h-6 w-6 shrink-0" : "h-8 w-8 shrink-0"}
              />
              <p className="min-w-0 truncate font-semibold text-slate-100">{session.title}</p>
              <VisibilityBadge visibility={session.visibility} showLabel={false} />
            </div>
            <p className="truncate text-sm text-slate-400">{session.eventTitle ?? "—"}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">{t(session.roleKey)}</Badge>
              <SessionStatusBadge status={session.status} />
            </div>
            <p
              className={
                session.isOwnedByCurrentUser
                  ? "text-xs font-semibold text-cyan-200"
                  : "text-xs text-slate-400"
              }
              data-testid={
                session.isOwnedByCurrentUser
                  ? "dashboard-owner-self"
                  : "dashboard-owner-neutral"
              }
              data-owner-accent={session.isOwnedByCurrentUser ? "self" : undefined}
            >
              {session.isOwnedByCurrentUser
                ? locale === "ru"
                  ? "Владелец: Вы"
                  : "Owner: You"
                : `${locale === "ru" ? "Владелец" : "Owner"}: ${session.ownerLabel ?? "—"}`}
            </p>
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
