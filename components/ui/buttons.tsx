import Link from "next/link";

import { cn } from "@/lib/cn";

const baseButton =
  "inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none";

type ButtonProps = {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
};

type LinkButtonProps = {
  children: React.ReactNode;
  className?: string;
  href: string;
};

export function GradientButton({
  children,
  className,
  disabled,
  type = "button",
  onClick,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(baseButton, "btn-gradient", className)}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  className,
  disabled,
  type = "button",
  onClick,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(baseButton, "btn-secondary", className)}
    >
      {children}
    </button>
  );
}

export function DangerButton({
  children,
  className,
  disabled,
  type = "button",
  onClick,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        baseButton,
        "border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:border-rose-400/50 hover:bg-rose-500/20 hover:text-rose-200",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GradientButtonLink({
  children,
  className,
  href,
}: LinkButtonProps) {
  return (
    <Link href={href} className={cn(baseButton, "btn-gradient", className)}>
      {children}
    </Link>
  );
}

export function SecondaryButtonLink({
  children,
  className,
  href,
}: LinkButtonProps) {
  return (
    <Link href={href} className={cn(baseButton, "btn-secondary", className)}>
      {children}
    </Link>
  );
}
