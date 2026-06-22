"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

export function AppHeader() {
  const pathname = usePathname();
  const { t } = useI18n();

  const navItems = [
    { href: "/dashboard", label: t("nav.dashboard") },
    { href: "/cases", label: t("nav.cases") },
    { href: "/sessions", label: t("nav.sessions") },
  ];

  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-6 sm:gap-10">
          <BrandLogo size="md" />
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "nav-pill-active"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LanguageSwitcher />
          <div className="rounded-full border border-slate-600/30 bg-slate-900/70 px-3.5 py-1.5 text-sm text-slate-400 backdrop-blur-sm">
            {t("common.signedInAs")}{" "}
            <span className="font-semibold text-slate-200">
              {t("common.facilitator")}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
