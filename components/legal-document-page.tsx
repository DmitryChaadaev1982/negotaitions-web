"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { CookieSettingsButton } from "@/components/cookie-banner";
import { LegalDocumentHeaderFrame } from "@/components/legal-document-header";
import type { Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  buildLegalDocumentHref,
  isLegalDocumentPath,
  legalReturnFromLocation,
  resolveLegalDocumentReturn,
  LEGAL_RETURN_QUERY,
  type LegalReturnContext,
} from "@/lib/legal/legal-document-return";
import {
  LEGAL_DOCUMENT_UPDATED_ON,
  LEGAL_DOCUMENT_VERSION,
  formatLegalUpdatedOn,
} from "@/lib/legal/meta";
import { parseLegalMarkup, type LegalDocument } from "@/lib/legal/types";

const CROSS_LINKS = [
  { href: "/privacy", key: "legal.privacyPolicy" },
  { href: "/terms", key: "legal.termsOfUse" },
  { href: "/cookie-policy", key: "legal.cookiePolicy" },
  { href: "/data-processing-consent", key: "legal.dataProcessingConsent" },
  { href: "/ai-processing-notice", key: "legal.aiProcessingNotice" },
] as const;

function renderMarkedText(
  text: string,
  currentReturn: { returnTo: string; returnContext: LegalReturnContext },
): ReactNode {
  return parseLegalMarkup(text).map((part, index) => {
    if (typeof part === "string") {
      return <span key={index}>{part}</span>;
    }
    const href = isLegalDocumentPath(part.href)
      ? buildLegalDocumentHref(part.href, currentReturn)
      : part.href;
    return (
      <Link
        key={index}
        href={href}
        className="text-cyan-400 hover:text-cyan-300"
      >
        {part.label}
      </Link>
    );
  });
}

function LegalDocumentScreen({
  documents,
  showCookieSettings = false,
}: {
  documents: Record<Locale, LegalDocument>;
  showCookieSettings?: boolean;
}) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const document = documents[locale];
  const search = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const currentReturn = legalReturnFromLocation(pathname, search);
  const headerReturn = resolveLegalDocumentReturn({
    returnTo: searchParams.get(LEGAL_RETURN_QUERY.returnTo),
    returnContext: searchParams.get(LEGAL_RETURN_QUERY.returnContext),
  });

  return (
    <>
      <LegalDocumentHeaderFrame
        href={headerReturn.href}
        context={headerReturn.context}
      />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="mb-2 text-3xl font-bold text-slate-50">{document.title}</h1>
        <p
          className="mb-10 text-sm text-slate-500"
          data-testid="legal-document-meta"
        >
          {t("legal.documentVersion")} {LEGAL_DOCUMENT_VERSION}. {t("legal.lastUpdated")}:{" "}
          <time dateTime={LEGAL_DOCUMENT_UPDATED_ON}>
            {formatLegalUpdatedOn(locale)}
          </time>
        </p>

        <article
          className="space-y-8 text-slate-300"
          data-testid="legal-document"
          data-legal-locale={locale}
        >
          {document.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="mb-3 text-xl font-semibold text-slate-100">
                {section.heading}
              </h2>
              <div className="space-y-3">
                {section.blocks.map((block, index) => {
                  if (block.type === "ul") {
                    return (
                      <ul key={index} className="list-disc space-y-1 pl-6 text-sm">
                        {block.items.map((item) => (
                          <li key={item}>{renderMarkedText(item, currentReturn)}</li>
                        ))}
                      </ul>
                    );
                  }
                  if (block.type === "note") {
                    return (
                      <p
                        key={index}
                        className="rounded border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-sm text-amber-200"
                      >
                        {renderMarkedText(block.text, currentReturn)}
                      </p>
                    );
                  }
                  return (
                    <p key={index}>{renderMarkedText(block.text, currentReturn)}</p>
                  );
                })}
              </div>
            </section>
          ))}
        </article>

        {showCookieSettings ? (
          <div className="mt-8">
            <CookieSettingsButton className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 transition-colors hover:bg-slate-800" />
          </div>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-4 border-t border-slate-800 pt-6 text-sm text-slate-500">
          {CROSS_LINKS.filter((link) => link.href !== document.route).map(
            (link) => (
              <Link
                key={link.href}
                href={buildLegalDocumentHref(link.href, currentReturn)}
                className="hover:text-slate-300"
              >
                {t(link.key)}
              </Link>
            ),
          )}
        </div>
      </div>
    </>
  );
}

export function LegalDocumentPage({
  documents,
  showCookieSettings = false,
}: {
  documents: Record<Locale, LegalDocument>;
  showCookieSettings?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#020617]">
      <Suspense
        fallback={<LegalDocumentHeaderFrame href="/" context="home" />}
      >
        <LegalDocumentScreen
          documents={documents}
          showCookieSettings={showCookieSettings}
        />
      </Suspense>
    </div>
  );
}
