"use client";

import type { CaseLanguage } from "@/app/generated/prisma/client";
import { useI18n } from "@/lib/i18n/useI18n";
import { cn } from "@/lib/cn";

type CaseLanguageBadgeProps = {
  caseLanguage: CaseLanguage;
  className?: string;
};

export function CaseLanguageBadge({
  caseLanguage,
  className,
}: CaseLanguageBadgeProps) {
  const { t } = useI18n();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-300 ring-1 ring-inset ring-violet-500/25",
        className,
      )}
    >
      {t("cases.caseLanguageLabel")}: {caseLanguage}
    </span>
  );
}
