"use client";

import Link from "next/link";

import { ObjectPictogram } from "@/components/object-pictogram";
import { PublicVisualFrame } from "@/components/public-visual-frame";
import { useI18n } from "@/lib/i18n/useI18n";
import type { ObjectPictogramType } from "@/lib/object-pictograms";

type PublicHomePageProps = {
  isAuthenticated: boolean;
  isActive: boolean;
};

const capabilities: Array<{
  titleKey:
    | "publicHome.cap1Title"
    | "publicHome.cap2Title"
    | "publicHome.cap3Title"
    | "publicHome.cap4Title";
  bodyKey:
    | "publicHome.cap1Body"
    | "publicHome.cap2Body"
    | "publicHome.cap3Body"
    | "publicHome.cap4Body";
  objectType: ObjectPictogramType;
}> = [
  {
    titleKey: "publicHome.cap1Title",
    bodyKey: "publicHome.cap1Body",
    objectType: "case",
  },
  {
    titleKey: "publicHome.cap2Title",
    bodyKey: "publicHome.cap2Body",
    objectType: "event",
  },
  {
    titleKey: "publicHome.cap3Title",
    bodyKey: "publicHome.cap3Body",
    objectType: "room",
  },
  {
    titleKey: "publicHome.cap4Title",
    bodyKey: "publicHome.cap4Body",
    objectType: "room",
  },
];

const flowSteps = [
  {
    titleKey: "publicHome.flow1Title",
    bodyKey: "publicHome.flow1Body",
  },
  {
    titleKey: "publicHome.flow2Title",
    bodyKey: "publicHome.flow2Body",
  },
  {
    titleKey: "publicHome.flow3Title",
    bodyKey: "publicHome.flow3Body",
  },
  {
    titleKey: "publicHome.flow4Title",
    bodyKey: "publicHome.flow4Body",
  },
] as const;

const audienceNeeds = [
  {
    titleKey: "publicHome.audience1Title",
    bodyKey: "publicHome.audience1Body",
  },
  {
    titleKey: "publicHome.audience2Title",
    bodyKey: "publicHome.audience2Body",
  },
  {
    titleKey: "publicHome.audience3Title",
    bodyKey: "publicHome.audience3Body",
  },
  {
    titleKey: "publicHome.audience4Title",
    bodyKey: "publicHome.audience4Body",
  },
] as const;

const primaryCtaClass =
  "inline-flex items-center justify-center rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
const secondaryCtaClass =
  "inline-flex items-center justify-center rounded-lg border border-slate-500/50 px-5 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70";

export function PublicHomePage({
  isAuthenticated,
  isActive,
}: PublicHomePageProps) {
  const { locale, t } = useI18n();

  return (
    <main className="relative flex-1 app-gradient-bg">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="app-grid-pattern absolute inset-0 opacity-50" />
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-20 px-4 py-12 sm:px-6 lg:py-16">
        <section
          id="hero"
          data-testid="public-hero"
          className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10"
          aria-labelledby="public-hero-heading"
        >
          <div className="space-y-6">
            <div
              data-testid="public-hero-brand"
              className="flex items-center gap-3 sm:gap-3.5"
            >
              <img
                src="/brand/negotaitions-icon.png"
                alt=""
                width={128}
                height={128}
                aria-hidden="true"
                className="h-12 w-12 shrink-0 object-contain sm:h-14 sm:w-14 lg:h-16 lg:w-16"
                loading="eager"
                decoding="async"
              />
              <p className="whitespace-nowrap text-[clamp(1.125rem,2.2vw+0.5rem,1.75rem)] font-semibold leading-none tracking-tight text-slate-50">
                {t("publicHome.productName")}
              </p>
            </div>
            <h1
              id="public-hero-heading"
              className="space-y-1 text-2xl font-semibold leading-snug tracking-tight text-slate-50 sm:text-3xl lg:text-4xl"
            >
              <span className="block">{t("publicHome.heroHeadline1")}</span>
              <span className="block">{t("publicHome.heroHeadline2")}</span>
            </h1>
            <div className="max-w-2xl space-y-3 text-base leading-7 text-slate-300 sm:text-lg">
              <p>{t("publicHome.heroBody1")}</p>
              <p>{t("publicHome.heroBody2")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {isAuthenticated && isActive ? (
                <Link
                  href="/dashboard"
                  data-testid="public-hero-primary"
                  className={primaryCtaClass}
                >
                  {t("publicHome.ctaGoToPlatform")}
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    data-testid="public-hero-primary"
                    className={primaryCtaClass}
                  >
                    {t("publicHome.ctaLogin")}
                  </Link>
                  <Link
                    href="/register"
                    data-testid="public-hero-secondary"
                    className={secondaryCtaClass}
                  >
                    {t("publicHome.ctaRegister")}
                  </Link>
                </>
              )}
              <a
                href="#how-it-works"
                data-testid="public-hero-how"
                className="text-sm font-medium text-cyan-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
              >
                {t("publicHome.ctaHowItWorks")}
              </a>
            </div>
          </div>
          <PublicVisualFrame
            slot="hero-product"
            locale={locale}
            alt={t("publicHome.heroVisualAlt")}
            priority
          />
        </section>

        <section id="capabilities" className="space-y-8" aria-labelledby="capabilities-heading">
          <h2 id="capabilities-heading" className="text-2xl font-semibold text-slate-50 sm:text-3xl">
            {t("publicHome.capabilitiesTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {capabilities.map((item) => (
              <article
                key={item.titleKey}
                className="glass-panel rounded-2xl p-5 sm:p-6"
              >
                <ObjectPictogram objectType={item.objectType} size={48} className="mb-4" />
                <h3 className="text-lg font-semibold text-slate-50">
                  {t(item.titleKey)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{t(item.bodyKey)}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="space-y-8" aria-labelledby="how-heading">
          <div className="max-w-3xl space-y-3">
            <h2 id="how-heading" className="text-2xl font-semibold text-slate-50 sm:text-3xl">
              {t("publicHome.flowTitle")}
            </h2>
            <p className="text-slate-300">{t("publicHome.flowIntro")}</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {flowSteps.map((step, index) => (
              <li key={step.titleKey} className="glass-panel rounded-2xl p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400/80">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-3 text-base font-semibold text-slate-50">
                  {t(step.titleKey)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{t(step.bodyKey)}</p>
              </li>
            ))}
          </ol>
          <PublicVisualFrame
            slot="training-flow"
            locale={locale}
            alt={t("publicHome.howItWorksVisualAlt")}
            className="mt-2"
          />
        </section>

        <section
          id="ai-positioning"
          className="glass-hero rounded-3xl px-6 py-10 sm:px-10 sm:py-12"
          aria-labelledby="ai-heading"
        >
          <h2
            id="ai-heading"
            className="max-w-3xl space-y-2 text-2xl font-semibold leading-snug text-slate-50 sm:text-3xl"
          >
            <span className="block">{t("publicHome.aiHeadline1")}</span>
            <span className="block text-cyan-200">{t("publicHome.aiHeadline2")}</span>
          </h2>
          <div className="mt-6 max-w-3xl space-y-4 text-base leading-7 text-slate-300">
            <p>{t("publicHome.aiBody1")}</p>
            <p>{t("publicHome.aiBody2")}</p>
          </div>
        </section>

        <section id="audience" className="space-y-6" aria-labelledby="audience-heading">
          <h2 id="audience-heading" className="max-w-3xl text-2xl font-semibold text-slate-50 sm:text-3xl">
            {t("publicHome.audienceTitle")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {audienceNeeds.map((item) => (
              <article key={item.titleKey} className="glass-panel rounded-2xl p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-slate-50">
                  {t(item.titleKey)}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{t(item.bodyKey)}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="platform-cta"
          className="glass-panel-elevated rounded-2xl px-6 py-8 sm:px-8"
          aria-labelledby="platform-cta-heading"
        >
          <h2 id="platform-cta-heading" className="text-2xl font-semibold text-slate-50">
            {t("publicHome.platformCtaTitle")}
          </h2>
          <p className="mt-3 max-w-2xl text-slate-300">{t("publicHome.platformCtaBody")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {isAuthenticated && isActive ? (
              <Link href="/dashboard" className={primaryCtaClass}>
                {t("publicHome.ctaGoToPlatform")}
              </Link>
            ) : (
              <>
                <Link href="/login" className={primaryCtaClass}>
                  {t("publicHome.ctaLogin")}
                </Link>
                <Link href="/register" className={secondaryCtaClass}>
                  {t("publicHome.ctaRegister")}
                </Link>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
