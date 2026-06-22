import { cn } from "@/lib/cn";

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  glow?: boolean;
};

export function GlassCard({
  children,
  className,
  elevated = false,
  glow = false,
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl",
        elevated ? "glass-panel-elevated" : "glass-panel",
        glow && "ring-1 ring-cyan-500/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function GlassCardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-b border-slate-600/25 px-6 py-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function GlassCardContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
}
