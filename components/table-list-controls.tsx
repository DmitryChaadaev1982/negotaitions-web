import { cn } from "@/lib/cn";

export function ListFilterBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-700/40 bg-slate-900/40 p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListFilterGroups({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-wrap items-start gap-3", className)}>{children}</div>;
}

export function ListFilterGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-[10rem] rounded-md border border-slate-700/35 bg-slate-950/40 p-2.5",
        className,
      )}
    >
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export function ListFilterInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(
        "h-8 w-full min-w-[12rem] rounded-md border border-slate-700/50 bg-slate-950/70 px-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
        className,
      )}
    />
  );
}

export function ListFilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]",
        active
          ? "bg-cyan-500/15 text-cyan-200 ring-1 ring-inset ring-cyan-500/30"
          : "bg-slate-800/80 text-slate-300 ring-1 ring-inset ring-slate-600/30 hover:bg-slate-700/80 hover:text-slate-100",
      )}
    >
      {children}
    </button>
  );
}

export function ListFilterResetButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center whitespace-nowrap rounded-md border border-slate-600/45 bg-slate-800/70 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700/80 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]"
    >
      {children}
    </button>
  );
}

export function SortHeaderButton({
  active,
  direction,
  onClick,
  children,
}: {
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 whitespace-nowrap text-left text-xs font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-200"
    >
      <span>{children}</span>
      {active ? (
        <span aria-hidden className="text-cyan-300">
          {direction === "asc" ? "↑" : "↓"}
        </span>
      ) : null}
    </button>
  );
}
