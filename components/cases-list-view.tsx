"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DeleteCaseButton } from "@/components/delete-case-button";
import {
  getListActionButtonClassName,
  ListActionGroup,
  ListActionLink,
} from "@/components/list-action-button";
import { DifficultyBadge } from "@/components/badge";
import { ObjectPictogram } from "@/components/object-pictogram";
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
import { useI18n } from "@/lib/i18n/useI18n";

type CaseRow = {
  id: string;
  title: string;
  businessContext: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  caseLanguage: "RU" | "EN";
  visibility: "PUBLIC" | "PRIVATE";
  createdByUserId: string | null;
  createdByLabel: string | null;
  isMyCase: boolean;
  roleCount: number;
  defaultDurationMinutes: number;
  defaultPreparationDurationMinutes: number;
  createdAt: string;
};

type CasesListViewProps = {
  cases: CaseRow[];
  isAdminViewer: boolean;
};

const CASES_OVERVIEW_POLL_INTERVAL_MS = 3_000;

const CASE_VISIBILITY_FILTERS = ["all", "public", "private"] as const;
type CaseVisibilityFilter = (typeof CASE_VISIBILITY_FILTERS)[number];

const CASE_LANGUAGE_FILTERS = ["all", "ru", "en"] as const;
type CaseLanguageFilter = (typeof CASE_LANGUAGE_FILTERS)[number];

const CASE_DIFFICULTY_FILTERS = ["all", "easy", "medium", "hard"] as const;
type CaseDifficultyFilter = (typeof CASE_DIFFICULTY_FILTERS)[number];

const CASE_SORT_FIELDS = ["createdAt", "title", "difficulty", "duration", "roles"] as const;
type CaseSortField = (typeof CASE_SORT_FIELDS)[number];

type SortDirection = "asc" | "desc";

const DIFFICULTY_RANK: Record<CaseRow["difficulty"], number> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
};

function parseCaseVisibilityFilter(value: string | null): CaseVisibilityFilter {
  return (CASE_VISIBILITY_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as CaseVisibilityFilter)
    : "all";
}

function parseCaseLanguageFilter(value: string | null): CaseLanguageFilter {
  return (CASE_LANGUAGE_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as CaseLanguageFilter)
    : "all";
}

function parseCaseDifficultyFilter(value: string | null): CaseDifficultyFilter {
  return (CASE_DIFFICULTY_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as CaseDifficultyFilter)
    : "all";
}

function parseCaseSortField(value: string | null): CaseSortField {
  return (CASE_SORT_FIELDS as readonly string[]).includes(value ?? "")
    ? (value as CaseSortField)
    : "createdAt";
}

function parseSortDirection(value: string | null): SortDirection {
  return value === "asc" || value === "desc" ? value : "desc";
}

function sortDirectionForCaseField(field: CaseSortField): SortDirection {
  return field === "title" ? "asc" : "desc";
}

export function CasesListView({ cases, isAdminViewer }: CasesListViewProps) {
  const [caseRows, setCaseRows] = useState<CaseRow[]>(cases);
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const visibilityFilter = parseCaseVisibilityFilter(searchParams.get("visibility"));
  const languageFilter = parseCaseLanguageFilter(searchParams.get("language"));
  const difficultyFilter = parseCaseDifficultyFilter(searchParams.get("difficulty"));
  const sortField = parseCaseSortField(searchParams.get("sort"));
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

    const refreshCases = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        const response = await fetch("/api/cases/list", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { cases: CaseRow[] };
        setCaseRows(data.cases);
      } catch {
        // Ignore transient polling errors.
      } finally {
        inFlight = false;
      }
    };

    void refreshCases();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshCases();
      }
    }, CASES_OVERVIEW_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshCases();
      }
    };
    const handleFocus = () => {
      void refreshCases();
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

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase();
    return caseRows.filter((negotiationCase) => {
      if (
        visibilityFilter !== "all" &&
        negotiationCase.visibility !== visibilityFilter.toUpperCase()
      ) {
        return false;
      }

      if (
        languageFilter !== "all" &&
        negotiationCase.caseLanguage !== languageFilter.toUpperCase()
      ) {
        return false;
      }

      if (
        difficultyFilter !== "all" &&
        negotiationCase.difficulty !== difficultyFilter.toUpperCase()
      ) {
        return false;
      }

      if (normalizedQuery.length === 0) {
        return true;
      }

      return [negotiationCase.title, negotiationCase.businessContext]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [caseRows, difficultyFilter, languageFilter, query, visibilityFilter]);

  const sortedCases = useMemo(() => {
    const result = [...filteredCases];
    result.sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case "title":
          comparison = left.title.localeCompare(right.title, locale);
          break;
        case "difficulty":
          comparison = DIFFICULTY_RANK[left.difficulty] - DIFFICULTY_RANK[right.difficulty];
          break;
        case "roles":
          comparison = left.roleCount - right.roleCount;
          break;
        case "duration":
          comparison = left.defaultDurationMinutes - right.defaultDurationMinutes;
          break;
        case "createdAt":
        default:
          comparison = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
    return result;
  }, [filteredCases, locale, sortDirection, sortField]);

  const toggleSort = (field: CaseSortField) => {
    if (sortField === field) {
      replaceSearchParams({
        sort: field,
        dir: sortDirection === "asc" ? "desc" : "asc",
      });
      return;
    }
    replaceSearchParams({
      sort: field,
      dir: sortDirectionForCaseField(field),
    });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("cases.title")}
        description={t("cases.description")}
        pictogram={
          <ObjectPictogram
            objectType="case"
            size={64}
            className="h-16 w-16 shrink-0"
            data-object-type="case"
          />
        }
        action={
          <GradientButtonLink href="/cases/new">
            {t("cases.newCase")}
          </GradientButtonLink>
        }
      />

      {caseRows.length === 0 ? (
        <EmptyState
          message={t("cases.noCases")}
          action={
            <GradientButtonLink href="/cases/new">
              {t("cases.createCase")}
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
              <ListFilterGroup label={locale === "ru" ? "Язык" : "Language"}>
                <ListFilterChip
                  active={languageFilter === "all"}
                  onClick={() => replaceSearchParams({ language: null })}
                >
                  {locale === "ru" ? "Любой" : "Any"}
                </ListFilterChip>
                <ListFilterChip
                  active={languageFilter === "ru"}
                  onClick={() => replaceSearchParams({ language: "ru" })}
                >
                  RU
                </ListFilterChip>
                <ListFilterChip
                  active={languageFilter === "en"}
                  onClick={() => replaceSearchParams({ language: "en" })}
                >
                  EN
                </ListFilterChip>
              </ListFilterGroup>
              <ListFilterGroup label={locale === "ru" ? "Сложность" : "Difficulty"}>
                <ListFilterChip
                  active={difficultyFilter === "all"}
                  onClick={() => replaceSearchParams({ difficulty: null })}
                >
                  {locale === "ru" ? "Любая" : "Any"}
                </ListFilterChip>
                <ListFilterChip
                  active={difficultyFilter === "easy"}
                  onClick={() => replaceSearchParams({ difficulty: "easy" })}
                >
                  {locale === "ru" ? "Лёгкие" : "Easy"}
                </ListFilterChip>
                <ListFilterChip
                  active={difficultyFilter === "medium"}
                  onClick={() => replaceSearchParams({ difficulty: "medium" })}
                >
                  {locale === "ru" ? "Средние" : "Medium"}
                </ListFilterChip>
                <ListFilterChip
                  active={difficultyFilter === "hard"}
                  onClick={() => replaceSearchParams({ difficulty: "hard" })}
                >
                  {locale === "ru" ? "Сложные" : "Hard"}
                </ListFilterChip>
              </ListFilterGroup>
              <div className="ml-auto flex items-end">
                <ListFilterResetButton
                  onClick={() =>
                    replaceSearchParams({
                      q: null,
                      visibility: null,
                      language: null,
                      difficulty: null,
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
          <DataTableElement className="w-full table-fixed">
            <DataTableHead>
              <DataTableHeaderCell className="w-[18%] px-3 py-2.5">
                <SortHeaderButton
                  active={sortField === "title"}
                  direction={sortDirection}
                  onClick={() => toggleSort("title")}
                >
                  {t("common.title")}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[11%] px-3 py-2.5">
                <SortHeaderButton
                  active={sortField === "duration"}
                  direction={sortDirection}
                  onClick={() => toggleSort("duration")}
                >
                  {locale === "ru" ? (
                    <span className="leading-tight">
                      <span className="block">Длительность</span>
                      <span className="block">переговоров</span>
                    </span>
                  ) : (
                    <span className="leading-tight">
                      <span className="block">Negotiation</span>
                      <span className="block">duration</span>
                    </span>
                  )}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[9%] px-3 py-2.5">
                <SortHeaderButton
                  active={sortField === "difficulty"}
                  direction={sortDirection}
                  onClick={() => toggleSort("difficulty")}
                >
                  {t("cases.difficulty")}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[9%] px-3 py-2.5">{t("cases.caseLanguage")}</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[12%] px-3 py-2.5">{t("visibility.visibilityLabel")}</DataTableHeaderCell>
              <DataTableHeaderCell className="w-[6%] px-3 py-2.5">
                <SortHeaderButton
                  active={sortField === "roles"}
                  direction={sortDirection}
                  onClick={() => toggleSort("roles")}
                >
                  {t("cases.roles")}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell className="w-[8%] px-3 py-2.5">
                <SortHeaderButton
                  active={sortField === "createdAt"}
                  direction={sortDirection}
                  onClick={() => toggleSort("createdAt")}
                >
                  {t("common.created")}
                </SortHeaderButton>
              </DataTableHeaderCell>
              <DataTableHeaderCell align="right" className="w-[22%] px-3 py-2.5">{t("common.actions")}</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {sortedCases.map((negotiationCase) => (
                <DataTableRow key={negotiationCase.id}>
                  {(() => {
                    const canManageCase = isAdminViewer || negotiationCase.isMyCase;

                    return (
                      <>
                  <DataTableCell className="min-w-0 overflow-hidden px-3 py-2.5 align-top text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-50">
                        {negotiationCase.title}
                      </div>
                      <p className="mt-1 line-clamp-2 leading-5 text-slate-400">
                        {negotiationCase.businessContext}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {negotiationCase.isMyCase
                        ? t("cases.myCase")
                        : `${t("cases.createdBy")}: ${
                            negotiationCase.createdByLabel ??
                            t("cases.legacyCase")
                          }`}
                    </p>
                  </DataTableCell>
                  <DataTableCell className="px-3 py-2.5 align-top text-xs">
                    {locale === "ru"
                      ? `${negotiationCase.defaultDurationMinutes} мин.`
                      : `${negotiationCase.defaultDurationMinutes} min.`}
                  </DataTableCell>
                  <DataTableCell className="px-3 py-2.5 align-top text-xs">
                    <DifficultyBadge difficulty={negotiationCase.difficulty} />
                  </DataTableCell>
                  <DataTableCell className="px-3 py-2.5 align-top text-xs">
                    <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
                  </DataTableCell>
                  <DataTableCell className="px-3 py-2.5 align-top text-xs">
                    <VisibilityBadge visibility={negotiationCase.visibility} />
                    {negotiationCase.visibility === "PRIVATE" && negotiationCase.createdByLabel ? (
                      <p className="mt-0.5 text-xs text-slate-500" data-testid="case-owner-label">
                        Owner: {negotiationCase.createdByLabel}
                      </p>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell className="px-3 py-2.5 align-top text-xs">{negotiationCase.roleCount}</DataTableCell>
                  <DataTableCell className="px-3 py-2.5 align-top text-xs">{formatDate(negotiationCase.createdAt)}</DataTableCell>
                  <DataTableCell align="right" className="px-3 py-2.5 align-top text-xs">
                    <ListActionGroup>
                      <ListActionLink
                        href={`/cases/${negotiationCase.id}`}
                        variant="primary"
                      >
                        {t("common.view")}
                      </ListActionLink>
                      {canManageCase ? (
                        <>
                          <ListActionLink
                            href={`/cases/${negotiationCase.id}/edit`}
                            variant="secondary"
                          >
                            {t("common.edit")}
                          </ListActionLink>
                          <DeleteCaseButton
                            caseId={negotiationCase.id}
                            className={getListActionButtonClassName("danger")}
                          />
                        </>
                      ) : null}
                    </ListActionGroup>
                  </DataTableCell>
                      </>
                    );
                  })()}
                </DataTableRow>
              ))}
              {sortedCases.length === 0 ? (
                <DataTableRow>
                  <DataTableCell colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">
                    {locale === "ru" ? "Ничего не найдено по текущим фильтрам." : "No cases match the current filters."}
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
