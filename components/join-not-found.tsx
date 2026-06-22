"use client";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/ui/brand-logo";
import { GradientButtonLink } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";

export function JoinNotFound() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-full items-center justify-center app-gradient-bg px-4">
      <div className="max-w-md space-y-6 text-center">
        <div className="flex items-center justify-center gap-4">
          <BrandLogo size="sm" href={undefined} />
          <LanguageSwitcher />
        </div>
        <h1 className="text-2xl font-bold text-slate-50">
          {t("join.invalidJoinLink")}
        </h1>
        <p className="text-sm text-slate-400">
          {t("join.invalidJoinLinkDescription")}
        </p>
        <GradientButtonLink href="/">{t("common.goToHome")}</GradientButtonLink>
      </div>
    </div>
  );
}
