"use client";

import Link from "next/link";

import { CaseLanguageBadge } from "@/components/case-language-badge";
import { DeleteCaseButton } from "@/components/delete-case-button";
import { DifficultyBadge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
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

export function CasesListView({ cases, isAdminViewer }: CasesListViewProps) {
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
              <DataTableHeaderCell>{t("visibility.visibilityLabel")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("cases.roles")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.negotiationDuration")}</DataTableHeaderCell>
              <DataTableHeaderCell>{t("common.created")}</DataTableHeaderCell>
              <DataTableHeaderCell align="right">{t("common.actions")}</DataTableHeaderCell>
            </DataTableHead>
            <DataTableBody>
              {cases.map((negotiationCase) => (
                <DataTableRow key={negotiationCase.id}>
                  {(() => {
                    const canManageCase = isAdminViewer || negotiationCase.isMyCase;

                    return (
                      <>
                  <DataTableCell>
                    <div className="font-medium text-slate-50">
                      {negotiationCase.title}
                    </div>
                    <p className="mt-1 line-clamp-1 max-w-md text-sm text-slate-400">
                      {negotiationCase.businessContext}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {negotiationCase.isMyCase
                        ? t("cases.myCase")
                        : `${t("cases.createdBy")}: ${
                            negotiationCase.createdByLabel ??
                            t("cases.legacyCase")
                          }`}
                    </p>
                  </DataTableCell>
                  <DataTableCell>
                    <DifficultyBadge difficulty={negotiationCase.difficulty} />
                  </DataTableCell>
                  <DataTableCell>
                    <CaseLanguageBadge caseLanguage={negotiationCase.caseLanguage} />
                  </DataTableCell>
                  <DataTableCell>
                    <VisibilityBadge visibility={negotiationCase.visibility} />
                  </DataTableCell>
                  <DataTableCell>{negotiationCase.roleCount}</DataTableCell>
                  <DataTableCell>
                    {t("common.negotiationDurationValue", {
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
                      {canManageCase ? (
                        <>
                          <Link
                            href={`/cases/${negotiationCase.id}/edit`}
                            className="text-sm font-medium text-slate-400 hover:text-slate-300"
                          >
                            {t("common.edit")}
                          </Link>
                          <DeleteCaseButton caseId={negotiationCase.id} />
                        </>
                      ) : null}
                    </div>
                  </DataTableCell>
                      </>
                    );
                  })()}
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableElement>
        </DataTable>
      )}
    </div>
  );
}
