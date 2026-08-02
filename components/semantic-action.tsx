import Link from "next/link";

import { cn } from "@/lib/cn";
import {
  getSemanticActionPresentation,
  type SemanticActionKind,
  type SemanticActionSize,
} from "@/lib/ui/semantic-action-model";

const baseClassName =
  "inline-flex min-h-9 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:cursor-not-allowed disabled:opacity-50";

const sizeClassNames: Record<SemanticActionSize, string> = {
  default: "px-4 py-2 text-sm",
  compact: "min-h-7 px-2 py-1 text-xs",
};

const variantClassNames = {
  primary: "btn-gradient",
  return:
    "border border-violet-500/35 bg-violet-500/12 text-violet-200 hover:border-violet-400/45 hover:bg-violet-500/20",
  review:
    "border border-slate-500/35 bg-slate-900/70 text-slate-200 hover:border-blue-400/35 hover:bg-blue-500/10 hover:text-blue-100",
  navigation: "btn-secondary",
  management:
    "border border-slate-500/35 bg-slate-800/80 text-slate-200 hover:border-slate-400/45 hover:bg-slate-700/80",
  warning:
    "border border-amber-500/35 bg-amber-500/10 text-amber-200 hover:border-amber-400/45 hover:bg-amber-500/20",
  destructive:
    "border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-rose-200",
  disabled:
    "border border-slate-600/30 bg-slate-900/40 text-slate-500",
} as const;

type SemanticActionLinkProps = Omit<React.ComponentProps<typeof Link>, "className"> & {
  actionKind: SemanticActionKind;
  actionTarget?: string;
  className?: string;
  size?: SemanticActionSize;
};

type SemanticActionButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  actionKind: SemanticActionKind;
  actionTarget?: string;
  className?: string;
  size?: SemanticActionSize;
};

export function getSemanticActionClassName(
  actionKind: SemanticActionKind,
  size: SemanticActionSize = "default",
  className?: string,
) {
  const presentation = getSemanticActionPresentation(actionKind, size);
  return cn(
    baseClassName,
    sizeClassNames[presentation.size],
    variantClassNames[presentation.visualVariant],
    className,
  );
}

export function SemanticActionLink({
  actionKind,
  actionTarget,
  className,
  href,
  size = "default",
  ...props
}: SemanticActionLinkProps) {
  const target = actionTarget ?? (typeof href === "string" ? href : undefined);

  return (
    <Link
      {...props}
      href={href}
      data-action-kind={actionKind}
      data-action-target={target}
      className={getSemanticActionClassName(actionKind, size, className)}
    />
  );
}

export function SemanticActionButton({
  actionKind,
  actionTarget,
  className,
  size = "default",
  ...props
}: SemanticActionButtonProps) {
  return (
    <button
      {...props}
      data-action-kind={actionKind}
      data-action-target={actionTarget}
      className={getSemanticActionClassName(actionKind, size, className)}
    />
  );
}
