"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/ui/brand-logo";
import { GradientButton, GradientButtonLink, SecondaryButtonLink } from "@/components/ui/buttons";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import {
  clearRecoveryContext,
  getValidRecoveryContext,
  type RecoveryContext,
} from "@/lib/rejoin/recovery-storage";
import { useRecoveryAvailable } from "@/lib/rejoin/use-recovery-available";
import { useI18n } from "@/lib/i18n/useI18n";

type RejoinValidation = {
  valid: boolean;
  targetUrl?: string;
  title?: string;
  subtitle?: string;
  participantType?: string;
  displayName?: string;
  reason?: string;
};

function participantTypeLabel(
  type: string | undefined,
  t: (key: `participantType.${"PARTICIPANT" | "OBSERVER" | "FACILITATOR"}`) => string,
) {
  if (type === "PARTICIPANT" || type === "OBSERVER" || type === "FACILITATOR") {
    return t(`participantType.${type}`);
  }

  return null;
}

export function RejoinPageView() {
  const { t } = useI18n();
  const router = useRouter();
  const [context, setContext] = useState<RecoveryContext | null>(null);
  const [validation, setValidation] = useState<RejoinValidation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRejoining, setIsRejoining] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const recovery = getValidRecoveryContext();

      if (!recovery) {
        if (!cancelled) {
          setContext(null);
          setValidation(null);
          setIsLoading(false);
        }
        return;
      }

      setContext(recovery);

      try {
        const response = await fetch("/api/rejoin/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: recovery.type,
            eventId: recovery.eventId,
            sessionId: recovery.sessionId,
            hostToken: recovery.hostToken,
            participantToken: recovery.participantToken,
            joinToken: recovery.joinToken,
          }),
        });

        const payload = (await response.json()) as RejoinValidation;

        if (!cancelled) {
          if (!payload.valid) {
            clearRecoveryContext();
          }

          setValidation(payload);
        }
      } catch {
        if (!cancelled) {
          setValidation({ valid: false, reason: "networkError" });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRejoin = useCallback(() => {
    if (!validation?.valid || !validation.targetUrl) {
      return;
    }

    setIsRejoining(true);

    try {
      const url = new URL(validation.targetUrl);
      router.push(`${url.pathname}${url.search}`);
    } catch {
      router.push(validation.targetUrl);
    }
  }, [router, validation]);

  const typeLabel = participantTypeLabel(validation?.participantType, t);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#020617] px-4 py-12">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <BrandLogo size="md" href={undefined} />
        <LanguageSwitcher />
      </div>

      <GlassCard elevated className="w-full max-w-md">
        <GlassCardContent className="space-y-6 p-6 sm:p-8">
          {isLoading ? (
            <p className="text-center text-sm text-slate-400">{t("common.loading")}…</p>
          ) : !context || !validation?.valid ? (
            <div className="space-y-4 text-center">
              <h1 className="text-xl font-bold text-slate-50">
                {validation?.reason === "sessionDeleted" ||
                validation?.reason === "eventUnavailable"
                  ? t("rejoin.sessionNoLongerAvailable")
                  : context && validation?.reason
                    ? t("rejoin.recoveryLinkExpired")
                    : t("rejoin.noRecentSession")}
              </h1>
              <div className="flex flex-wrap justify-center gap-3">
                <SecondaryButtonLink href="/dashboard">
                  {t("nav.dashboard")}
                </SecondaryButtonLink>
                <SecondaryButtonLink href="/events">
                  {t("nav.events")}
                </SecondaryButtonLink>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1 text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-400/80">
                  {t("rejoin.rejoinLastActivity")}
                </p>
                <h1 className="text-xl font-bold text-slate-50">{validation.title}</h1>
                {validation.subtitle ? (
                  <p className="text-sm text-slate-400">
                    {validation.displayName ?? validation.subtitle}
                    {typeLabel ? ` · ${typeLabel}` : null}
                  </p>
                ) : null}
              </div>

              <p className="text-center text-sm text-slate-400">
                {t("rejoin.returnToSameRoom")}
              </p>

              <GradientButton
                type="button"
                className="w-full"
                disabled={isRejoining}
                onClick={handleRejoin}
              >
                {isRejoining ? t("common.loading") : t("rejoin.rejoin")}
              </GradientButton>
            </div>
          )}
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
