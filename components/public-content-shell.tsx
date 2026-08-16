import { cn } from "@/lib/cn";

type PublicContentShellProps = {
  testId: string;
  children: React.ReactNode;
  width?: "reading" | "wide";
};

export function PublicContentShell({
  testId,
  children,
  width = "reading",
}: PublicContentShellProps) {
  return (
    <main data-testid={testId} className="relative flex-1 app-gradient-bg">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="app-grid-pattern absolute inset-0 opacity-50" />
      </div>
      <div
        className={cn(
          "relative mx-auto px-4 py-12 sm:px-6 lg:py-16",
          width === "wide" ? "max-w-5xl" : "max-w-3xl",
        )}
      >
        {children}
      </div>
    </main>
  );
}
