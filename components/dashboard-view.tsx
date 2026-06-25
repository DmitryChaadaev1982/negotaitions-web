"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge, DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  GradientButtonLink,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableElement,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { FeatureCard } from "@/components/ui/feature-card";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { MetricCard } from "@/components/ui/metric-card";
import { ContinueLastActivityCard } from "@/components/rejoin-page-view";
import { ServiceWarningBanner } from "@/components/service-warning-banner";
import {
  applyEventOverviewStats,
  isEventActiveForPresence,
  type EventOverviewStats,
} from "@/lib/event-overview-shared";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import { PRESENCE_OVERVIEW_POLL_INTERVAL_MS } from "@/lib/presence";
import { useI18n } from "@/lib/i18n/useI18n";

type DashboardViewProps = {
  caseCount: number;
  sessionCount: number;
  eventCount: number;
  recentCases: Array<{
    id: string;
    title: string;
    difficulty: "EASY" | "MEDIUM" | "HARD";
    caseLanguage: "RU" | "EN";
    roleCount: number;
    createdAt: string;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    caseTitle: string;
    status: SessionDisplayStatus;
    createdAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    title: string;
    status: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED";
    canManage: boolean;
    lobbyParticipantCount: number;
    sessionCount: number;
    totalSessions: number;
    activeSessions: number;
    finishedSessions: number;
    participantsInLobby: number;
    participantsInActiveSessions: number;
    uniqueParticipantsWithSessions: number;
    latestActivityAt: string | null;
    activeSessionParticipantCount: number;
    totalSessionParticipantCount: number;
    createdAt: string;
    // hostToken and hostParticipantToken intentionally omitted from list data.
  }>;
};

function SessionsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function RolesIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function NotesIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

export function DashboardView({
  caseCount,
  sessionCount,
  eventCount,
  recentCases,
  recentSessions,
  recentEvents: initialRecentEvents,
}: DashboardViewProps) {
  const { t, locale } = useI18n();
  const [eventStats, setEventStats] = useState<EventOverviewStats[]>([]);
  const recentEvents = useMemo(
    () => applyEventOverviewStats(initialRecentEvents, eventStats),
    [eventStats, initialRecentEvents],
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

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));

  return (
    <div className="space-y-10">
      <ServiceWarningBanner />
      <ContinueLastActivityCard />
      {/* Hero */}
      <section className="glass-hero relative overflow-hidden rounded-2xl p-8 sm:p-12">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-[80px]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-violet-500/15 blur-[60px]"
          aria-hidden="true"
        />
        <div className="relative space-y-6">
          <span className="inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300 shadow-sm shadow-cyan-500/10">
            {t("dashboard.heroPill")}
          </span>
          <BrandLogo size="xl" href={undefined} glow />
          <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
            {t("dashboard.heroSubtitle")}
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <GradientButtonLink href="/cases/new">
              {t("cases.newCase")}
            </GradientButtonLink>
            <SecondaryButtonLink href="/sessions/new">
              {t("sessions.newSession")}
            </SecondaryButtonLink>
            <SecondaryButtonLink href="/events/new">
              {t("events.createEvent")}
            </SecondaryButtonLink>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FeatureCard
          title={t("dashboard.featureLiveSessions")}
          description={t("dashboard.featureLiveSessionsDescription")}
          icon={<SessionsIcon />}
        />
        <FeatureCard
          title={t("dashboard.featurePrivateRoles")}
          description={t("dashboard.featurePrivateRolesDescription")}
          icon={<RolesIcon />}
        />
        <FeatureCard
          title={t("dashboard.featureObserverNotes")}
          description={t("dashboard.featureObserverNotesDescription")}
          icon={<NotesIcon />}
        />
        <FeatureCard
          title={t("dashboard.featureAiFeedback")}
          description={t("dashboard.featureAiFeedbackDescription")}
          icon={<AiIcon />}
        />
      </section>

      {/* Metrics */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t("dashboard.totalCases")}
          value={caseCount}
          accent="blue"
        />
        <MetricCard
          label={t("dashboard.totalSessions")}
          value={sessionCount}
          accent="violet"
        />
        <MetricCard
          label={t("events.title")}
          value={eventCount}
          accent="cyan"
        />
        <MetricCard
          label={t("dashboard.yourRole")}
          value={<Badge variant="info">{t("common.facilitator")}</Badge>}
          accent="default"
        />
      </section>

      {/* Recent events */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-50">
            {t("events.title")}
          </h2>
          <Link
            href="/events"
            className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
          >
            {t("common.viewAll")}
          </Link>
        </div>
        {recentEvents.length === 0 ? (
          <GlassCard elevated>
            <GlassCardContent className="py-8 text-sm text-slate-400">
              {t("events.noEvents")}{" "}
              <Link href="/events/new" className="font-semibold text-cyan-400 hover:text-cyan-300">
                {t("events.createEvent")}
              </Link>
              .
            </GlassCardContent>
          </GlassCard>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {recentEvents.map((event) => {
              const eventActive = isEventActiveForPresence(event.status);

              return (
                <GlassCard key={event.id} elevated className="p-4" data-testid="event-card">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/events/${event.id}/join`}
                          className="font-medium text-slate-100 hover:text-cyan-300"
                          data-testid="event-title"
                        >
                          {event.title}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">
                          {t("events.latestActivity")}:{" "}
                          {formatDate(event.latestActivityAt ?? event.createdAt)}
                        </p>
                      </div>
                      <Badge variant={event.status === "COMPLETED" ? "success" : "info"} data-testid="event-status-badge">
                        {t(`events.status.${event.status}`)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1" data-testid="event-stats-summary">
                      {[
                        [t("events.activitySessions"), event.totalSessions, "event-total-sessions"],
                        [t("events.activeSession"), event.activeSessions, "event-active-sessions"],
                        [t("events.finishedSession"), event.finishedSessions, "event-finished-sessions"],
                        [t("events.activityLobby"), eventActive ? event.participantsInLobby : "—", "event-participants-in-lobby"],
                        [t("events.activityInSessions"), eventActive ? event.participantsInActiveSessions : "—", "event-participants-in-active-sessions"],
                      ].map(([label, value, testId]) => (
                        <span
                          key={String(testId)}
                          data-testid={String(testId)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-800/70 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-inset ring-slate-600/25"
                        >
                          <span className="text-slate-500">{label}</span>
                          <span className="font-medium text-slate-200">{value}</span>
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {eventActive ? (
                        <SecondaryButtonLink
                          href={`/events/${event.id}/join`}
                          data-testid="open-event-lobby-button"
                        >
                          {t("events.openLobby")}
                        </SecondaryButtonLink>
                      ) : (
                        <SecondaryButtonLink href="/sessions" data-testid="open-event-results-button">
                          {t("events.materials")}
                        </SecondaryButtonLink>
                      )}
                      <SecondaryButtonLink
                        href="/events"
                        data-testid="view-event-sessions-button"
                      >
                        {t("events.sessionsInThisEvent")}
                      </SecondaryButtonLink>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent cases */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-50">
            {t("dashboard.recentCases")}
          </h2>
          <Link
            href="/cases"
            className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
          >
            {t("common.viewAll")}
          </Link>
        </div>
        {recentCases.length === 0 ? (
          <GlassCard elevated>
            <GlassCardContent className="py-8 text-sm text-slate-400">
              {t("dashboard.noCasesYet")}{" "}
              <Link href="/cases/new" className="font-semibold text-cyan-400 hover:text-cyan-300">
                {t("dashboard.createFirstCase")}
              </Link>
              .
            </GlassCardContent>
          </GlassCard>
        ) : (
          <DataTable>
            <DataTableElement>
              <DataTableHead>
                <DataTableHeaderCell>{t("common.title")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("cases.difficulty")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("cases.roles")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("cases.caseLanguage")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("common.created")}</DataTableHeaderCell>
              </DataTableHead>
              <DataTableBody>
                {recentCases.map((negotiationCase) => (
                  <DataTableRow key={negotiationCase.id}>
                    <DataTableCell>
                      <Link
                        href={`/cases/${negotiationCase.id}`}
                        className="font-medium text-slate-100 hover:text-cyan-300"
                      >
                        {negotiationCase.title}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>
                      <DifficultyBadge difficulty={negotiationCase.difficulty} />
                    </DataTableCell>
                    <DataTableCell>{negotiationCase.roleCount}</DataTableCell>
                    <DataTableCell>
                      <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
                    </DataTableCell>
                    <DataTableCell>{formatDate(negotiationCase.createdAt)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTableElement>
          </DataTable>
        )}
      </section>

      {/* Recent sessions */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-50">
            {t("dashboard.recentSessions")}
          </h2>
          <Link
            href="/sessions"
            className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
          >
            {t("common.viewAll")}
          </Link>
        </div>
        {recentSessions.length === 0 ? (
          <GlassCard elevated>
            <GlassCardContent className="py-8 text-sm text-slate-400">
              {t("dashboard.noSessionsYet")}{" "}
              <Link href="/sessions/new" className="font-semibold text-cyan-400 hover:text-cyan-300">
                {t("dashboard.createFirstSession")}
              </Link>
              .
            </GlassCardContent>
          </GlassCard>
        ) : (
          <DataTable>
            <DataTableElement>
              <DataTableHead>
                <DataTableHeaderCell>{t("common.title")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("common.caseLabel")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("common.status")}</DataTableHeaderCell>
                <DataTableHeaderCell>{t("common.created")}</DataTableHeaderCell>
              </DataTableHead>
              <DataTableBody>
                {recentSessions.map((session) => (
                  <DataTableRow key={session.id}>
                    <DataTableCell>
                      <Link
                        href={`/sessions/${session.id}`}
                        className="font-medium text-slate-100 hover:text-cyan-300"
                      >
                        {session.title}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>{session.caseTitle}</DataTableCell>
                    <DataTableCell>
                      <SessionStatusBadge status={session.status} />
                    </DataTableCell>
                    <DataTableCell>{formatDate(session.createdAt)}</DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTableElement>
          </DataTable>
        )}
      </section>
    </div>
  );
}
