"use client";

import { PublicContentShell } from "@/components/public-content-shell";
import { PublicSupportEmailLink } from "@/components/public-support-email";
import { useI18n } from "@/lib/i18n/useI18n";

const supportTips = [
  "publicSupport.tip1",
  "publicSupport.tip2",
  "publicSupport.tip3",
  "publicSupport.tip4",
  "publicSupport.tip5",
  "publicSupport.tip6",
] as const;

export function PublicSupportPage() {
  const { t } = useI18n();

  return (
    <PublicContentShell testId="public-support">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
        {t("publicSupport.title")}
      </h1>
      <div className="mt-8 max-w-2xl space-y-6 text-base leading-7 text-slate-300">
        <p>{t("publicSupport.intro")}</p>
        <p>
          <PublicSupportEmailLink />
        </p>
        <p>{t("publicSupport.tipsIntro")}</p>
        <ul className="list-disc space-y-2 pl-5">
          {supportTips.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <p>{t("publicSupport.secrets")}</p>
        <p data-testid="support-privacy">{t("publicSupport.privacy")}</p>
        <p>{t("publicSupport.also")}</p>
      </div>
    </PublicContentShell>
  );
}
