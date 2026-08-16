"use client";

import { PublicContentShell } from "@/components/public-content-shell";
import { TextWithSupportEmail } from "@/components/public-support-email";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  AUTHOR_PORTRAIT_AVAILABLE,
  AUTHOR_PORTRAIT_HEIGHT,
  AUTHOR_PORTRAIT_PUBLIC_PATH,
  AUTHOR_PORTRAIT_WIDTH,
} from "@/lib/public-site/author-portrait";

const aboutParagraphs = [
  "publicAbout.p1",
  "publicAbout.p2",
  "publicAbout.p3",
  "publicAbout.p4",
  "publicAbout.p5",
  "publicAbout.p6",
  "publicAbout.p7",
  "publicAbout.p8",
] as const;

export function PublicAboutPage() {
  const { t } = useI18n();

  return (
    <PublicContentShell testId="public-about" width="wide">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-14">
        <figure
          data-testid="about-author-photo-slot"
          className="mx-auto w-full max-w-xs lg:mx-0 lg:max-w-none"
        >
          <div className="glass-panel overflow-hidden rounded-2xl bg-slate-900">
            {AUTHOR_PORTRAIT_AVAILABLE ? (
              <img
                src={AUTHOR_PORTRAIT_PUBLIC_PATH}
                alt={t("publicAbout.photoAlt")}
                width={AUTHOR_PORTRAIT_WIDTH}
                height={AUTHOR_PORTRAIT_HEIGHT}
                data-testid="about-author-photo"
                className="mx-auto h-auto w-full max-h-[28rem] object-contain object-top sm:max-h-[32rem] lg:max-h-[36rem]"
                decoding="async"
              />
            ) : (
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(34,211,238,0.12),transparent_58%),linear-gradient(180deg,rgba(15,23,42,0.2),rgba(2,6,23,0.55))]"
                aria-hidden
              />
            )}
          </div>
          <figcaption className="sr-only">{t("publicAbout.photoAlt")}</figcaption>
        </figure>

        <div className="min-w-0 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
            {t("publicAbout.title")}
          </h1>
          <p
            data-testid="about-author-name"
            className="mt-3 text-lg font-medium text-cyan-200"
          >
            {t("publicAbout.authorName")}
          </p>
          <div className="mt-8 space-y-5 text-base leading-7 text-slate-300">
            {aboutParagraphs.map((key) => (
              <p key={key}>
                <TextWithSupportEmail text={t(key)} />
              </p>
            ))}
          </div>
        </div>
      </div>
    </PublicContentShell>
  );
}
