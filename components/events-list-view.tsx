"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { GradientButtonLink } from "@/components/ui/buttons";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/badge";
import { cn } from "@/lib/cn";
import { getEventLobbyUrl, getEventPublicJoinUrl } from "@/lib/config";
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
  status: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED";
  scheduledAt: string | null;
  lobbyParticipantCount: number;
  sessionCount: number;
  activeSessionParticipantCount: number;
  totalSessionParticipantCount: number;
  hostToken: string;
  hostParticipantToken: string | null;
  publicJoinCode: string;
  primarySessionId: string | null;
};

const compactButtonClass =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:cursor-not-allowed disabled:opacity-40";

function canEnterEventLobby(status: EventRow["status"]) {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

function canCompleteEvent(status: EventRow["status"]) {
  return status !== "COMPLETED" && status !== "CANCELLED";
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

function EventActivitySummary({ event }: { event: EventRow }) {
  const { t } = useI18n();
  const active = isEventActiveForPresence(event.status);

  const chips = [
    {
      label: t("events.activityLobby"),
      value: active ? event.lobbyParticipantCount : "—",
    },
    {
      label: t("events.activitySessions"),
      value: event.sessionCount,
    },
    {
      label: t("events.activityInSessions"),
      value: active ? event.activeSessionParticipantCount : "—",
    },
    {
      label: t("events.activityTotal"),
      value: event.totalSessionParticipantCount,
    },
  ];

  return (
    <div
      className="flex flex-wrap gap-1"
      data-testid="event-activity-summary"
    >
      {chips.map((chip) => (
        <span
          key={chip.label}
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
    <div className="flex flex-wrap items-center justify-end gap-1">
      {canEnterEventLobby(event.status) ? (
        <Link
          href={getEventLobbyUrl(event.id, {
            hostToken: event.hostToken,
            participantToken: event.hostParticipantToken ?? undefined,
          })}
          className={cn(
            compactButtonClass,
            "bg-cyan-500/15 text-cyan-300 ring-1 ring-inset ring-cyan-500/25 hover:bg-cyan-500/25 hover:text-cyan-200",
          )}
          title={t("events.openLobby")}
          aria-label={t("events.openLobby")}
          data-testid="open-lobby-button"
        >
          {t("events.actionOpen")}
        </Link>
      ) : null}
      {event.sessionCount > 0 && event.primarySessionId ? (
        <Link
          href={`/sessions/${event.primarySessionId}`}
          className={cn(
            compactButtonClass,
            "bg-slate-800/80 text-slate-300 ring-1 ring-inset ring-slate-600/30 hover:bg-slate-700/80 hover:text-slate-100",
          )}
          title={t("events.materials")}
          aria-label={t("events.materials")}
          data-testid="event-materials-button"
        >
          {t("events.materials")}
        </Link>
      ) : null}
      <button
        type="button"
        className="inline-flex h-8 shrink-0 items-center justify-center px-2 text-xs font-medium text-blue-400 underline decoration-blue-400/60 underline-offset-2 transition-colors hover:text-blue-300 hover:decoration-blue-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]"
        title={t("events.copyEventJoinLink")}
        aria-label={t("events.copyEventJoinLink")}
        data-testid="copy-event-link-button"
        onClick={() => onCopyLink(event)}
      >
        {copyId === event.id ? t("events.linkCopied") : t("events.actionLink")}
      </button>
      {canCompleteEvent(event.status) ? (
        <form
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
          <input type="hidden" name="hostToken" value={event.hostToken} />
          <button
            type="submit"
            className={cn(
              compactButtonClass,
              "bg-slate-800/80 text-slate-300 ring-1 ring-inset ring-slate-600/30 hover:bg-slate-700/80 hover:text-slate-100",
            )}
            title={t("events.completeEvent")}
            aria-label={t("events.completeEvent")}
            data-testid="complete-event-button"
          >
            {t("events.actionComplete")}
          </button>
        </form>
      ) : null}
      {canCompleteEvent(event.status) ? (
        <form action={cancelTrainingEvent}>
          <input type="hidden" name="eventId" value={event.id} />
          <button
            type="submit"
            className={cn(
              compactButtonClass,
              "bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/25 hover:bg-rose-500/20 hover:text-rose-200",
            )}
            title={t("common.cancel")}
            aria-label={t("common.cancel")}
            data-testid="cancel-event-button"
          >
            {t("common.cancel")}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function EventsListView({ events: initialEvents }: EventsListViewProps) {
  const { t, locale } = useI18n();
  const [eventStats, setEventStats] = useState<EventOverviewStats[]>([]);
  const [copyId, setCopyId] = useState<string | null>(null);
  const events = useMemo(
    () => applyEventOverviewStats(initialEvents, eventStats),
    [eventStats, initialEvents],
  );

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
    await navigator.clipboard.writeText(getEventPublicJoinUrl(event.publicJoinCode));
    setCopyId(event.id);
    window.setTimeout(() => setCopyId(null), 2000);
  };

  return (
    <div className="space-y-8" data-testid="events-page">
      <PageHeader
        title={t("events.title")}
        description={t("events.description")}
        action={
          <GradientButtonLink href="/events/new" data-testid="create-event-button">
            {t("events.createEvent")}
          </GradientButtonLink>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          message={t("events.noEvents")}
          action={
            <GradientButtonLink href="/events/new" data-testid="create-event-button">
              {t("events.createEvent")}
            </GradientButtonLink>
          }
        />
      ) : (
        <>
          <GlassCard elevated className="hidden overflow-hidden md:block">
            <table className="w-full table-fixed divide-y divide-slate-700/40">
              <thead className="bg-slate-900/80">
                <tr>
                  <th className="w-[34%] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t("events.eventColumn")}
                  </th>
                  <th className="w-[16%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t("common.status")}
                  </th>
                  <th className="w-[30%] px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t("events.activity")}
                  </th>
                  <th className="w-[20%] px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {events.map((event) => (
                  <tr
                    key={event.id}
                    className="transition-colors hover:bg-slate-800/50"
                    data-testid="event-row"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="min-w-0 space-y-0.5">
                        <p
                          className="truncate font-medium text-slate-50"
                          data-testid="event-title"
                        >
                          {event.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(event.scheduledAt)}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <EventStatusBadge status={event.status} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <EventActivitySummary event={event} />
                    </td>
                    <td className="px-4 py-3 align-top">
                      <EventRowActions
                        event={event}
                        copyId={copyId}
                        onCopyLink={(row) => void copyLink(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>

          <div className="space-y-3 md:hidden">
            {events.map((event) => (
              <div key={event.id} data-testid="event-row">
                <GlassCard elevated className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p
                        className="font-medium text-slate-50"
                        data-testid="event-title"
                      >
                        {event.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(event.scheduledAt)}
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
          </div>
        </>
      )}
    </div>
  );
}
