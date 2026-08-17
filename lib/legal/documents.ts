import type { Locale } from "@/lib/i18n/config";
import { getAiNoticeDocument } from "@/lib/legal/ai-notice";
import { getConsentDocument } from "@/lib/legal/consent";
import { getCookieDocument } from "@/lib/legal/cookies";
import { getPrivacyDocument } from "@/lib/legal/privacy";
import { getTermsDocument } from "@/lib/legal/terms";
import { flattenLegalText, type LegalDocument } from "@/lib/legal/types";

export const LEGAL_DOCUMENT_ROUTES = [
  "/privacy",
  "/terms",
  "/cookie-policy",
  "/data-processing-consent",
  "/ai-processing-notice",
] as const;

export type LegalDocumentRoute = (typeof LEGAL_DOCUMENT_ROUTES)[number];

export function getLegalDocument(
  route: LegalDocumentRoute,
  locale: Locale,
): LegalDocument {
  switch (route) {
    case "/privacy":
      return getPrivacyDocument(locale);
    case "/terms":
      return getTermsDocument(locale);
    case "/cookie-policy":
      return getCookieDocument(locale);
    case "/data-processing-consent":
      return getConsentDocument(locale);
    case "/ai-processing-notice":
      return getAiNoticeDocument(locale);
  }
}

export function getLocalizedLegalDocuments(
  route: LegalDocumentRoute,
): Record<Locale, LegalDocument> {
  return {
    ru: getLegalDocument(route, "ru"),
    en: getLegalDocument(route, "en"),
  };
}

export function getAllLegalDocuments(locale: Locale): LegalDocument[] {
  return LEGAL_DOCUMENT_ROUTES.map((route) => getLegalDocument(route, locale));
}

export function flattenAllLegalText(locale: Locale): string {
  return getAllLegalDocuments(locale)
    .map((document) => flattenLegalText(document))
    .join("\n");
}
