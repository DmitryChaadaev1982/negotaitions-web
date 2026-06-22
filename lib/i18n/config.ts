export const LOCALES = ["en", "ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE_NAME = "negotaitions_locale";
export const LOCALE_STORAGE_KEY = "negotaitions_locale";

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function detectBrowserLocale(
  acceptLanguage?: string | null,
): Locale {
  if (acceptLanguage) {
    const primary = acceptLanguage.split(",")[0]?.trim().toLowerCase() ?? "";
    if (primary.startsWith("ru")) {
      return "ru";
    }
  }

  return "en";
}

export function localeToCaseLanguage(locale: Locale): "RU" | "EN" {
  return locale === "ru" ? "RU" : "EN";
}
