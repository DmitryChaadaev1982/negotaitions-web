"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type VisibilityBadgeProps = {
  visibility: "PUBLIC" | "PRIVATE";
  className?: string;
  showLabel?: boolean;
};

export function VisibilityBadge({
  visibility,
  className = "",
  showLabel = true,
}: VisibilityBadgeProps) {
  const { t } = useI18n();

  const isPublic = visibility === "PUBLIC";

  const label = isPublic ? t("visibility.public") : t("visibility.private");
  const title = isPublic
    ? t("visibility.publicTitle")
    : t("visibility.privateTitle");

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none ${
        isPublic
          ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
          : "bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30"
      } ${className}`}
      title={title}
      aria-label={title}
    >
      {isPublic ? (
        <svg
          className="h-2.5 w-2.5 shrink-0"
          fill="currentColor"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
        </svg>
      ) : (
        <svg
          className="h-2.5 w-2.5 shrink-0"
          fill="currentColor"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="M11 6V5a3 3 0 0 0-6 0v1H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1zm-1 0H6V5a2 2 0 1 1 4 0v1z" />
        </svg>
      )}
      {showLabel && <span>{label}</span>}
    </span>
  );
}
