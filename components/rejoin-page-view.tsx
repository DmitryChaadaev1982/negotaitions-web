"use client";

import Link from "next/link";
import { useEffect } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  GradientButtonLink,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { clearRecoveryContext } from "@/lib/rejoin/recovery-storage";
import { useRecoveryAvailable } from "@/lib/rejoin/use-recovery-available";
import { useI18n } from "@/lib/i18n/useI18n";

/**
 * RejoinPageView is rendered ONLY for unauthenticated visitors (see
 * app/rejoin/page.tsx — logged-in users are routed server-side via
 * getAccountRejoinTargets and never reach this component).
 *
 * Phase 6.4.1 closed all guest runtime access and Phase 6.4.2 removed every
 * secret token from localStorage recovery, so there is nothing for a guest to
 * "rejoin": the only safe action is to suggest signing in / registering. Any
 * stale recovery hint is purged on mount.
 */
export function RejoinPageView() {
  const { t } = useI18n();

  useEffect(() => {
    clearRecoveryContext();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#020617] px-4 py-12" data-testid="rejoin-page">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <BrandLogo size="md" href={undefined} />
        <LanguageSwitcher />
      </div>

      <GlassCard elevated className="w-full max-w-md">
        <GlassCardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-2 text-center">
            <h1
              className="text-xl font-bold text-slate-50"
              data-testid="rejoin-signin-message"
            >
              {t("rejoin.signInToRejoinTitle")}
            </h1>
            <p className="text-sm text-slate-400">
              {t("dashboard.signInRecoverSessions")}
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <GradientButtonLink href="/login" className="w-full">
              {t("auth.login")}
            </GradientButtonLink>
            <SecondaryButtonLink href="/register">
              {t("auth.register")}
            </SecondaryButtonLink>
          </div>
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}

export function RejoinNavLink({ className }: { className?: string }) {
  const { t } = useI18n();
  const visible = useRecoveryAvailable();

  if (!visible) {
    return null;
  }

  return (
    <Link
      href="/rejoin"
      data-testid="rejoin-link"
      className={
        className ??
        "text-sm font-semibold text-cyan-400 transition hover:text-cyan-300"
      }
    >
      {t("rejoin.rejoin")}
    </Link>
  );
}

export function ContinueLastActivityCard() {
  const { t } = useI18n();
  const visible = useRecoveryAvailable();

  if (!visible) {
    return null;
  }

  return (
    <GlassCard elevated>
      <GlassCardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-50">
            {t("rejoin.continueLastActivity")}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{t("rejoin.openRejoinPage")}</p>
        </div>
        <GradientButtonLink href="/rejoin">{t("rejoin.rejoin")}</GradientButtonLink>
      </GlassCardContent>
    </GlassCard>
  );
}
