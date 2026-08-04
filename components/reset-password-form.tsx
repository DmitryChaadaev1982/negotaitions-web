"use client";

import Link from "next/link";
import { useActionState } from "react";

import { resetPassword } from "@/app/actions/password-reset";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/useI18n";

export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(resetPassword, {});

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-end">
        <LanguageSwitcher />
      </div>
      <div className="mb-8 text-center">
        <h1 className="mb-1 text-2xl font-bold text-slate-50">
          {t("auth.resetPasswordTitle")}
        </h1>
        <p className="text-sm text-slate-400">
          {t("auth.resetPasswordSubtitle")}
        </p>
      </div>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-slate-300"
          >
            {t("auth.newPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-sm text-slate-50 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-1.5 block text-sm font-medium text-slate-300"
          >
            {t("auth.confirmNewPassword")}
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-sm text-slate-50 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        {state.error && (
          <p
            role="alert"
            className="rounded-lg border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-400"
          >
            {t(state.error as Parameters<typeof t>[0])}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || !token}
          className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t("auth.resettingPassword") : t("auth.resetPasswordButton")}
        </button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link
          href="/login"
          className="font-medium text-cyan-400 hover:text-cyan-300"
        >
          {t("auth.backToLogin")}
        </Link>
      </p>
    </div>
  );
}
