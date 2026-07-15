import Link from "next/link";

import { cn } from "@/lib/cn";

const actionButtonBaseClassName =
  "inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:cursor-not-allowed disabled:opacity-40";

const actionButtonVariantClassNames = {
  primary:
    "bg-cyan-500/15 text-cyan-300 ring-1 ring-inset ring-cyan-500/25 hover:bg-cyan-500/25 hover:text-cyan-200",
  secondary:
    "bg-slate-800/80 text-slate-300 ring-1 ring-inset ring-slate-600/30 hover:bg-slate-700/80 hover:text-slate-100",
  link: "bg-blue-500/12 text-blue-300 ring-1 ring-inset ring-blue-500/20 hover:bg-blue-500/20 hover:text-blue-200",
  dangerOutline:
    "bg-transparent text-rose-300 ring-1 ring-inset ring-rose-500/35 hover:bg-rose-500/10 hover:text-rose-200",
  danger:
    "bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/25 hover:bg-rose-500/20 hover:text-rose-200",
} as const;

type ActionButtonVariant = keyof typeof actionButtonVariantClassNames;

export function getListActionButtonClassName(
  variant: ActionButtonVariant = "secondary",
  className?: string,
) {
  return cn(
    actionButtonBaseClassName,
    actionButtonVariantClassNames[variant],
    className,
  );
}

export function ListActionGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-1.5", className)}>
      {children}
    </div>
  );
}

type ListActionLinkProps = Omit<React.ComponentProps<typeof Link>, "className"> & {
  variant?: ActionButtonVariant;
  className?: string;
};

export function ListActionLink({
  variant = "secondary",
  className,
  ...props
}: ListActionLinkProps) {
  return (
    <Link
      {...props}
      data-action-variant={variant}
      className={getListActionButtonClassName(variant, className)}
    />
  );
}

type ListActionButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ActionButtonVariant;
  className?: string;
};

export function ListActionButton({
  variant = "secondary",
  className,
  ...props
}: ListActionButtonProps) {
  return (
    <button
      {...props}
      data-action-variant={variant}
      className={getListActionButtonClassName(variant, className)}
    />
  );
}
