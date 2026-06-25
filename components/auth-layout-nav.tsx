"use client";

import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/useI18n";

/**
 * Auth layout navigation — shown on /login, /register, /pending-approval, etc.
 * Includes LanguageSwitcher so users can choose language before they log in.
 */
export function AuthLayoutNav() {
  const { t } = useI18n();

  return (
    <nav className="flex items-center gap-3 text-sm">
      <LanguageSwitcher className="mr-1" />
      <Link
        href="/login"
        className="text-slate-400 hover:text-slate-100 transition-colors"
      >
        {t("auth.login")}
      </Link>
      <Link
        href="/register"
        className="rounded-lg bg-cyan-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
      >
        {t("auth.register")}
      </Link>
    </nav>
  );
}
