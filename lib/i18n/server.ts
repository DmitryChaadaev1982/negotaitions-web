import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  isLocale,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./config";
import { getDictionary } from "./dictionaries";

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;

  if (cookieLocale && isLocale(cookieLocale)) {
    return cookieLocale;
  }

  const headerStore = await headers();
  const acceptLanguage = headerStore.get("accept-language");

  return detectBrowserLocale(acceptLanguage);
}

export async function getServerDictionary() {
  const locale = await getServerLocale();
  return { locale, dictionary: getDictionary(locale) };
}

export { DEFAULT_LOCALE, getDictionary };
export type { Locale };
