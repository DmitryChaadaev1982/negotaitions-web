import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/cn";

export function DataTable({
  children,
  className,
  scrollAreaClassName,
}: {
  children: React.ReactNode;
  className?: string;
  scrollAreaClassName?: string;
}) {
  return (
    <GlassCard elevated className={cn("overflow-hidden", className)}>
      <div className={cn("overflow-x-auto", scrollAreaClassName)}>{children}</div>
    </GlassCard>
  );
}

export function DataTableElement({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <table className={cn("min-w-full divide-y divide-slate-700/40", className)}>
      {children}
    </table>
  );
}

export function DataTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-slate-900/80">
      <tr>{children}</tr>
    </thead>
  );
}

export function DataTableHeaderCell({
  children,
  align = "left",
  className,
  ...props
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
} & Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "className" | "children">) {
  return (
    <th
      {...props}
      className={cn(
        "px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-400",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-slate-700/30">{children}</tbody>;
}

export function DataTableRow({
  children,
  className,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLTableRowElement>, "className" | "children">) {
  return (
    <tr
      {...props}
      className={cn(
        "transition-colors hover:bg-slate-800/50",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function DataTableCell({
  children,
  align = "left",
  className,
  ...props
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
} & Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "className" | "children">) {
  return (
    <td
      {...props}
      className={cn(
        "px-6 py-4 text-sm text-slate-300",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
