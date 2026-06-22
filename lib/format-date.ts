import type { Locale } from "@/lib/i18n/config";

export function formatDate(date: Date, locale: Locale = "en") {
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  return new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDateShort(date: Date, locale: Locale = "en") {
  const intlLocale = locale === "ru" ? "ru-RU" : "en-US";

  return new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatDateFromIso(
  iso: string | null,
  notYetLabel: string,
  locale: Locale = "en",
) {
  if (!iso) {
    return notYetLabel;
  }

  return formatDate(new Date(iso), locale);
}
