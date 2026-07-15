"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  ListActionButton,
  ListActionGroup,
  ListActionLink,
} from "@/components/list-action-button";
import { PageHeader } from "@/components/page-header";
import {
  ListFilterBar,
  ListFilterChip,
  ListFilterGroup,
  ListFilterGroups,
  ListFilterInput,
  ListFilterResetButton,
  SortHeaderButton,
} from "@/components/table-list-controls";
import { GradientButtonLink } from "@/components/ui/buttons";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/badge";
import { VisibilityBadge } from "@/components/visibility-badge";
import { getEventJoinUrl, getEventPublicJoinUrl } from "@/lib/config";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  cancelTrainingEvent,
  completeTrainingEventFromList,
} from "@/app/actions/events";

import {
  applyEventOverviewStats,
  isEventActiveForPresence,
  type EventOverviewStats,
} from "@/lib/event-overview-shared";
import { PRESENCE_OVERVIEW_POLL_INTERVAL_MS } from "@/lib/presence";

type EventRow = {
  id: string;
  title: string;
  visibility?: "PUBLIC" | "PRIVATE";
  status: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED";
  canManage: boolean;
  scheduledAt: string | null;
  lobbyParticipantCount: number;
  sessionCount: number;
  totalSessions: number;
  activeSessions: number;
  finishedSessions: number;
  participantsInLobby: number;
  participantsInActiveSessions: number;
  uniqueParticipantsWithSessions: number;
  recordingsCount: number;
  transcriptsCount: number;
  latestActivityAt: string | null;
  activeSessionParticipantCount: number;
  totalSessionParticipantCount: number;
  // hostToken and hostParticipantToken are intentionally omitted from list data.
  // Use the event lobby URL via /events/[id]/join or direct host navigation.
  publicJoinCode: string;
  primarySessionId: string | null;
  ownerLabel?: string | null;
};

function canEnterEventLobby(status: EventRow["status"]) {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

function canCompleteEvent(event: EventRow) {
  return event.canManage && event.status !== "COMPLETED" && event.status !== "CANCELLED";
}

function eventStatusBadgeVariant(
  status: EventRow["status"],
): "info" | "success" | "default" | "danger" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "danger";
    case "LOBBY_OPEN":
    case "SESSION_CREATED":
      return "info";
    default:
      return "default";
  }
}

type EventsListViewProps = {
  events: EventRow[];
};

const EVENT_STATUS_FILTERS = [
  "all",
  "unfinished",
  "active",
  "completed",
  "cancelled",
] as const;
type EventStatusFilter = (typeof EVENT_STATUS_FILTERS)[number];

const EVENT_VISIBILITY_FILTERS = ["all", "public", "private"] as const;
type EventVisibilityFilter = (typeof EVENT_VISIBILITY_FILTERS)[number];

const EVENT_ACTIVITY_FILTERS = [
  "all",
  "hasActiveSessions",
  "hasSessions",
  "withoutSessions",
] as const;
type EventActivityFilter = (typeof EVENT_ACTIVITY_FILTERS)[number];

const EVENT_SORT_FIELDS = [
  "updatedAt",
  "createdAt",
  "title",
  "status",
  "activeSessions",
  "totalSessions",
] as const;
type EventSortField = (typeof EVENT_SORT_FIELDS)[number];
type SortDirection = "asc" | "desc";

const EVENT_STATUS_SORT_RANK: Record<EventRow["status"], number> = {
  DRAFT: 1,
  LOBBY_OPEN: 2,
  SESSION_CREATED: 3,
  COMPLETED: 4,
  CANCELLED: 5,
};

function parseEventStatusFilter(value: string | null): EventStatusFilter {
  return (EVENT_STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as EventStatusFilter)
    : "all";
}

function parseEventVisibilityFilter(value: string | null): EventVisibilityFilter {
  return (EVENT_VISIBILITY_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as EventVisibilityFilter)
    : "all";
}

function parseEventActivityFilter(value: string | null): EventActivityFilter {
  return (EVENT_ACTIVITY_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as EventActivityFilter)
    : "all";
}

function parseEventSortField(value: string | null): EventSortField {
  return (EVENT_SORT_FIELDS as readonly string[]).includes(value ?? "")
    ? (value as EventSortField)
    : "updatedAt";
}

function parseSortDirection(value: string | null): SortDirection {
  return value === "asc" || value === "desc" ? value : "desc";
}

function sortDirectionForEventField(field: EventSortField): SortDirection {
  return field === "title" ? "asc" : "desc";
}

function isUnfinishedEvent(status: EventRow["status"]): boolean {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

function EventActivitySummary({ event }: { event: EventRow }) {
  const { t } = useI18n();
  const active = isEventActiveForPresence(event.status);

  const chips = [
    {
      label: t("events.activityLobby"),
      value: active ? event.participantsInLobby : "—",
      testId: "event-participants-in-lobby",
    },
    {
      label: t("events.activitySessions"),
      value: event.totalSessions,
      testId: "event-total-sessions",
    },
    {
      label: t("events.activeSession"),
      value: event.activeSessions,
      testId: "event-active-sessions",
    },
    {
      label: t("events.finishedSession"),
      value: event.finishedSessions,
      testId: "event-finished-sessions",
    },
    {
      label: t("events.activityInSessions"),
      value: active ? event.participantsInActiveSessions : "—",
      testId: "event-participants-in-active-sessions",
    },
    {
      label: t("events.activityTotal"),
      value: event.totalSessionParticipantCount,
      testId: "event-total-assigned-participants",
    },
  ];

  return (
    <div
      className="flex flex-wrap gap-1"
      data-testid="event-stats-summary"
    >
      {chips.map((chip) => (
        <span
          key={chip.label}
          data-testid={chip.testId}
          className="inline-flex items-center gap-1 rounded-md bg-slate-800/70 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-inset ring-slate-600/25"
        >
          <span className="text-slate-500">{chip.label}</span>
          <span className="font-medium text-slate-200">{chip.value}</span>
        </span>
      ))}
    </div>
  );
}

function EventStatusBadge({ status }: { status: EventRow["status"] }) {
  const { t } = useI18n();

  return (
    <span data-testid="event-status-badge">
      <Badge variant={eventStatusBadgeVariant(status)} className="whitespace-nowrap">
        {t(`events.status.${status}`)}
      </Badge>
    </span>
  );
}

function EventRowActions({ event, copyId, onCopyLink }: {
  event: EventRow;
  copyId: string | null;
  onCopyLink: (event: EventRow) => void;
}) {
  const { t } = useI18n();

  return (
    <ListActionGroup>
      {canEnterEventLobby(event.status) ? (
        <ListActionLink
          href={`/events/${event.id}/lobby`}
          variant="primary"
          title={t("events.openLobby")}
          aria-label={t("events.openLobby")}
          data-testid="open-event-lobby-button"
        >
          {t("events.actionOpen")}
        </ListActionLink>
      ) : null}
      {event.canManage && canEnterEventLobby(event.status) ? (
        <ListActionLink
          href={`/events/${event.id}/edit`}
          variant="secondary"
          title={t("events.editEvent")}
          aria-label={t("events.editEvent")}
          data-testid="edit-event-button"
        >
          {t("events.actionEdit")}
        </ListActionLink>
      ) : null}
      {event.totalSessions > 0 ? (
        <ListActionLink
          href={`/sessions?eventId=${event.id}`}
          variant="secondary"
          title={t("events.sessionsInThisEvent")}
          aria-label={t("events.sessionsInThisEvent")}
          data-testid="view-event-sessions-button"
        >
          {t("events.sessions")}
        </ListActionLink>
      ) : null}
      {event.canManage ? (
        <ListActionButton
          type="button"
          variant="link"
          title={
            event.visibility === "PUBLIC"
              ? t("events.copyEventJoinLink")
              : t("events.copyPrivateInviteLink")
          }
          aria-label={
            event.visibility === "PUBLIC"
              ? t("events.copyEventJoinLink")
              : t("events.copyPrivateInviteLink")
          }
          data-testid="copy-event-link-button"
          onClick={() => onCopyLink(event)}
        >
          {copyId === event.id ? t("events.linkCopied") : t("events.actionLink")}
        </ListActionButton>
      ) : null}
      {canCompleteEvent(event) ? (
        <form
          data-testid="event-complete-list-action"
          action={completeTrainingEventFromList}
          onSubmit={(submitEvent) => {
            if (
              !window.confirm(
                `${t("events.completeEventTitle")}\n\n${t("events.completeEventWarning")}`,
              )
            ) {
              submitEvent.preventDefault();
            }
          }}
        >
          <input type="hidden" name="eventId" value={event.id} />
          <ListActionButton
            type="submit"
            variant="dangerOutline"
            title={t("events.completeEvent")}
            aria-label={t("events.completeEvent")}
            data-testid="complete-event-button"
          >
            {t("events.actionComplete")}
          </ListActionButton>
        </form>
      ) : null}
      {canCompleteEvent(event) ? (
        <form action={cancelTrainingEvent}>
          <input type="hidden" name="eventId" value={event.id} />
          <ListActionButton
            type="submit"
            variant="danger"
            title={t("common.cancel")}
            aria-label={t("common.cancel")}
            data-testid="cancel-event-button"
          >
            {t("common.cancel")}
          </ListActionButton>
        </form>
      ) : null}
    </ListActionGroup>
  );
}

export function EventsListView({ events: initialEvents }: EventsListViewProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [eventStats, setEventStats] = useState<EventOverviewStats[]>([]);
  const [copyId, setCopyId] = useState<string | null>(null);
  const events = useMemo(
    () => applyEventOverviewStats(initialEvents, eventStats),
    [eventStats, initialEvents],
  );
  const query = searchParams.get("q")?.trim() ?? "";
  const statusFilter = parseEventStatusFilter(searchParams.get("status"));
  const visibilityFilter = parseEventVisibilityFilter(searchParams.get("visibility"));
  const activityFilter = parseEventActivityFilter(searchParams.get("activity"));
  const sortField = parseEventSortField(searchParams.get("sort"));
  const sortDirection = parseSortDirection(searchParams.get("dir"));

  const replaceSearchParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const nextQuery = params.toString();
    router.replace(nextQuery.length > 0 ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  };

  useEffect(() => {
    let cancelled = false;

    const refreshStats = async () => {
      try {
        const response = await fetch("/api/events/overview", {
          cache: "no-store",
        });

        if (!response.ok || cancelled) {
          return;
        }

        const data = (await response.json()) as {
          events: EventOverviewStats[];
        };

        setEventStats(data.events);
      } catch {
        // Ignore transient network errors; the next poll will retry.
      }
    };

    void refreshStats();

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void refreshStats();
      }
    }, PRESENCE_OVERVIEW_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  };

  const copyLink = async (event: EventRow) => {
    const url =
      event.visibility === "PUBLIC"
        ? getEventPublicJoinUrl(event.publicJoinCode)
        : getEventJoinUrl(event.id);
    await navigator.clipboard.writeText(url);
    setCopyId(event.id);
    window.setTimeout(() => setCopyId(null), 2000);
  };

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase();
    return events.filter((event) => {
      if (statusFilter === "unfinished" && !isUnfinishedEvent(event.status)) {
        return false;
      }
      if (statusFilter === "active" && !isEventActiveForPresence(event.status)) {
        return false;
      }
      if (statusFilter === "completed" && event.status !== "COMPLETED") {
        return false;
      }
      if (statusFilter === "cancelled" && event.status !== "CANCELLED") {
        return false;
      }

      if (
        visibilityFilter !== "all" &&
        event.visibility !== visibilityFilter.toUpperCase()
      ) {
        return false;
      }

      if (activityFilter === "hasActiveSessions" && event.activeSessions <= 0) {
        return false;
      }
      if (activityFilter === "hasSessions" && event.totalSessions <= 0) {
        return false;
      }
      if (activityFilter === "withoutSessions" && event.totalSessions > 0) {
        return false;
      }

      if (normalizedQuery.length === 0) {
        return true;
      }

      return event.title.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [activityFilter, events, query, statusFilter, visibilityFilter]);

  const sortedEvents = useMemo(() => {
    const result = [...filteredEvents];
    result.sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case "title":
          comparison = left.title.localeCompare(right.title, locale);
          break;
        case "status":
          comparison = EVENT_STATUS_SORT_RANK[left.status] - EVENT_STATUS_SORT_RANK[right.status];
          break;
        case "activeSessions":
          comparison = left.activeSessions - right.activeSessions;
          break;
        case "totalSessions":
          comparison = left.totalSessions - right.totalSessions;
          break;
        case "createdAt":
          comparison =
            new Date(left.scheduledAt ?? 0).getTime() -
            new Date(right.scheduledAt ?? 0).getTime();
          break;
        case "updatedAt":
        default:
          comparison =
            new Date(left.latestActivityAt ?? left.scheduledAt ?? 0).getTime() -
            new Date(right.latestActivityAt ?? right.scheduledAt ?? 0).getTime();
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
    return result;
  }, [filteredEvents, locale, sortDirection, sortField]);

  const toggleSort = (field: EventSortField) => {
    if (sortField === field) {
      replaceSearchParams({
        sort: field,
        dir: sortDirection === "asc" ? "desc" : "asc",
      });
      return;
    }
    replaceSearchParams({
      sort: field,
      dir: sortDirectionForEventField(field),
    });
  };

  return (
    <div className="space-y-8" data-testid="events-page">
      <PageHeader
        title={t("events.title")}
        description={t("events.description")}
        action={
          <GradientButtonLink href="/events/new" data-testid="create-event-button">
            {t("dashboard.createNewEvent")}
          </GradientButtonLink>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          message={t("dashboard.noEventsYetAccount")}
          action={
            <GradientButtonLink href="/events/new" data-testid="create-event-button">
              {t("dashboard.createNewEvent")}
            </GradientButtonLink>
          }
        />
      ) : (
        <>
          <ListFilterBar>
            <ListFilterGroups>
              <ListFilterGroup label={locale === "ru" ? "Поиск" : "Search"} className="min-w-[14rem] flex-1">
                <ListFilterInput
                  value={query}
                  onChange={(value) => replaceSearchParams({ q: value || null })}
                  placeholder={locale === "ru" ? "Поиск..." : "Search..."}
                />
              </ListFilterGroup>
              <ListFilterGroup label={locale === "ru" ? "Статус" : "Status"}>
                <ListFilterChip
                  active={statusFilter === "all"}
                  onClick={() => replaceSearchParams({ status: null })}
                >
                  {locale === "ru" ? "Все статусы" : "All statuses"}
                </ListFilterChip>
                <ListFilterChip
                  active={statusFilter === "unfinished"}
                  onClick={() => replaceSearchParams({ status: "unfinished" })}
                >
                  {locale === "ru" ? "Незавершённые" : "Unfinished"}
                </ListFilterChip>
                <ListFilterChip
                  active={statusFilter === "active"}
                  onClick={() => replaceSearchParams({ status: "active" })}
                >
                  {locale === "ru" ? "Активные" : "Active"}
                </ListFilterChip>
                <ListFilterChip
                  active={statusFilter === "completed"}
                  onClick={() => replaceSearchParams({ status: "completed" })}
                >
                  {locale === "ru" ? "Завершённые" : "Completed"}
                </ListFilterChip>
              </ListFilterGroup>
              <ListFilterGroup label={locale === "ru" ? "Видимость" : "Visibility"}>
                <ListFilterChip
                  active={visibilityFilter === "all"}
                  onClick={() => replaceSearchParams({ visibility: null })}
                >
                  {locale === "ru" ? "Любая" : "Any"}
                </ListFilterChip>
                <ListFilterChip
                  active={visibilityFilter === "public"}
                  onClick={() => replaceSearchParams({ visibility: "public" })}
                >
                  {locale === "ru" ? "Публичные" : "Public"}
                </ListFilterChip>
                <ListFilterChip
                  active={visibilityFilter === "private"}
                  onClick={() => replaceSearchParams({ visibility: "private" })}
                >
                  {locale === "ru" ? "Приватные" : "Private"}
                </ListFilterChip>
              </ListFilterGroup>
              <ListFilterGroup label={locale === "ru" ? "Активность" : "Activity"}>
                <ListFilterChip
                  active={activityFilter === "all"}
                  onClick={() => replaceSearchParams({ activity: null })}
                >
                  {locale === "ru" ? "Любая" : "Any"}
                </ListFilterChip>
                <ListFilterChip
                  active={activityFilter === "hasActiveSessions"}
                  onClick={() => replaceSearchParams({ activity: "hasActiveSessions" })}
                >
                  {locale === "ru" ? "С активными сессиями" : "With active sessions"}
                </ListFilterChip>
              </ListFilterGroup>
              <div className="ml-auto flex items-end">
                <ListFilterResetButton
                  onClick={() =>
                    replaceSearchParams({
                      q: null,
                      status: null,
                      visibility: null,
                      activity: null,
                      sort: null,
                      dir: null,
                    })
                  }
                >
                  {locale === "ru" ? "Сбросить" : "Reset"}
                </ListFilterResetButton>
              </div>
            </ListFilterGroups>
          </ListFilterBar>
          <GlassCard elevated className="hidden overflow-hidden md:block">
            <div className="max-h-[calc(100vh-260px)] overflow-auto overscroll-contain">
            <table className="min-w-[980px] w-full table-fixed divide-y divide-slate-700/40 xl:min-w-full">
              <thead className="bg-slate-900/80">
                <tr>
                  <th className="w-[30%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <SortHeaderButton
                      active={sortField === "title"}
                      direction={sortDirection}
                      onClick={() => toggleSort("title")}
                    >
                      {t("events.eventColumn")}
                    </SortHeaderButton>
                  </th>
                  <th className="w-[12%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <SortHeaderButton
                      active={sortField === "status"}
                      direction={sortDirection}
                      onClick={() => toggleSort("status")}
                    >
                      {t("common.status")}
                    </SortHeaderButton>
                  </th>
                  <th className="w-[33%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t("events.activity")}
                  </th>
                  <th className="w-[25%] px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {sortedEvents.map((event) => (
                  <tr
                    key={event.id}
                    className="transition-colors hover:bg-slate-800/50"
                    data-testid="event-row"
                  >
                    <td className="px-3 py-2.5 align-top text-xs">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p
                            className="truncate font-medium text-slate-50"
                            data-testid="event-title"
                          >
                            {event.title}
                          </p>
                          {event.visibility ? (
                            <VisibilityBadge visibility={event.visibility} showLabel={false} />
                          ) : null}
                        </div>
                        {event.visibility === "PRIVATE" && event.ownerLabel ? (
                          <p className="text-xs text-slate-500" data-testid="event-owner-label">
                            {t("visibility.ownerLabel")}: {event.ownerLabel}
                          </p>
                        ) : null}
                        <p className="text-xs text-slate-500" data-testid="event-scheduled-at">
                          {formatDate(event.scheduledAt)}
                        </p>
                        <p className="text-xs text-slate-600">
                          {t("events.latestActivity")}:{" "}
                          {formatDate(event.latestActivityAt)}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs">
                      <EventStatusBadge status={event.status} />
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs">
                      <EventActivitySummary event={event} />
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs">
                      <EventRowActions
                        event={event}
                        copyId={copyId}
                        onCopyLink={(row) => void copyLink(row)}
                      />
                    </td>
                  </tr>
                ))}
                {sortedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-400">
                      {locale === "ru" ? "Ничего не найдено по текущим фильтрам." : "No events match the current filters."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </div>
          </GlassCard>

          <div className="space-y-3 md:hidden">
            {sortedEvents.map((event) => (
              <div key={event.id} data-testid="event-row">
                <GlassCard elevated className="p-4" data-testid="event-card">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p
                          className="font-medium text-slate-50"
                          data-testid="event-title"
                        >
                          {event.title}
                        </p>
                        {event.visibility ? (
                          <VisibilityBadge visibility={event.visibility} showLabel={false} />
                        ) : null}
                      </div>
                      {event.visibility === "PRIVATE" && event.ownerLabel ? (
                        <p className="text-xs text-slate-500" data-testid="event-owner-label">
                          {t("visibility.ownerLabel")}: {event.ownerLabel}
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-500" data-testid="event-scheduled-at">
                        {formatDate(event.scheduledAt)}
                      </p>
                      <p className="text-xs text-slate-600">
                        {t("events.latestActivity")}:{" "}
                        {formatDate(event.latestActivityAt)}
                      </p>
                    </div>
                    <EventStatusBadge status={event.status} />
                  </div>
                  <EventActivitySummary event={event} />
                  <EventRowActions
                    event={event}
                    copyId={copyId}
                    onCopyLink={(row) => void copyLink(row)}
                  />
                </div>
              </GlassCard>
              </div>
            ))}
            {sortedEvents.length === 0 ? (
              <GlassCard elevated className="p-4 text-center text-sm text-slate-400">
                {locale === "ru" ? "Ничего не найдено по текущим фильтрам." : "No events match the current filters."}
              </GlassCard>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
