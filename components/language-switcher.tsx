"use client";

import { useI18n, type Locale } from "@/lib/i18n/useI18n";
import { cn } from "@/lib/cn";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-slate-600/30 bg-slate-900/70 p-1 text-sm font-semibold backdrop-blur-sm",
        className,
      )}
      role="group"
      aria-label="Interface language"
    >
      {(["ru", "en"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          className={cn(
            "rounded-md px-3 py-1 uppercase transition-all duration-200",
            locale === option
              ? "bg-gradient-to-r from-blue-600/80 to-violet-600/80 text-white shadow-sm shadow-blue-500/20 ring-1 ring-cyan-400/30"
              : "text-slate-400 hover:text-slate-200",
          )}
          aria-pressed={locale === option}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function useCaseLanguageDefault(): "RU" | "EN" {
  const { locale } = useI18n();
  return locale === "ru" ? "RU" : "EN";
}

export type { Locale };
