import type { SessionStatus } from "@/app/generated/prisma/client";

const statusStyles: Record<SessionStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-500/10",
  READY: "bg-blue-50 text-blue-700 ring-blue-600/20",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-600/20",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  ANALYZED: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

type SessionStatusBadgeProps = {
  status: SessionStatus;
};

export function SessionStatusBadge({ status }: SessionStatusBadgeProps) {
  const label = status.replace("_", " ");

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyles[status]}`}
    >
      {label}
    </span>
  );
}
