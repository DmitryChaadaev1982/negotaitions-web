import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { cn } from "@/lib/cn";

type FeatureCardProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
};

export function FeatureCard({
  title,
  description,
  icon,
  className,
}: FeatureCardProps) {
  return (
    <GlassCard
      elevated
      glow
      className={cn(
        "group transition-all duration-300 hover:border-cyan-500/25 hover:shadow-[0_0_30px_rgba(34,211,238,0.08)]",
        className,
      )}
    >
      <GlassCardContent className="py-5">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/20 to-violet-600/20 text-cyan-400 ring-1 ring-cyan-500/25 shadow-inner shadow-cyan-500/10">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-slate-50">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
      </GlassCardContent>
    </GlassCard>
  );
}
