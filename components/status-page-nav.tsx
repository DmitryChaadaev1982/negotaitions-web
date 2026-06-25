"use client";

import { LanguageSwitcher } from "@/components/language-switcher";
import { logoutUser } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/useI18n";

/**
 * Header nav for pending-approval, rejected, and blocked status pages.
 * Shows the user's email, a logout button, and the LanguageSwitcher.
 */
export function StatusPageNav({ email }: { email: string }) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-4 text-sm text-slate-400">
      <LanguageSwitcher />
      <span>{email}</span>
      <form action={logoutUser}>
        <button
          type="submit"
          className="text-slate-400 hover:text-slate-100 transition-colors"
        >
          {t("auth.logout")}
        </button>
      </form>
    </div>
  );
}
