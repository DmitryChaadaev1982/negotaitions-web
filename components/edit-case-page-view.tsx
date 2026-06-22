"use client";

import { PageHeader } from "@/components/page-header";
import {
  NewCaseForm,
  type CaseFormInitialValues,
} from "@/components/new-case-form";
import { useI18n } from "@/lib/i18n/useI18n";

type EditCasePageViewProps = {
  caseId: string;
  initialValues: CaseFormInitialValues;
};

export function EditCasePageView({
  caseId,
  initialValues,
}: EditCasePageViewProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("cases.editCase")}
        description={t("cases.editCasePageDescription")}
      />
      <NewCaseForm caseId={caseId} initialValues={initialValues} />
    </div>
  );
}
