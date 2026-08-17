import { PUBLIC_CONTACT_EMAIL } from "@/lib/seo/indexing";

export const LEGAL_DOCUMENT_VERSION = "2";
export const LEGAL_DOCUMENT_UPDATED_ON = "2026-08-17";

export const LEGAL_OPERATOR_RU = "Чаадаев Дмитрий Владимирович";
export const LEGAL_OPERATOR_EN = "Dmitry Chaadaev";
export const LEGAL_OPERATOR_EN_LEGAL =
  "Dmitry Chaadaev (Чаадаев Дмитрий Владимирович)";
export const LEGAL_PRODUCT_RU = "ПереговорИИ (NegotAItions)";
export const LEGAL_PRODUCT_EN = "NegotAItions";
export const LEGAL_CONTACT_EMAIL = PUBLIC_CONTACT_EMAIL;

export function formatLegalUpdatedOn(locale: "ru" | "en"): string {
  if (locale === "ru") {
    return "17 августа 2026 г.";
  }
  return "17 August 2026";
}
