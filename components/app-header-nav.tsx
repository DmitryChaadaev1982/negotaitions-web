"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

type AppHeaderNavProps = {
  isAdmin?: boolean;
};

export function AppHeaderNav({ isAdmin: adminFlag = false }: AppHeaderNavProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  const trainingsItems = [
    { href: "/cases", label: t("nav.cases"), testId: "nav-cases" },
    { href: "/events", label: t("nav.events"), testId: "nav-events" },
    { href: "/sessions", label: t("nav.sessions"), testId: "nav-sessions" },
  ];

  return (
    <div className="flex shrink-0 items-center gap-4 sm:gap-6">
      <BrandLogo
        size="md"
        variant="full"
        priority
        className="hidden max-w-[320px] sm:inline-flex"
      />
      <BrandLogo
        size="md"
        variant="compact"
        priority
        className="sm:hidden"
      />
      <Link
        href="/"
        data-testid="nav-public-site"
        className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-all duration-200 hover:bg-slate-800/60 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
      >
        {t("nav.publicSite")}
      </Link>
      <nav className="flex items-center gap-3">
        <Link
          href="/dashboard"
          data-testid="nav-dashboard"
          className={cn(
            "shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200",
            pathname === "/dashboard"
              ? "nav-pill-active"
              : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
          )}
        >
          {t("nav.dashboard")}
        </Link>

        <div className="shrink-0 rounded-xl border border-slate-700/50 bg-slate-900/40 px-2 py-1">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500">
            {t("nav.negotiationTrainings")}
          </p>
          <div className="flex items-center gap-1">
            {trainingsItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={item.testId}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "nav-pill-active"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {adminFlag ? (
          <Link
            href="/admin"
            data-testid="nav-admin"
            className={cn(
              "shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200",
              pathname === "/admin" || pathname.startsWith("/admin/")
                ? "nav-pill-active"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
            )}
          >
            {t("nav.administration")}
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
