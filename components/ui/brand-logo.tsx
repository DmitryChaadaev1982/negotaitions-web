import Link from "next/link";

import { cn } from "@/lib/cn";

type BrandLogoProps = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  href?: string;
  glow?: boolean;
};

const sizeClasses = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-3xl",
  xl: "text-4xl sm:text-5xl lg:text-6xl",
};

export function BrandLogo({
  className,
  size = "md",
  href = "/dashboard",
  glow = false,
}: BrandLogoProps) {
  const content = (
    <span
      className={cn(
        "font-bold tracking-tight text-slate-50",
        sizeClasses[size],
        glow && "drop-shadow-[0_0_20px_rgba(34,211,238,0.2)]",
        className,
      )}
    >
      Negot<span className="brand-ai-gradient">AI</span>tions
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-block transition-opacity hover:opacity-90"
      >
        {content}
      </Link>
    );
  }

  return content;
}
