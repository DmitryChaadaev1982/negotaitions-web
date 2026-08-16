export const LOCALES = ["en", "ru"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";

export const LOCALE_COOKIE_NAME = "negotaitions_locale";
export const LOCALE_STORAGE_KEY = "negotaitions_locale";

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function detectBrowserLocale(
  acceptLanguage?: string | null,
): Locale {
  if (!acceptLanguage) {
    return DEFAULT_LOCALE;
  }

  for (const part of acceptLanguage.split(",")) {
    const tag = part.trim().split(";")[0]?.toLowerCase() ?? "";
    if (tag.startsWith("ru")) {
      return "ru";
    }
    if (tag.startsWith("en")) {
      return "en";
    }
  }

  return DEFAULT_LOCALE;
}

export function localeToCaseLanguage(locale: Locale): "RU" | "EN" {
  return locale === "ru" ? "RU" : "EN";
}
