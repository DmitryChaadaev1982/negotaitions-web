"use client";

import {
  resolveConnectionStatus,
  type ParticipantConnectionStatus,
} from "@/lib/presence";
import { useI18n } from "@/lib/i18n/useI18n";

type ConnectionStatusBadgeProps = {
  lastSeenAt: string | null | undefined;
  showLastSeen?: boolean;
};

function statusColor(status: ParticipantConnectionStatus) {
  switch (status) {
    case "ONLINE":
      return "bg-emerald-500";
    case "RECENTLY_DISCONNECTED":
      return "bg-amber-500";
    default:
      return "bg-slate-600";
  }
}

function statusLabelKey(
  status: ParticipantConnectionStatus,
): "rejoin.online" | "rejoin.recentlyDisconnected" | "rejoin.offline" {
  switch (status) {
    case "ONLINE":
      return "rejoin.online";
    case "RECENTLY_DISCONNECTED":
      return "rejoin.recentlyDisconnected";
    default:
      return "rejoin.offline";
  }
}

export function ConnectionStatusBadge({
  lastSeenAt,
  showLastSeen = false,
}: ConnectionStatusBadgeProps) {
  const { t, locale } = useI18n();
  const parsedLastSeen = lastSeenAt ? new Date(lastSeenAt) : null;
  const status = resolveConnectionStatus(parsedLastSeen);

  const formattedLastSeen =
    parsedLastSeen && !Number.isNaN(parsedLastSeen.getTime())
      ? new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(parsedLastSeen)
      : null;

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-2 text-xs">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${statusColor(status)}`}
        />
        <span
          className={
            status === "ONLINE"
              ? "text-emerald-300"
              : status === "RECENTLY_DISCONNECTED"
                ? "text-amber-300"
                : "text-slate-400"
          }
        >
          {t(statusLabelKey(status))}
        </span>
      </span>
      {showLastSeen && formattedLastSeen ? (
        <span className="text-[10px] text-slate-500">
          {t("rejoin.lastSeen")}: {formattedLastSeen}
        </span>
      ) : null}
    </span>
  );
}
