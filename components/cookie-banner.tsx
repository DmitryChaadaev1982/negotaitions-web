"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  acceptAllCookies,
  rejectOptionalCookies,
  storeCookieConsent,
  needsCookieConsentBanner,
  getStoredCookieConsent,
} from "@/lib/consent/cookie-consent";
import { useI18n } from "@/lib/i18n/useI18n";

type PanelMode = "banner" | "customize" | "hidden";

export function CookieBanner() {
  const { t } = useI18n();
  const [mode, setMode] = useState<PanelMode>("hidden");
  const [analyticsChecked, setAnalyticsChecked] = useState(false);
  const [marketingChecked, setMarketingChecked] = useState(false);

  useEffect(() => {
    // Reading localStorage is only possible after hydration on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needsCookieConsentBanner()) setMode("banner");
  }, []);

  // Allow re-opening from external trigger
  useEffect(() => {
    const handler = () => {
      const stored = getStoredCookieConsent();
      setAnalyticsChecked(stored?.analytics ?? false);
      setMarketingChecked(stored?.marketing ?? false);
      setMode("customize");
    };
    window.addEventListener("open-cookie-settings", handler);
    return () => window.removeEventListener("open-cookie-settings", handler);
  }, []);

  function handleAcceptAll() {
    acceptAllCookies();
    setMode("hidden");
  }

  function handleRejectOptional() {
    rejectOptionalCookies();
    setMode("hidden");
  }

  function handleOpenCustomize() {
    const stored = getStoredCookieConsent();
    setAnalyticsChecked(stored?.analytics ?? false);
    setMarketingChecked(stored?.marketing ?? false);
    setMode("customize");
  }

  function handleSaveChoices() {
    storeCookieConsent({ analytics: analyticsChecked, marketing: marketingChecked });
    setMode("hidden");
  }

  if (mode === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("legal.cookiePolicy")}
      className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6"
      data-testid="cookie-banner"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl backdrop-blur-md">
        {mode === "banner" ? (
          <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed text-slate-300">
              {t("legal.cookieBannerText")}{" "}
              <Link
                href="/cookie-policy"
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                {t("legal.cookiePolicy")}
              </Link>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAcceptAll}
                data-testid="cookie-accept-all"
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
              >
                {t("legal.acceptAll")}
              </button>
              <button
                type="button"
                onClick={handleRejectOptional}
                data-testid="cookie-reject-optional"
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {t("legal.rejectOptional")}
              </button>
              <button
                type="button"
                onClick={handleOpenCustomize}
                data-testid="cookie-customize"
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {t("legal.customize")}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <h2 className="text-base font-semibold text-slate-50">
              {t("legal.cookieSettings")}
            </h2>

            {/* Necessary — always active */}
            <div className="flex items-start gap-3 rounded-lg border border-slate-700/40 bg-slate-800/40 px-4 py-3">
              <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500 bg-emerald-900/40">
                <svg className="h-2.5 w-2.5 text-emerald-400" viewBox="0 0 10 8" fill="currentColor">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-100">
                  {t("legal.cookieCategoryNecessary")}
                  <span className="ml-2 text-xs text-emerald-400">{t("admin.configured")}</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{t("legal.cookieCategoryNecessaryHint")}</p>
              </div>
            </div>

            {/* Analytics */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700/40 bg-slate-800/20 px-4 py-3">
              <input
                type="checkbox"
                checked={analyticsChecked}
                onChange={(e) => setAnalyticsChecked(e.target.checked)}
                data-testid="cookie-analytics-toggle"
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
              />
              <div>
                <p className="text-sm font-medium text-slate-200">{t("legal.cookieCategoryAnalytics")}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t("legal.cookieCategoryAnalyticsHint")}</p>
              </div>
            </label>

            {/* Marketing */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700/40 bg-slate-800/20 px-4 py-3">
              <input
                type="checkbox"
                checked={marketingChecked}
                onChange={(e) => setMarketingChecked(e.target.checked)}
                data-testid="cookie-marketing-toggle"
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan-500"
              />
              <div>
                <p className="text-sm font-medium text-slate-200">{t("legal.cookieCategoryMarketing")}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t("legal.cookieCategoryMarketingHint")}</p>
              </div>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSaveChoices}
                data-testid="cookie-save-choices"
                className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
              >
                {t("legal.saveChoices")}
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {t("legal.acceptAll")}
              </button>
              <button
                type="button"
                onClick={handleRejectOptional}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {t("legal.rejectOptional")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Button that reopens cookie settings panel from footer/nav. */
export function CookieSettingsButton({ className }: { className?: string }) {
  const { t } = useI18n();

  function openSettings() {
    window.dispatchEvent(new Event("open-cookie-settings"));
  }

  return (
    <button
      type="button"
      onClick={openSettings}
      data-testid="cookie-settings-button"
      className={className ?? "text-xs text-slate-500 hover:text-slate-300 transition-colors"}
    >
      {t("legal.cookieSettings")}
    </button>
  );
}
