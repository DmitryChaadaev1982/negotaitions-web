import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { cn } from "@/lib/cn";

type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  className?: string;
  accent?: "blue" | "violet" | "cyan" | "default";
};

const accentClass = {
  blue: "metric-glow-blue",
  violet: "metric-glow-violet",
  cyan: "metric-glow-cyan",
  default: "",
};

export function MetricCard({
  label,
  value,
  className,
  accent = "default",
}: MetricCardProps) {
  return (
    <GlassCard
      elevated
      className={cn("relative overflow-hidden", accentClass[accent], className)}
    >
      <GlassCardContent className="relative py-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <div className="mt-2 text-3xl font-bold tracking-tight text-slate-50">
          {value}
        </div>
      </GlassCardContent>
    </GlassCard>
  );
}
