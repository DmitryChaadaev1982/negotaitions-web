"use client";

import { useI18n, type Locale } from "@/lib/i18n/useI18n";
import { cn } from "@/lib/cn";
import { updateUserPreferredLocale } from "@/app/actions/auth";

type LanguageSwitcherProps = {
  className?: string;
  /**
   * When true (logged-in contexts), the switch also persists the locale to
   * User.preferredLocale via the server action. Defaults to false so public,
   * auth, and legal pages perform no server call for unauthenticated visitors.
   */
  persistToServer?: boolean;
};

export function LanguageSwitcher({
  className,
  persistToServer = false,
}: LanguageSwitcherProps) {
  const { locale, setLocale } = useI18n();

  const handleSelect = (option: Locale) => {
    // Client-side change is always immediate and authoritative for the UI.
    setLocale(option);

    if (!persistToServer) {
      return;
    }

    // Fire-and-forget: server persistence must never block or break the
    // client-side switch. A no-op for unauthenticated users; harmless for
    // non-active users. Surface failures only in development.
    void updateUserPreferredLocale(option).catch((error) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("Failed to persist preferred locale", error);
      }
    });
  };

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
          data-testid={`language-switch-${option}`}
          onClick={() => handleSelect(option)}
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
