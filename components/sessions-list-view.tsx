"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CompleteSessionButton } from "@/components/complete-session-button";
import { DeleteSessionButton } from "@/components/delete-session-button";
import {
  getListActionButtonClassName,
  ListActionGroup,
  ListActionLink,
} from "@/components/list-action-button";
import { PageHeader } from "@/components/page-header";
import { SessionStatusBadge } from "@/components/session-status-badge";
import {
  ListFilterBar,
  ListFilterChip,
  ListFilterGroup,
  ListFilterGroups,
  ListFilterInput,
  ListFilterResetButton,
  SortHeaderButton,
} from "@/components/table-list-controls";
import { VisibilityBadge } from "@/components/visibility-badge";
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
  isSessionActiveForPresence,
} from "@/lib/session-overview-shared";
import { useI18n } from "@/lib/i18n/useI18n";

const SESSIONS_OVERVIEW_POLL_INTERVAL_MS = 3_000;

type SessionRow = {
  id: string;
  title: string;
  visibility?: "PUBLIC" | "PRIVATE";
  userRole: "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | "HOST" | null;
  canManage: boolean;
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
  aiPublicationStatus?: "none" | "partial" | "full" | null;
  aiVisibility: string;
  roomUrl: string;
  materialsUrl: string;
  ownerLabel?: string | null;
};

type SessionsListViewProps = {
  sessions: SessionRow[];
};

const SESSION_STATUS_FILTERS = [
  "all",
  "unfinished",
  "draft",
  "preparation",
  "active",
  "completed",
  "cancelled",
] as const;

type SessionStatusFilter = (typeof SESSION_STATUS_FILTERS)[number];

const SESSION_AI_FILTERS = ["all", "with", "without"] as const;
type SessionAiFilter = (typeof SESSION_AI_FILTERS)[number];

const SESSION_SORT_FIELDS = [
  "createdAt",
  "title",
  "status",
  "participants",
] as const;
type SessionSortField = (typeof SESSION_SORT_FIELDS)[number];

type SortDirection = "asc" | "desc";

function parseSessionStatusFilter(value: string | null): SessionStatusFilter {
  return (SESSION_STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as SessionStatusFilter)
    : "all";
}

function parseSessionAiFilter(value: string | null): SessionAiFilter {
  return (SESSION_AI_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as SessionAiFilter)
    : "all";
}

function parseSessionSortField(value: string | null): SessionSortField {
  return (SESSION_SORT_FIELDS as readonly string[]).includes(value ?? "")
    ? (value as SessionSortField)
    : "createdAt";
}

function parseSortDirection(value: string | null): SortDirection {
  return value === "asc" || value === "desc" ? value : "desc";
}

function sortDirectionForSessionField(field: SessionSortField): SortDirection {
  return field === "title" ? "asc" : "desc";
}

function hasAiAnalysis(session: SessionRow): boolean {
  return session.aiStage != null && session.aiStage !== "not_started";
}

function matchesSessionStatusFilter(
  session: SessionRow,
  filter: SessionStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "unfinished") return session.status !== "FINISHED";
  if (filter === "draft") return session.status === "DRAFT" || session.status === "READY";
  if (filter === "preparation") {
    return (
      session.status === "PREPARATION" ||
      session.status === "PREPARATION_RUNNING" ||
      session.status === "PREPARATION_PAUSED" ||
      session.status === "READY_TO_START"
    );
  }
  if (filter === "active") return session.status === "RUNNING" || session.status === "PAUSED";
  if (filter === "completed") return session.status === "FINISHED";
  if (filter === "cancelled") return session.closedByEventAt != null;
  return true;
}

const SESSION_STATUS_SORT_RANK: Record<SessionDisplayStatus, number> = {
  DRAFT: 1,
  READY: 2,
  PREPARATION: 3,
  PREPARATION_RUNNING: 4,
  PREPARATION_PAUSED: 5,
  READY_TO_START: 6,
  RUNNING: 7,
  PAUSED: 8,
  FINISHED: 9,
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

  const aiReady = session.aiStage === "ready";
  const aiInProgress = session.aiStage === "in_progress";

  const speakerMappingRequired = session.speakerMappingStage === "required";
  const speakerMappingConfirmed = session.speakerMappingStage === "confirmed";

  const publicationLabel =
    session.aiPublicationStatus === "full"
      ? t("sessions.aiStatusPublished")
      : session.aiPublicationStatus === "partial"
        ? t("sessions.aiStatusPartiallyPublished")
        : null;

  const stageLabel = aiReady
      ? t("sessions.aiStatusReady")
      : aiInProgress
        ? t("sessions.aiStatusInProgress")
        : session.aiStage === "failed"
          ? t("sessions.aiStatusFailed")
          : null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
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

      {publicationLabel ? (
        <span
          className="text-xs font-medium text-cyan-400"
          data-testid="sessions-analysis-shared-badge"
        >
          {publicationLabel}
        </span>
      ) : null}
    </div>
  );
}

export function SessionsListView({ sessions: initialSessions }: SessionsListViewProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions);
  const sessionsWithStats = sessions;
  const query = searchParams.get("q")?.trim() ?? "";
  const statusFilter = parseSessionStatusFilter(searchParams.get("status"));
  const aiFilter = parseSessionAiFilter(searchParams.get("ai"));
  const eventIdFilter = searchParams.get("eventId")?.trim() ?? "";
  const rawSortField = searchParams.get("sort");
  const sortField = rawSortField === "online" ? "participants" : parseSessionSortField(rawSortField);
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
    let inFlight = false;
    let currentController: AbortController | null = null;

    const refreshSessions = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        const response = await fetch("/api/sessions/list", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { sessions: SessionRow[] };
        setSessions(data.sessions);
      } catch {
        // Ignore transient polling errors.
      } finally {
        inFlight = false;
      }
    };

    void refreshSessions();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSessions();
      }
    }, SESSIONS_OVERVIEW_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSessions();
      }
    };
    const handleFocus = () => {
      void refreshSessions();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      currentController?.abort();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase();
    return sessionsWithStats.filter((session) => {
      if (eventIdFilter.length > 0 && session.eventId !== eventIdFilter) {
        return false;
      }

      if (!matchesSessionStatusFilter(session, statusFilter)) {
        return false;
      }

      if (aiFilter === "with" && !hasAiAnalysis(session)) {
        return false;
      }

      if (aiFilter === "without" && hasAiAnalysis(session)) {
        return false;
      }

      if (normalizedQuery.length === 0) {
        return true;
      }

      return [
        session.title,
        session.caseTitle,
        session.eventTitle ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [aiFilter, eventIdFilter, query, sessionsWithStats, statusFilter]);

  const sortedSessions = useMemo(() => {
    const result = [...filteredSessions];
    result.sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case "title":
          comparison = left.title.localeCompare(right.title, locale);
          break;
        case "status":
          comparison = SESSION_STATUS_SORT_RANK[left.status] - SESSION_STATUS_SORT_RANK[right.status];
          break;
        case "participants":
          comparison = left.participantCount - right.participantCount;
          break;
        case "createdAt":
        default:
          comparison = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
    return result;
  }, [filteredSessions, locale, sortDirection, sortField]);

  const activeEventTitle =
    eventIdFilter.length > 0
      ? sessionsWithStats.find((session) => session.eventId === eventIdFilter)?.eventTitle ?? eventIdFilter
      : null;

  const toggleSort = (field: SessionSortField) => {
    if (sortField === field) {
      replaceSearchParams({
        sort: field,
        dir: sortDirection === "asc" ? "desc" : "asc",
      });
      return;
    }
    replaceSearchParams({
      sort: field,
      dir: sortDirectionForSessionField(field),
    });
  };

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

      {sessionsWithStats.length === 0 ? (
        <EmptyState
          message={t("dashboard.noSessionsYetAccount")}
          action={
            <GradientButtonLink href="/sessions/new">
              {t("sessions.createSession")}
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
                  active={statusFilter === "preparation"}
                  onClick={() => replaceSearchParams({ status: "preparation" })}
                >
                  {locale === "ru" ? "Подготовка" : "Preparation"}
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
              <ListFilterGroup label={locale === "ru" ? "AI-разбор" : "AI analysis"}>
                <ListFilterChip
                  active={aiFilter === "all"}
                  onClick={() => replaceSearchParams({ ai: null })}
                >
                  {locale === "ru" ? "Любой" : "Any"}
                </ListFilterChip>
                <ListFilterChip
                  active={aiFilter === "with"}
                  onClick={() => replaceSearchParams({ ai: "with" })}
                >
                  {locale === "ru" ? "С анализом" : "With analysis"}
                </ListFilterChip>
                <ListFilterChip
                  active={aiFilter === "without"}
                  onClick={() => replaceSearchParams({ ai: "without" })}
                >
                  {locale === "ru" ? "Без анализа" : "Without analysis"}
                </ListFilterChip>
              </ListFilterGroup>
              {activeEventTitle ? (
                <ListFilterGroup
                  label={locale === "ru" ? "Встреча" : "Event"}
                  className="min-w-[14rem]"
                >
                  <span
                    className="rounded-md bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200 ring-1 ring-inset ring-cyan-500/30"
                    data-testid="sessions-event-filter-chip"
                  >
                    {locale === "ru"
                      ? `Сессии встречи: ${activeEventTitle}`
                      : `Event sessions: ${activeEventTitle}`}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                    onClick={() => replaceSearchParams({ eventId: null })}
                  >
                    {locale === "ru" ? "Убрать фильтр встречи" : "Clear event filter"}
                  </button>
                </ListFilterGroup>
              ) : null}
              <div className="ml-auto flex items-end">
                <ListFilterResetButton
                  onClick={() =>
                    replaceSearchParams({
                      q: null,
                      status: null,
                      ai: null,
                      eventId: null,
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
          <DataTable scrollAreaClassName="max-h-[calc(100vh-260px)] overflow-auto overscroll-contain">
          <DataTableElement className="min-w-[1120px] w-full table-fixed">
            <DataTableHead>
              <DataTableHeaderCell className="w-[15%] px-1.5 py-1.5">
                <SortHeaderButton
                  active={sortField === "title"}
                  direction={sortDirection}
                  onClick={() => toggleSort("title")}
                >
                  {t("common.title")}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[11%] px-1.5 py-1.5">{t("common.caseLabel")}</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[7%] px-1.5 py-1.5">
                {locale === "ru" ? "ДЛИТ." : "DUR."}
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[11%] px-1.5 py-1.5">{t("events.eventColumn")}</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[11%] px-1.5 py-1.5">
                <SortHeaderButton
                  active={sortField === "status"}
                  direction={sortDirection}
                  onClick={() => toggleSort("status")}
                >
                  {t("common.status")}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[12%] px-1.5 py-1.5">{t("sessions.aiAnalysis")}</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[12%] px-1.5 py-1.5">
                <SortHeaderButton
                  active={sortField === "participants"}
                  direction={sortDirection}
                  onClick={() => toggleSort("participants")}
                >
                  {locale === "ru" ? "Активность" : "Activity"}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell align="right" className="w-[14%] px-1.5 py-1.5">{t("common.actions")}</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[5%] px-1.5 py-1.5">
                <SortHeaderButton
                  active={sortField === "createdAt"}
                  direction={sortDirection}
                  onClick={() => toggleSort("createdAt")}
                >
                  {t("common.created")}
                </SortHeaderButton>
              </DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {sortedSessions.map((session) => (
                <DataTableRow key={session.id} className="align-top" data-testid="session-row">
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    <div className="flex min-w-0 items-start gap-2">
                      {/**
                       * Non-managers can access PUBLIC/open sessions via the room entrypoint.
                       * The detail page is manager-only, so route title clicks accordingly.
                       */}
                      <Link
                        href={session.canManage ? `/sessions/${session.id}` : session.roomUrl}
                        className="line-clamp-3 min-w-0 font-medium leading-5 text-slate-50 hover:text-blue-300"
                      >
                        {session.title}
                      </Link>
                      {session.visibility ? (
                        <VisibilityBadge visibility={session.visibility} showLabel={false} />
                      ) : null}
                    </div>
                    {session.visibility === "PRIVATE" && session.ownerLabel ? (
                      <p className="mt-0.5 text-xs text-slate-500" data-testid="session-owner-label">
                        {t("sessions.facilitatorOwnerLabel")}: {session.ownerLabel}
                      </p>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    <p className="line-clamp-3 leading-5 text-slate-200">{session.caseTitle}</p>
                  </DataTableCell>
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    {locale === "ru"
                      ? `${session.durationMinutes} мин.`
                      : `${session.durationMinutes} min.`}
                  </DataTableCell>
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    {session.eventTitle ? (
                      <div className="min-w-0 max-w-[14rem]">
                        <p className="line-clamp-2 leading-5 text-slate-200">
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
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    <SessionStatusBadge status={session.status} />
                  </DataTableCell>
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    <AiStatusCell session={session} />
                  </DataTableCell>
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-300">
                        {locale === "ru" ? "Участн." : "Participants"} {session.participantCount}
                      </span>
                      <span className="rounded bg-slate-800/70 px-1.5 py-0.5 text-[11px] text-slate-300">
                        {locale === "ru" ? "Онлайн" : "Online"}{" "}
                        {isSessionActiveForPresence(session)
                          ? session.onlineParticipantCount
                          : "—"}
                      </span>
                    </div>
                  </DataTableCell>
                  <DataTableCell align="right" className="max-w-[10rem] px-1.5 py-1 align-top text-xs">
                    <ListActionGroup className="flex-nowrap flex-col items-end gap-1">
                      {session.eventLobbyUrl && session.eventStatus !== "COMPLETED" ? (
                        <ListActionLink
                          href={session.eventLobbyUrl}
                          variant="primary"
                          className="h-6 px-1.5 text-[10px]"
                          data-testid="open-event-lobby-button"
                        >
                          {t("events.openLobby")}
                        </ListActionLink>
                      ) : null}
                      {session.status !== "FINISHED" ? (
                        <ListActionLink
                          href={session.roomUrl}
                          variant="primary"
                          className="h-6 px-1.5 text-[10px]"
                          data-testid="open-room-button"
                        >
                          {t("dashboard.openRoom")}
                        </ListActionLink>
                      ) : null}
                      <ListActionLink
                        href={session.materialsUrl}
                        variant="secondary"
                        className="h-6 px-1.5 text-[10px]"
                        data-testid="open-materials-button"
                      >
                        {t("dashboard.openMaterials")}
                      </ListActionLink>
                      {session.canManage ? (
                        <>
                          <ListActionLink
                            href={`/sessions/${session.id}`}
                            variant="secondary"
                            className="h-6 px-1.5 text-[10px]"
                            data-testid="manage-session-button"
                          >
                            {t("common.manage")}
                          </ListActionLink>
                          {session.status !== "FINISHED" ? (
                            <CompleteSessionButton
                              sessionId={session.id}
                              className={getListActionButtonClassName(
                                "dangerOutline",
                                "h-6 px-1.5 text-[10px]",
                              )}
                              onCompleted={() => {
                                setSessions((current) =>
                                  current.map((item) =>
                                    item.id === session.id
                                      ? {
                                          ...item,
                                          status: "FINISHED",
                                          negotiationState: "FINISHED",
                                        }
                                      : item,
                                  ),
                                );
                              }}
                            />
                          ) : null}
                          <DeleteSessionButton
                            sessionId={session.id}
                            testId="delete-session-button"
                            className={getListActionButtonClassName("danger", "h-6 px-1.5 text-[10px]")}
                          />
                        </>
                      ) : null}
                    </ListActionGroup>
                  </DataTableCell>
                  <DataTableCell className="px-1.5 py-1 align-top text-xs">{formatDate(session.createdAt)}</DataTableCell>
                </DataTableRow>
              ))}
              {sortedSessions.length === 0 ? (
                <DataTableRow>
                  <DataTableCell
                    colSpan={9}
                    className="px-3 py-6 text-center text-sm text-slate-400"
                    align="left"
                  >
                    {locale === "ru" ? "Ничего не найдено по текущим фильтрам." : "No sessions match the current filters."}
                  </DataTableCell>
                </DataTableRow>
              ) : null}
            </DataTableBody>
          </DataTableElement>
        </DataTable>
        </>
      )}
    </div>
  );
}
