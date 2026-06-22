import { cn } from "@/lib/cn";

type AppShellProps = {
  children: React.ReactNode;
  className?: string;
  narrow?: boolean;
};

export function AppShell({ children, className, narrow }: AppShellProps) {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] app-gradient-bg">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-blue-600/15 blur-[100px]" />
        <div className="absolute -right-40 top-1/4 h-96 w-96 rounded-full bg-violet-600/15 blur-[100px]" />
        <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-[80px]" />
        <div className="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/8 blur-[120px]" />
        <div className="app-grid-pattern absolute inset-0 opacity-60" />
      </div>
      <div
        className={cn(
          "relative mx-auto px-4 py-8 sm:px-6 lg:py-10",
          narrow ? "max-w-3xl" : "max-w-6xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
