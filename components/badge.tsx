"use client";

import type { Difficulty } from "@/app/generated/prisma/client";
import { useI18n } from "@/lib/i18n/useI18n";
import { cn } from "@/lib/cn";

const variantStyles: Record<Difficulty | "default" | "info" | "success" | "warning" | "danger", string> = {
  EASY: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25",
  MEDIUM: "bg-amber-500/15 text-amber-300 ring-amber-500/25",
  HARD: "bg-rose-500/15 text-rose-300 ring-rose-500/25",
  default: "bg-slate-800/80 text-slate-300 ring-slate-600/30",
  info: "bg-blue-500/15 text-blue-300 ring-blue-500/25",
  success: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/25",
  warning: "bg-amber-500/15 text-amber-300 ring-amber-500/25",
  danger: "bg-rose-500/15 text-rose-300 ring-rose-500/25",
};

type BadgeProps = {
  children: React.ReactNode;
  variant?: Difficulty | "default" | "info" | "success" | "warning" | "danger";
  className?: string;
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

type DifficultyBadgeProps = {
  difficulty: Difficulty;
};

export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const { t } = useI18n();

  return (
    <Badge variant={difficulty}>
      {t(`difficulty.${difficulty}` as `difficulty.${Difficulty}`)}
    </Badge>
  );
}

export function StatusBadge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "info" | "success" | "warning" | "danger";
}) {
  return <Badge variant={variant}>{children}</Badge>;
}
