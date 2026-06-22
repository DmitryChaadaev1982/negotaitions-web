"use client";

import Link from "next/link";

import { NewSessionForm } from "@/components/new-session-form";
import { PageHeader } from "@/components/page-header";
import { SecondaryButtonLink } from "@/components/ui/buttons";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { alertErrorClassName } from "@/components/ui/form-styles";
import { useI18n } from "@/lib/i18n/useI18n";

type NewSessionPageClientProps = {
  cases: Array<{
    id: string;
    title: string;
    caseLanguage: "RU" | "EN";
    defaultDurationSeconds: number;
  }>;
  defaultCaseId?: string;
  deletedCaseError?: boolean;
};

export function NewSessionPageClient({
  cases,
  defaultCaseId,
  deletedCaseError = false,
}: NewSessionPageClientProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("sessions.newSession")}
        description={t("sessions.newSessionPageDescription")}
        action={
          <SecondaryButtonLink href="/sessions">
            {t("sessions.backToSessions")}
          </SecondaryButtonLink>
        }
      />

      {deletedCaseError ? (
        <div className={alertErrorClassName}>{t("validation.caseDeleted")}</div>
      ) : null}

      {cases.length === 0 ? (
        <GlassCard>
          <GlassCardContent className="py-8 text-sm text-slate-400">
            {t("sessions.needCaseFirst")}{" "}
            <Link href="/cases/new" className="font-medium text-cyan-400 hover:text-cyan-300">
              {t("sessions.createCaseFirst")}
            </Link>{" "}
            {t("sessions.createCaseFirstSuffix")}
          </GlassCardContent>
        </GlassCard>
      ) : (
        <NewSessionForm cases={cases} defaultCaseId={defaultCaseId} />
      )}
    </div>
  );
}
