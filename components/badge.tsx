import type { Difficulty } from "@/app/generated/prisma/client";

const difficultyStyles: Record<Difficulty, string> = {
  EASY: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  MEDIUM: "bg-amber-50 text-amber-700 ring-amber-600/20",
  HARD: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

type BadgeProps = {
  children: React.ReactNode;
  variant?: "default" | Difficulty;
};

export function Badge({ children, variant = "default" }: BadgeProps) {
  const className =
    variant === "default"
      ? "bg-slate-100 text-slate-700 ring-slate-500/10"
      : difficultyStyles[variant];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}
