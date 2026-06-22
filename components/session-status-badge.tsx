"use client";

import type { SessionDisplayStatus } from "@/lib/session-display-status";
import { useI18n } from "@/lib/i18n/useI18n";
import { cn } from "@/lib/cn";

const statusStyles: Record<SessionDisplayStatus, string> = {
  DRAFT: "bg-slate-500/15 text-slate-300 ring-slate-500/25",
  READY: "bg-blue-500/15 text-blue-300 ring-blue-500/25",
  PREPARATION: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/25",
  PREPARATION_RUNNING: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/25",
  PREPARATION_PAUSED: "bg-orange-500/15 text-orange-300 ring-orange-500/25",
  READY_TO_START: "bg-violet-500/15 text-violet-300 ring-violet-500/25",
  RUNNING: "bg-amber-500/15 text-amber-300 ring-amber-500/25",
  PAUSED: "bg-orange-500/15 text-orange-300 ring-orange-500/25",
  FINISHED: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25",
};

type SessionStatusBadgeProps = {
  status: SessionDisplayStatus;
};

export function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const { t } = useI18n();
  const label = t(`status.${status}` as `status.${SessionDisplayStatus}`);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        statusStyles[status],
      )}
    >
      {label}
    </span>
  );
}
