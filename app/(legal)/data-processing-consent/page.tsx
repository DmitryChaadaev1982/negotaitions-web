import type { Metadata } from "next";

import { LegalDocumentPage } from "@/components/legal-document-page";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getServerLocale } from "@/lib/i18n/server";
import { getLocalizedLegalDocuments } from "@/lib/legal/documents";
import { buildLegalDocumentMetadata } from "@/lib/seo/page-metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return buildLegalDocumentMetadata({
    pathname: "/data-processing-consent",
    title: getDictionary(locale).legal.dataProcessingConsent,
  });
}

export default function DataProcessingConsentPage() {
  return (
    <LegalDocumentPage
      documents={getLocalizedLegalDocuments("/data-processing-consent")}
    />
  );
}
