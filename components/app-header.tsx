"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

export function AppHeader() {
  const pathname = usePathname();
  const { t } = useI18n();

  const navItems = [
    { href: "/dashboard", label: t("nav.dashboard"), testId: "dashboard-nav-link" },
    { href: "/cases", label: t("nav.cases"), testId: "cases-nav-link" },
    { href: "/events", label: t("nav.events"), testId: "events-nav-link" },
    { href: "/sessions", label: t("nav.sessions"), testId: "sessions-nav-link" },
    { href: "/admin", label: t("nav.admin"), testId: "admin-nav-link" },
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
                  data-testid={item.testId}
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
          <RejoinNavLink />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
