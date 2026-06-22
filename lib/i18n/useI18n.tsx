"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  isLocale,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "./config";
import { getDictionary } from "./dictionaries";
import {
  translate,
  translateValidation,
  type TranslationKey,
} from "./translate";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  tv: (
    message: string,
    params?: Record<string, string | number>,
  ) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && isLocale(stored)) {
    return stored;
  }

  return detectBrowserLocale(window.navigator.language);
}

function persistLocale(locale: Locale) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale};path=/;max-age=31536000;samesite=lax`;
  document.documentElement.lang = locale;
  window.dispatchEvent(new Event("negotaitions-locale-change"));
}

function subscribeLocale(onStoreChange: () => void) {
  const handleLocaleChange = () => onStoreChange();
  window.addEventListener("negotaitions-locale-change", handleLocaleChange);
  window.addEventListener("storage", handleLocaleChange);

  return () => {
    window.removeEventListener("negotaitions-locale-change", handleLocaleChange);
    window.removeEventListener("storage", handleLocaleChange);
  };
}

type I18nProviderProps = {
  children: ReactNode;
  initialLocale?: Locale;
};

export function I18nProvider({
  children,
  initialLocale,
}: I18nProviderProps) {
  const locale = useSyncExternalStore(
    subscribeLocale,
    readStoredLocale,
    () => initialLocale ?? DEFAULT_LOCALE,
  );

  const setLocale = useCallback((nextLocale: Locale) => {
    persistLocale(nextLocale);
  }, []);

  const dictionary = useMemo(() => getDictionary(locale), [locale]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translate(dictionary, key, params),
    [dictionary],
  );

  const tv = useCallback(
    (message: string, params?: Record<string, string | number>) =>
      translateValidation(dictionary, message, params),
    [dictionary],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, tv }),
    [locale, setLocale, t, tv],
  );

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }

  return context;
}

export type { Locale, TranslationKey };
