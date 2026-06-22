"use client";

import { PageHeader } from "@/components/page-header";
import { NewCaseForm } from "@/components/new-case-form";
import { useI18n } from "@/lib/i18n/useI18n";

export default function NewCasePage() {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("cases.newCase")}
        description={t("cases.newCasePageDescription")}
      />
      <NewCaseForm />
    </div>
  );
}
