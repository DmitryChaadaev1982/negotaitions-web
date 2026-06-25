"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
import {
  applySessionOverviewStats,
  isSessionActiveForPresence,
  type SessionOverviewStats,
} from "@/lib/session-overview-shared";
import { PRESENCE_OVERVIEW_POLL_INTERVAL_MS } from "@/lib/presence";
import { useI18n } from "@/lib/i18n/useI18n";

type SessionRow = {
  id: string;
  title: string;
  caseTitle: string;
  eventId: string | null;
  eventTitle: string | null;
  eventStatus: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED" | null;
  eventLobbyUrl: string | null;
  status: SessionDisplayStatus;
  negotiationState: "PREPARATION" | "PREPARATION_RUNNING" | "PREPARATION_PAUSED" | "READY_TO_START" | "RUNNING" | "PAUSED" | "FINISHED";
  closedByEventAt: string | null;
  // facilitatorJoinToken is intentionally absent — tokens must not be embedded
  // in list HTML. Session detail and materials are accessible via /sessions/[id].
  participantCount: number;
  onlineParticipantCount: number;
  durationMinutes: number;
  createdAt: string;
  recordingStage: string | null;
  transcriptStage: string | null;
  speakerMappingStage: string | null;
  aiStage: string | null;
  aiVisibility: string;
};

type SessionsListViewProps = {
  sessions: SessionRow[];
};

// ── AI pipeline status mini-badge ─────────────────────────────────────────

function aiStageTone(stage: string | null): string {
  if (stage === "ready") return "text-emerald-400";
  if (stage === "shared") return "text-cyan-400";
  if (stage === "in_progress") return "text-amber-400";
  if (stage === "failed") return "text-rose-400";
  return "text-slate-500";
}

// Shows AI pipeline status only. Token-based actions (transcribe, analyze,
// share) have been removed from the list view — facilitatorJoinToken must not
// be embedded in list HTML. Use the session detail page (/sessions/[id]) for
// those operations (Phase 4 will add account-authorized server routes).
function AiStatusCell({ session }: { session: SessionRow }) {
  const { t } = useI18n();

  const aiShared = session.aiStage === "shared";
  const aiReady = session.aiStage === "ready";
  const aiInProgress = session.aiStage === "in_progress";

  const speakerMappingRequired = session.speakerMappingStage === "required";
  const speakerMappingConfirmed = session.speakerMappingStage === "confirmed";

  const stageLabel = aiShared
    ? t("sessions.aiStatusShared")
    : aiReady
      ? t("sessions.aiStatusReady")
      : aiInProgress
        ? t("sessions.aiStatusInProgress")
        : session.aiStage === "failed"
          ? t("sessions.aiStatusFailed")
          : null;

  return (
    <div className="flex flex-col gap-1 min-w-[10rem]">
      {speakerMappingRequired ? (
        <span className="text-xs font-medium text-amber-400" data-testid="sessions-speaker-mapping-required-badge">
          {t("room.speakerMappingRequired")}
        </span>
      ) : speakerMappingConfirmed ? (
        <span className="text-xs font-medium text-emerald-400" data-testid="sessions-speaker-mapping-confirmed-badge">
          {t("room.speakerMappingConfirmed")}
        </span>
      ) : null}

      {stageLabel ? (
        <span className={`text-xs font-medium ${aiStageTone(session.aiStage)}`}>
          {stageLabel}
        </span>
      ) : null}

      {aiInProgress ? (
        <span className="text-xs text-cyan-400 animate-pulse">
          {t("sessions.aiStatusInProgress")}...
        </span>
      ) : null}

      {aiShared ? (
        <span
          className="text-xs font-medium text-cyan-400"
          data-testid="sessions-analysis-shared-badge"
        >
          {t("sessions.analysisSharedBadge")}
        </span>
      ) : null}
    </div>
  );
}

export function SessionsListView({ sessions: initialSessions }: SessionsListViewProps) {
  const { t, locale } = useI18n();
  const [sessionStats, setSessionStats] = useState<SessionOverviewStats[]>([]);
  const sessions = applySessionOverviewStats(initialSessions, sessionStats);

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
              <DataTableHeaderCell>{t("events.eventColumn")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.status")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("sessions.aiAnalysis")}</DataTableHeaderCell>
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
                    {session.eventTitle ? (
                      <div className="max-w-[14rem]">
                        <p className="truncate text-sm text-slate-200">
                          {session.eventTitle}
                        </p>
                        {session.eventStatus ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {t(`events.status.${session.eventStatus}`)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    <SessionStatusBadge status={session.status} />
                  </DataTableCell>
                  <DataTableCell>
                    <AiStatusCell session={session} />
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
                      {session.eventLobbyUrl && session.eventStatus !== "COMPLETED" ? (
                        <Link
                          href={session.eventLobbyUrl}
                          className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                          data-testid="open-event-lobby-button"
                        >
                          {t("events.openLobby")}
                        </Link>
                      ) : null}
                      {session.eventStatus === "COMPLETED" && session.eventId ? (
                        <Link
                          href={session.eventLobbyUrl ?? `/events/${session.eventId}/lobby`}
                          className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                          data-testid="open-event-results-button"
                        >
                          {t("events.materials")}
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
