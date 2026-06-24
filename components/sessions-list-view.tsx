"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DeleteSessionButton } from "@/components/delete-session-button";
import { PageHeader } from "@/components/page-header";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { GradientButtonLink } from "@/components/ui/buttons";
import { buildSessionMaterialsPath, buildSessionRoomPath } from "@/lib/config";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableElement,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { SessionDisplayStatus } from "@/lib/session-display-status";
import {
  applySessionOverviewStats,
  isSessionActiveForPresence,
  isSessionActiveForRoom,
  type SessionOverviewStats,
} from "@/lib/session-overview-shared";
import { PRESENCE_OVERVIEW_POLL_INTERVAL_MS } from "@/lib/presence";
import { useI18n } from "@/lib/i18n/useI18n";

type SessionRow = {
  id: string;
  title: string;
  caseTitle: string;
  status: SessionDisplayStatus;
  negotiationState: "PREPARATION" | "PREPARATION_RUNNING" | "PREPARATION_PAUSED" | "READY_TO_START" | "RUNNING" | "PAUSED" | "FINISHED";
  closedByEventAt: string | null;
  facilitatorJoinToken: string | null;
  participantCount: number;
  onlineParticipantCount: number;
  durationMinutes: number;
  createdAt: string;
};

type SessionsListViewProps = {
  sessions: SessionRow[];
};

export function SessionsListView({ sessions: initialSessions }: SessionsListViewProps) {
  const { t, locale } = useI18n();
  const [sessionStats, setSessionStats] = useState<SessionOverviewStats[]>([]);
  const sessions = useMemo(
    () => applySessionOverviewStats(initialSessions, sessionStats),
    [initialSessions, sessionStats],
  );

  useEffect(() => {
    let cancelled = false;

    const refreshStats = async () => {
      try {
        const response = await fetch("/api/sessions/overview", {
          cache: "no-store",
        });

        if (!response.ok || cancelled) {
          return;
        }

        const data = (await response.json()) as {
          sessions: SessionOverviewStats[];
        };

        setSessionStats(data.sessions);
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
    <div className="space-y-8">
      <PageHeader
        title={t("sessions.title")}
        description={t("sessions.description")}
        action={
          <GradientButtonLink href="/sessions/new">
            {t("sessions.newSession")}
          </GradientButtonLink>
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          message={t("sessions.noSessions")}
          action={
            <GradientButtonLink href="/sessions/new">
              {t("sessions.createSession")}
            </GradientButtonLink>
          }
        />
      ) : (
        <DataTable>
          <DataTableElement>
            <DataTableHead>
              <DataTableHeaderCell>{t("common.title")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.caseLabel")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.status")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("sessions.participants")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.onlineNow")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.negotiationDuration")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.created")}</DataTableHeaderCell>
              <DataTableHeaderCell align="right">{t("common.actions")}</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {sessions.map((session) => (
                <DataTableRow key={session.id}>
                  <DataTableCell>
                    <Link
                      href={`/sessions/${session.id}`}
                      className="font-medium text-slate-50 hover:text-blue-300"
                    >
                      {session.title}
                    </Link>
                  </DataTableCell>
                  <DataTableCell>{session.caseTitle}</DataTableCell>
                  <DataTableCell>
                    <SessionStatusBadge status={session.status} />
                  </DataTableCell>
                  <DataTableCell>{session.participantCount}</DataTableCell>
                  <DataTableCell>
                    {isSessionActiveForPresence(session)
                      ? session.onlineParticipantCount
                      : "—"}
                  </DataTableCell>
                  <DataTableCell>
                    {t("common.negotiationDurationValue", {
                      minutes: session.durationMinutes,
                    })}
                  </DataTableCell>
                  <DataTableCell>{formatDate(session.createdAt)}</DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {session.facilitatorJoinToken ? (
                        <Link
                          href={buildSessionMaterialsPath(session.facilitatorJoinToken)}
                          className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                        >
                          {t("sessions.openMaterials")}
                        </Link>
                      ) : null}
                      {session.facilitatorJoinToken &&
                      isSessionActiveForRoom(session) ? (
                        <Link
                          href={buildSessionRoomPath(
                            session.id,
                            session.facilitatorJoinToken,
                          )}
                          className="text-sm font-medium text-emerald-400 hover:text-emerald-300"
                        >
                          {t("sessions.openRoom")}
                        </Link>
                      ) : null}
                      <Link
                        href={`/sessions/${session.id}`}
                        className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                      >
                        {t("common.manage")}
                      </Link>
                      <DeleteSessionButton sessionId={session.id} />
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableElement>
        </DataTable>
      )}
    </div>
  );
}
