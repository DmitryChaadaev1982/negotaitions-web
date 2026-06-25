"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { loginUser } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/useI18n";
import { LanguageSwitcher } from "@/components/language-switcher";

function LoginForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") ?? "";

  const [state, action, pending] = useActionState(loginUser, {});

  const formError = state.errors?.form?.[0];

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex justify-end">
        <LanguageSwitcher />
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-50 mb-1">
          {t("auth.loginTitle")}
        </h1>
        <p className="text-slate-400 text-sm">{t("auth.loginSubtitle")}</p>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="returnUrl" value={returnUrl} />

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-300 mb-1.5"
          >
            {t("auth.email")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-slate-50 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-300 mb-1.5"
          >
            {t("auth.password")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-slate-50 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm"
          />
        </div>

        {formError && (
          <p className="text-sm text-red-400 rounded-lg bg-red-950/40 border border-red-800/50 px-3 py-2">
            {t(formError as Parameters<typeof t>[0]) ?? formError}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
        >
          {pending ? t("auth.loggingIn") : t("auth.loginButton")}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        {t("auth.noAccount")}{" "}
        <Link
          href={returnUrl ? `/register?returnUrl=${encodeURIComponent(returnUrl)}` : "/register"}
          className="text-cyan-400 hover:text-cyan-300 font-medium"
        >
          {t("auth.register")}
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
