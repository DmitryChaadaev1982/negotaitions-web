"use client";

import { PublicContentShell } from "@/components/public-content-shell";
import { TextWithSupportEmail } from "@/components/public-support-email";
import { useI18n } from "@/lib/i18n/useI18n";
import { PUBLIC_FAQ_ITEMS } from "@/lib/public-site/faq-items";

export function PublicFaqPage() {
  const { t } = useI18n();

  return (
    <PublicContentShell testId="public-faq">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
        {t("publicFaq.title")}
      </h1>
      <div className="mt-8 space-y-3" data-testid="faq-list">
        {PUBLIC_FAQ_ITEMS.map((item) => (
          <details
            key={item.id}
            data-testid={`faq-item-${item.id}`}
            className="group rounded-2xl border border-slate-700/40 bg-slate-900/30"
          >
            <summary className="cursor-pointer rounded-2xl px-5 py-4 text-base font-medium text-slate-50 transition-colors hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70">
              {t(item.questionKey)}
            </summary>
            <div className="space-y-3 border-t border-slate-800/80 px-5 py-4 text-sm leading-6 text-slate-300 sm:text-base">
              {item.answerKeys.map((key) => (
                <p key={key}>
                  <TextWithSupportEmail text={t(key)} />
                </p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </PublicContentShell>
  );
}
