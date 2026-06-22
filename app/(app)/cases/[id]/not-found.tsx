"use client";

import { GradientButtonLink } from "@/components/ui/buttons";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n/useI18n";

export default function CaseNotFound() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("cases.caseNotFound")}
        description={t("cases.caseNotFoundDescription")}
      />
      <GradientButtonLink href="/cases">
        {t("cases.backToCases")}
      </GradientButtonLink>
    </div>
  );
}
