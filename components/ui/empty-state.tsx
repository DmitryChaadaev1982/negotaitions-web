import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";

type EmptyStateProps = {
  message: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ message, action, className }: EmptyStateProps) {
  return (
    <GlassCard className={className}>
      <GlassCardContent className="py-12 text-center">
        <p className="text-sm text-slate-400">{message}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </GlassCardContent>
    </GlassCard>
  );
}
