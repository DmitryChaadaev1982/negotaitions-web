"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { logoutUser } from "@/app/actions/auth";
import { CookieSettingsButton } from "@/components/cookie-banner";
import { useI18n } from "@/lib/i18n/useI18n";

type AccountMenuProps = {
  displayName: string;
};

export function AccountMenu({ displayName }: AccountMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const initials = displayName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div className="relative" ref={ref} data-testid="account-menu">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="account-menu-trigger"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-slate-800/60"
      >
        {/* Avatar placeholder circle */}
        <span
          aria-hidden="true"
          data-testid="account-avatar"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-700/50 text-xs font-semibold text-cyan-200 ring-1 ring-cyan-600/40"
        >
          {initials}
        </span>
        <span className="hidden max-w-[140px] truncate text-slate-300 sm:block">
          {displayName}
        </span>
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-slate-500"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="account-menu-dropdown"
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-slate-700/60 bg-slate-900/95 py-1 shadow-2xl backdrop-blur-md"
        >
          <Link
            href="/account/settings"
            role="menuitem"
            data-testid="account-menu-settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 transition-colors"
          >
            <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            {t("auth.accountSettings")}
          </Link>

          <div role="separator" className="my-1 border-t border-slate-700/50" />

          <div
            role="menuitem"
            data-testid="account-menu-cookie-settings"
            className="px-4 py-2.5"
          >
            <CookieSettingsButton className="flex items-center gap-2.5 text-sm text-slate-300 hover:text-slate-100 transition-colors" />
          </div>

          <div role="separator" className="my-1 border-t border-slate-700/50" />

          <form action={logoutUser}>
            <button
              type="submit"
              role="menuitem"
              data-testid="account-menu-logout"
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-rose-300 transition-colors"
            >
              <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              {t("auth.logout")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
