"use client";

import { useState, useTransition, useActionState } from "react";

import { updateDisplayName, updatePassword } from "@/app/actions/account";
import { updateUserPreferredLocale } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/useI18n";

type AccountSettingsViewProps = {
  currentName: string;
  currentLocale: string;
};

const emptyState = { success: false as boolean, error: undefined as string | undefined };

export function AccountSettingsView({
  currentName,
  currentLocale,
}: AccountSettingsViewProps) {
  const { t } = useI18n();

  const [nameState, nameAction, namePending] = useActionState(
    updateDisplayName,
    emptyState,
  );
  const [pwState, pwAction, pwPending] = useActionState(
    updatePassword,
    emptyState,
  );

  const [locale, setLocale] = useState(currentLocale);
  const [localeSaved, setLocaleSaved] = useState(false);
  const [localePending, startLocaleTransition] = useTransition();

  function handleLocaleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startLocaleTransition(async () => {
      await updateUserPreferredLocale(locale);
      setLocaleSaved(true);
    });
  }

  return (
    <div className="space-y-8">
      {/* Display name */}
      <section
        className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-6"
        data-testid="settings-display-name-section"
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-50">
          {t("common.displayName")}
        </h2>
        <form action={nameAction} className="space-y-4">
          <div>
            <label
              htmlFor="settings-name"
              className="block text-sm font-medium text-slate-300"
            >
              {t("common.displayName")}
            </label>
            <input
              id="settings-name"
              name="name"
              type="text"
              defaultValue={currentName}
              maxLength={100}
              required
              data-testid="settings-display-name-input"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/40 focus:outline-none"
            />
          </div>
          {nameState.success && (
            <p className="text-sm text-emerald-400" role="status" data-testid="settings-name-success">
              {t("auth.displayNameUpdated")}
            </p>
          )}
          {nameState.error && (
            <p className="text-sm text-rose-400" role="alert">
              {t(nameState.error as Parameters<typeof t>[0])}
            </p>
          )}
          <button
            type="submit"
            disabled={namePending}
            data-testid="settings-save-name-btn"
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60 transition-colors"
          >
            {namePending ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      {/* Language */}
      <section
        className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-6"
        data-testid="settings-language-section"
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-50">
          {t("auth.language")}
        </h2>
        <form onSubmit={handleLocaleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="settings-locale"
              className="block text-sm font-medium text-slate-300"
            >
              {t("auth.preferredLocale")}
            </label>
            <select
              id="settings-locale"
              value={locale}
              onChange={(e) => {
                setLocale(e.target.value);
                setLocaleSaved(false);
              }}
              data-testid="settings-locale-select"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500/40 focus:outline-none"
            >
              <option value="ru">{t("auth.preferredLocaleRu")}</option>
              <option value="en">{t("auth.preferredLocaleEn")}</option>
            </select>
          </div>
          {localeSaved && (
            <p className="text-sm text-emerald-400" role="status" data-testid="settings-locale-success">
              {t("auth.languageUpdated")}
            </p>
          )}
          <button
            type="submit"
            disabled={localePending}
            data-testid="settings-save-locale-btn"
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60 transition-colors"
          >
            {localePending ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      {/* Change password */}
      <section
        className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-6"
        data-testid="settings-password-section"
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-50">
          {t("auth.changePassword")}
        </h2>
        <form action={pwAction} className="space-y-4">
          <div>
            <label
              htmlFor="settings-current-password"
              className="block text-sm font-medium text-slate-300"
            >
              {t("auth.currentPassword")}
            </label>
            <input
              id="settings-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              data-testid="settings-current-password-input"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500/40 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="settings-new-password"
              className="block text-sm font-medium text-slate-300"
            >
              {t("auth.newPassword")}
            </label>
            <input
              id="settings-new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              data-testid="settings-new-password-input"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500/40 focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="settings-confirm-password"
              className="block text-sm font-medium text-slate-300"
            >
              {t("auth.confirmNewPassword")}
            </label>
            <input
              id="settings-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              data-testid="settings-confirm-password-input"
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500/40 focus:outline-none"
            />
          </div>
          {pwState.success && (
            <p className="text-sm text-emerald-400" role="status" data-testid="settings-password-success">
              {t("auth.passwordUpdated")}
            </p>
          )}
          {pwState.error && (
            <p className="text-sm text-rose-400" role="alert" data-testid="settings-password-error">
              {t(pwState.error as Parameters<typeof t>[0])}
            </p>
          )}
          <button
            type="submit"
            disabled={pwPending}
            data-testid="settings-save-password-btn"
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60 transition-colors"
          >
            {pwPending ? t("common.saving") : t("auth.changePassword")}
          </button>
        </form>
      </section>
    </div>
  );
}
