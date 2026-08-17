import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal-document-page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getServerLocale } from "@/lib/i18n/server";
import { getLocalizedLegalDocuments } from "@/lib/legal/documents";
import { publicIndexingMetadata } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    ...publicIndexingMetadata,
    title: getDictionary(locale).legal.cookiePolicy,
  };
}

export default function CookiePolicyPage() {
  return (
    <LegalDocumentPage
      documents={getLocalizedLegalDocuments("/cookie-policy")}
      showCookieSettings
    />
  );
}
