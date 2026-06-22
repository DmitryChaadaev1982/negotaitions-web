"use client";

import Link from "next/link";

import { DeleteSessionButton } from "@/components/delete-session-button";
import { PageHeader } from "@/components/page-header";
import { SessionStatusBadge } from "@/components/session-status-badge";
import { GradientButtonLink } from "@/components/ui/buttons";
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
import { useI18n } from "@/lib/i18n/useI18n";

type SessionRow = {
  id: string;
  title: string;
  caseTitle: string;
  status: SessionDisplayStatus;
  participantCount: number;
  durationMinutes: number;
  createdAt: string;
};

type SessionsListViewProps = {
  sessions: SessionRow[];
};

export function SessionsListView({ sessions }: SessionsListViewProps) {
  const { t, locale } = useI18n();

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
                    {t("common.negotiationDurationValue", {
                      minutes: session.durationMinutes,
                    })}
                  </DataTableCell>
                  <DataTableCell>{formatDate(session.createdAt)}</DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex items-center justify-end gap-3">
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
