"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, startTransition } from "react";

import { resetPassword } from "@/app/actions/password-reset";
import { PasswordRequirements } from "@/components/password-requirements";
import { parseResetTokenFragment } from "@/lib/auth/reset-fragment";
import { useI18n } from "@/lib/i18n/useI18n";

function scrubFragmentFromAddressBar(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}`,
  );
}

export function ResetPasswordForm({
  rejectQueryToken = false,
}: {
  rejectQueryToken?: boolean;
}) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(resetPassword, {});
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submittedPassword, setSubmittedPassword] = useState<string | null>(null);
  // Query-token links are rejected without waiting for client bootstrap.
  const [bootstrapped, setBootstrapped] = useState(rejectQueryToken);

  useEffect(() => {
    function scrubAndParseFragment() {
      // Security order is deliberate: copy ephemerally, scrub the complete
      // live fragment, and only then parse the copy. This also covers
      // same-document hash changes after the component has mounted.
      const rawFragment = window.location.hash;
      scrubFragmentFromAddressBar();
      const fragmentToken = rejectQueryToken
        ? null
        : parseResetTokenFragment(rawFragment);

      // Defer React state updates out of the synchronous effect body.
      startTransition(() => {
        setToken(fragmentToken ?? "");
        setBootstrapped(true);
      });
    }

    scrubAndParseFragment();
    window.addEventListener("hashchange", scrubAndParseFragment);
    return () =>
      window.removeEventListener("hashchange", scrubAndParseFragment);
  }, [rejectQueryToken]);

  const invalid = rejectQueryToken || (bootstrapped && !token);

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="mb-1 text-2xl font-bold text-slate-50">
          {t("auth.resetPasswordTitle")}
        </h1>
        <p className="text-sm text-slate-400">
          {t("auth.resetPasswordSubtitle")}
        </p>
      </div>
      {invalid ? (
        <div
          role="alert"
          className="rounded-lg border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-400"
          data-testid="reset-password-invalid-link"
        >
          {t("auth.passwordResetInvalid")}
        </div>
      ) : (
        <form
          action={action}
          className="space-y-4"
          onSubmit={() => setSubmittedPassword(password)}
        >
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
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="reset-password-requirements"
              aria-invalid={state.error ? true : undefined}
              data-testid="reset-password-input"
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
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-describedby="reset-password-requirements"
              aria-invalid={state.error ? true : undefined}
              data-testid="reset-confirm-password-input"
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3.5 py-2.5 text-sm text-slate-50 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <PasswordRequirements
            id="reset-password-requirements"
            password={password}
            confirmation={confirmPassword}
            submittedPassword={submittedPassword}
            serverError={state.error}
          />
          {state.error && (
            <p
              id="reset-password-error"
              role="alert"
              data-testid="reset-password-error"
              className="rounded-lg border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-400"
            >
              {t(state.error as Parameters<typeof t>[0])}
            </p>
          )}
          <button
            type="submit"
            disabled={pending || !token || !bootstrapped}
            className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? t("auth.resettingPassword") : t("auth.resetPasswordButton")}
          </button>
        </form>
      )}
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
