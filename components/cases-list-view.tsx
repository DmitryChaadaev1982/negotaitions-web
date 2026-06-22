"use client";

import Link from "next/link";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DeleteCaseButton } from "@/components/delete-case-button";
import { DifficultyBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
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
  roleCount: number;
  defaultDurationMinutes: number;
  createdAt: string;
};

type CasesListViewProps = {
  cases: CaseRow[];
};

export function CasesListView({ cases }: CasesListViewProps) {
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
        title={t("cases.title")}
        description={t("cases.description")}
        action={
          <GradientButtonLink href="/cases/new">
            {t("cases.newCase")}
          </GradientButtonLink>
        }
      />

      {cases.length === 0 ? (
        <EmptyState
          message={t("cases.noCases")}
          action={
            <GradientButtonLink href="/cases/new">
              {t("cases.createCase")}
            </GradientButtonLink>
          }
        />
      ) : (
        <DataTable>
          <DataTableElement>
            <DataTableHead>
              <DataTableHeaderCell>{t("common.title")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("cases.difficulty")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("cases.caseLanguage")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("cases.roles")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("cases.defaultDuration")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.created")}</DataTableHeaderCell>
              <DataTableHeaderCell align="right">{t("common.actions")}</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {cases.map((negotiationCase) => (
                <DataTableRow key={negotiationCase.id}>
                  <DataTableCell>
                    <div className="font-medium text-slate-50">
                      {negotiationCase.title}
                    </div>
                    <p className="mt-1 line-clamp-1 max-w-md text-sm text-slate-400">
                      {negotiationCase.businessContext}
                    </p>
                  </DataTableCell>
                  <DataTableCell>
                    <DifficultyBadge difficulty={negotiationCase.difficulty} />
                  </DataTableCell>
                  <DataTableCell>
                    <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
                  </DataTableCell>
                  <DataTableCell>{negotiationCase.roleCount}</DataTableCell>
                  <DataTableCell>
                    {t("common.defaultDuration", {
                      minutes: negotiationCase.defaultDurationMinutes,
                    })}
                  </DataTableCell>
                  <DataTableCell>{formatDate(negotiationCase.createdAt)}</DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/cases/${negotiationCase.id}`}
                        className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                      >
                        {t("common.view")}
                      </Link>
                      <Link
                        href={`/cases/${negotiationCase.id}/edit`}
                        className="text-sm font-medium text-slate-400 hover:text-slate-300"
                      >
                        {t("common.edit")}
                      </Link>
                      <DeleteCaseButton caseId={negotiationCase.id} />
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
