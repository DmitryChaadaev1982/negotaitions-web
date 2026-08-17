"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  LEGAL_RETURN_QUERY,
  resolveLegalDocumentReturn,
  type LegalReturnContext,
} from "@/lib/legal/legal-document-return";

const RETURN_LABEL_KEYS = {
  "legal-update": "legal.returnLegalUpdate",
  register: "legal.returnRegister",
  app: "legal.returnApp",
  site: "legal.returnSite",
  home: "legal.returnHome",
} as const;

const RETURN_SHORT_LABEL_KEYS = {
  "legal-update": "legal.returnLegalUpdateShort",
  register: "legal.returnRegisterShort",
  app: "legal.returnAppShort",
  site: "legal.returnSiteShort",
  home: "legal.returnHomeShort",
} as const;

export function LegalDocumentHeaderFrame({
  href,
  context,
}: {
  href: string;
  context: LegalReturnContext;
}) {
  const { t } = useI18n();

  return (
    <header
      data-testid="legal-document-header"
      className="sticky top-0 z-[60] border-b border-slate-800/80 bg-[#020617]/95 pt-[max(0.25rem,env(safe-area-inset-top,0px))] backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-1 sm:px-6">
        <div className="hidden shrink-0 sm:block">
          <BrandLogo
            size="sm"
            variant="compact"
            href="/"
            className="h-8 max-w-[148px]"
          />
        </div>

        <Link
          href={href}
          data-testid="legal-document-return"
          data-return-context={context}
          className="inline-flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 sm:flex-none sm:max-w-[min(100%,22rem)]"
        >
          <span aria-hidden="true">←</span>
          <span className="truncate sm:hidden">{t(RETURN_SHORT_LABEL_KEYS[context])}</span>
          <span className="hidden truncate sm:inline">
            {t(RETURN_LABEL_KEYS[context])}
          </span>
        </Link>

        <div className="ml-auto shrink-0" data-testid="legal-document-locale">
          <LanguageSwitcher touchTarget />
        </div>
      </div>
    </header>
  );
}

function LegalDocumentHeaderFromSearch() {
  const searchParams = useSearchParams();
  const resolved = resolveLegalDocumentReturn({
    returnTo: searchParams.get(LEGAL_RETURN_QUERY.returnTo),
    returnContext: searchParams.get(LEGAL_RETURN_QUERY.returnContext),
  });

  return (
    <LegalDocumentHeaderFrame href={resolved.href} context={resolved.context} />
  );
}

export function LegalDocumentHeader() {
  return (
    <Suspense
      fallback={<LegalDocumentHeaderFrame href="/" context="home" />}
    >
      <LegalDocumentHeaderFromSearch />
    </Suspense>
  );
}
