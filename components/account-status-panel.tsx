"use client";

import { logoutUser } from "@/app/actions/auth";
import { useI18n } from "@/lib/i18n/useI18n";

type AccountStatusVariant = "pending" | "rejected" | "blocked";

const COPY = {
  pending: {
    title: "auth.pendingTitle",
    message: "auth.pendingMessage",
  },
  rejected: {
    title: "auth.rejectedTitle",
    message: "auth.rejectedMessage",
  },
  blocked: {
    title: "auth.blockedTitle",
    message: "auth.blockedMessage",
  },
} as const;

export function AccountStatusPanel({
  variant,
  email,
  name,
}: {
  variant: AccountStatusVariant;
  email: string;
  name?: string | null;
}) {
  const { t } = useI18n();
  const copy = COPY[variant];
  const iconClass =
    variant === "pending" ? "text-amber-400" : "text-red-400";
  const iconWrapClass =
    variant === "pending"
      ? "bg-amber-500/10 border-amber-500/20"
      : "bg-red-500/10 border-red-500/20";

  return (
    <div
      className="w-full max-w-md text-center"
      data-testid="account-status-panel"
      data-variant={variant}
    >
      <div className="mb-6 flex items-center justify-end gap-4 text-sm text-slate-400">
        <span>{email}</span>
        <form action={logoutUser}>
          <button
            type="submit"
            className="text-slate-400 transition-colors hover:text-slate-100"
          >
            {t("auth.logout")}
          </button>
        </form>
      </div>

      <div
        className={`mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full border ${iconWrapClass}`}
      >
        {variant === "pending" ? (
          <svg
            className={`h-8 w-8 ${iconClass}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
        ) : variant === "rejected" ? (
          <svg
            className={`h-8 w-8 ${iconClass}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            className={`h-8 w-8 ${iconClass}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 115.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        )}
      </div>

      <h1
        className="mb-3 text-2xl font-bold text-slate-50"
        data-testid="account-status-title"
      >
        {t(copy.title)}
      </h1>
      <p className="mb-8 text-slate-400" data-testid="account-status-message">
        {t(copy.message)}
      </p>

      {variant === "pending" ? (
        <div className="mb-8 space-y-3 rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 text-left">
          {name ? (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{t("auth.pendingName")}</span>
              <span className="font-medium text-slate-200">{name}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{t("auth.pendingEmail")}</span>
            <span className="font-medium text-slate-200">{email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{t("auth.pendingStatus")}</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              {t("auth.pendingStatusLabel")}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
