"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/ui/brand-logo";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/useI18n";

type PublicHeaderProps = {
  isAuthenticated: boolean;
  isActive: boolean;
};

const navLinkClass =
  "rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70";

export function PublicHeader({
  isAuthenticated,
  isActive,
}: PublicHeaderProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  const sectionLinks = (
    <>
      <Link
        href="/#capabilities"
        data-testid="public-nav-capabilities"
        className={navLinkClass}
        onClick={close}
      >
        {t("nav.capabilities")}
      </Link>
      <Link
        href="/#how-it-works"
        data-testid="public-nav-how"
        className={navLinkClass}
        onClick={close}
      >
        {t("nav.howItWorks")}
      </Link>
    </>
  );

  const actions = isAuthenticated ? (
    <>
      {isActive ? (
        <Link
          href="/dashboard"
          data-testid="public-cta-platform"
          className="rounded-lg bg-cyan-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={close}
        >
          {t("nav.goToPlatform")}
        </Link>
      ) : null}
    </>
  ) : (
    <>
      <Link
        href="/login"
        data-testid="public-cta-login"
        className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
        onClick={close}
      >
        {t("auth.login")}
      </Link>
      <Link
        href="/register"
        data-testid="public-cta-register"
        className="rounded-lg bg-cyan-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        onClick={close}
      >
        {t("auth.register")}
      </Link>
    </>
  );

  return (
    <header
      data-testid="public-header"
      className="glass-header sticky top-0 z-50"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="hidden min-w-0 sm:block">
          <BrandLogo
            size="md"
            variant="full"
            priority
            href="/"
            className="max-w-[280px]"
          />
        </div>
        <div className="min-w-0 sm:hidden">
          <BrandLogo
            size="md"
            variant="compact"
            priority
            href="/"
          />
        </div>

        <nav
          data-testid="public-nav-desktop"
          className="hidden items-center gap-1 lg:flex"
          aria-label={t("publicHome.productName")}
        >
          {sectionLinks}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher persistToServer={isAuthenticated} />
          <div className="hidden items-center gap-2 sm:flex">{actions}</div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-600/40 text-slate-200 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 lg:hidden"
            aria-expanded={open}
            aria-controls={menuId}
            data-testid="public-nav-mobile-toggle"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="sr-only">
              {open ? t("nav.closeMenu") : t("nav.openMenu")}
            </span>
            <span aria-hidden className="flex flex-col gap-1.5">
              <span
                className={cn(
                  "block h-0.5 w-5 bg-current transition",
                  open && "translate-y-2 rotate-45",
                )}
              />
              <span
                className={cn("block h-0.5 w-5 bg-current transition", open && "opacity-0")}
              />
              <span
                className={cn(
                  "block h-0.5 w-5 bg-current transition",
                  open && "-translate-y-2 -rotate-45",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id={menuId}
          data-testid="public-nav-mobile"
          className="border-t border-slate-800/80 px-4 py-3 lg:hidden"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-1">
            {sectionLinks}
            <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
              {actions}
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
