"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n, type TranslationKey } from "@/lib/i18n/useI18n";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [messageKey, setMessageKey] = useState<TranslationKey | null>(null);
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessageKey(null);
    setIsError(false);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") ?? "") }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        messageKey?: TranslationKey;
      };
      setMessageKey(
        result.messageKey ?? "auth.passwordResetRequestAccepted",
      );
      setIsError(result.ok === false);
    } catch {
      setMessageKey("auth.passwordResetRequestAccepted");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-end">
        <LanguageSwitcher />
      </div>
      <div className="mb-8 text-center">
        <h1 className="mb-1 text-2xl font-bold text-slate-50">
          {t("auth.forgotPasswordTitle")}
        </h1>
        <p className="text-sm text-slate-400">
          {t("auth.forgotPasswordSubtitle")}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-slate-300"
          >
            {t("auth.email")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-sm text-slate-50 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        {messageKey && (
          <p
            role={isError ? "alert" : "status"}
            className={`rounded-lg border px-3 py-2 text-sm ${
              isError
                ? "border-red-800/50 bg-red-950/40 text-red-400"
                : "border-emerald-800/50 bg-emerald-950/40 text-emerald-300"
            }`}
          >
            {t(messageKey)}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending
            ? t("auth.passwordResetRequesting")
            : t("auth.passwordResetRequestButton")}
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
