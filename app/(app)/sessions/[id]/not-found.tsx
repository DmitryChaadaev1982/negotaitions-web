"use client";

import { GradientButtonLink } from "@/components/ui/buttons";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n/useI18n";

export default function SessionNotFound() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("sessions.sessionNotFound")}
        description={t("sessions.sessionNotFoundDescription")}
      />
      <GradientButtonLink href="/sessions">
        {t("sessions.backToSessions")}
      </GradientButtonLink>
    </div>
  );
}
