"use client";

import { I18nProvider, type Locale } from "@/lib/i18n/useI18n";

type ClientI18nProviderProps = {
  children: React.ReactNode;
  initialLocale?: Locale;
};

export function ClientI18nProvider({
  children,
  initialLocale,
}: ClientI18nProviderProps) {
  return (
    <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
  );
}
