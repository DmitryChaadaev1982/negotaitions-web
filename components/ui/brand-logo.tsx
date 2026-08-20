"use client";

import Link from "next/link";

import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

type BrandLogoProps = {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  href?: string;
  glow?: boolean;
  variant?: "full" | "compact" | "session" | "icon";
  priority?: boolean;
  /**
   * Intercepts the click and receives `href` instead of navigating. The Session
   * room uses it so the logo runs the explicit-leave sequence before leaving.
   */
  onNavigate?: ((destination: string) => void | Promise<void>) | null;
};

const logoSizeClasses = {
  full: {
    sm: "h-10 max-w-[240px]",
    md: "h-12 max-w-[340px]",
    lg: "h-14 max-w-[360px]",
    xl: "h-20 max-w-[560px]",
  },
  compact: {
    sm: "h-8 max-w-[180px]",
    md: "h-10 max-w-[220px]",
    lg: "h-12 max-w-[260px]",
    xl: "h-14 max-w-[360px]",
  },
  session: {
    sm: "h-12 max-w-[300px]",
    md: "h-14 max-w-[360px]",
    lg: "h-16 max-w-[380px]",
    xl: "h-20 max-w-[460px]",
  },
  icon: {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
    xl: "h-14 w-14",
  },
} as const;

const localizedLogoSources = {
  ru: {
    full: "/brand/negotaitions-logo-full-ru.png",
    compact: "/brand/negotaitions-logo-compact-ru.png",
    session: "/brand/negotaitions-logo-session-ru.png",
    icon: "/brand/negotaitions-icon.png",
  },
  en: {
    full: "/brand/negotaitions-logo-full-en.png",
    compact: "/brand/negotaitions-logo-compact-en.png",
    session: "/brand/negotaitions-logo-session-en.png",
    icon: "/brand/negotaitions-icon.png",
  },
} as const;

export function BrandLogo({
  className,
  size = "md",
  href = "/dashboard",
  glow = false,
  variant = "full",
  priority: _priority = false,
  onNavigate = null,
}: BrandLogoProps) {
  const { t, locale } = useI18n();
  const localeKey = locale === "ru" ? "ru" : "en";

  const frameClassName = cn(
    "inline-flex max-w-full shrink-0",
    logoSizeClasses[variant][size],
    glow && "drop-shadow-[0_0_20px_rgba(34,211,238,0.2)]",
    href ? undefined : className,
  );

  const content = (
    <span className={frameClassName}>
      <img
        src={localizedLogoSources[localeKey][variant]}
        alt={t("brand.alt")}
        className="block h-full w-auto max-w-full object-contain"
        loading={_priority ? "eager" : "lazy"}
        decoding="async"
      />
    </span>
  );

  const wrapperClassName = cn(
    "inline-flex max-w-full shrink-0 transition-opacity hover:opacity-90",
    className,
  );

  if (href && onNavigate) {
    return (
      <button
        type="button"
        className={wrapperClassName}
        aria-label={t("brand.alt")}
        onClick={() => void onNavigate(href)}
      >
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        className={wrapperClassName}
        aria-label={t("brand.alt")}
      >
        {content}
      </Link>
    );
  }

  return content;
}
