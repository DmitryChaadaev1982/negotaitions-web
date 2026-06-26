"use client";

import { useEffect, useState } from "react";

import { isLocalStorageAvailable, areCookiesAvailable } from "@/lib/consent/cookie-consent";
import { useI18n } from "@/lib/i18n/useI18n";

type WarningKind = "localStorage" | "cookies";

/**
 * Renders non-blocking warnings if localStorage or cookies are unavailable.
 *
 * - localStorage unavailable → non-blocking toast (settings may not persist)
 * - cookies unavailable → stronger warning banner (sign-in will not work)
 *
 * Does not crash if either check fails.
 * Auth/session logic is server-side and unaffected by this component.
 */
export function BrowserCapabilityWarning() {
  const { t } = useI18n();
  const [warnings, setWarnings] = useState<WarningKind[]>([]);
  const [dismissed, setDismissed] = useState<Set<WarningKind>>(new Set());

  useEffect(() => {
    const detected: WarningKind[] = [];
    try {
      if (!isLocalStorageAvailable()) detected.push("localStorage");
    } catch {
      // Capability check itself must not throw
    }
    try {
      if (!areCookiesAvailable()) detected.push("cookies");
    } catch {
      // Capability check itself must not throw
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWarnings(detected);
  }, []);

  const visible = warnings.filter((w) => !dismissed.has(w));
  if (visible.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 left-0 right-0 z-40 flex flex-col items-center gap-2 px-4 pointer-events-none"
      aria-live="polite"
      data-testid="browser-capability-warnings"
    >
      {visible.map((kind) => (
        <div
          key={kind}
          data-testid={`browser-warning-${kind}`}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-xl ${
            kind === "cookies"
              ? "border-rose-500/40 bg-rose-950/90 text-rose-200"
              : "border-amber-500/30 bg-amber-950/80 text-amber-200"
          }`}
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-base">
            {kind === "cookies" ? "🍪" : "⚠️"}
          </span>
          <p className="flex-1 text-xs leading-relaxed">
            {kind === "cookies"
              ? t("browser.cookiesUnavailable")
              : t("browser.localStorageUnavailable")}
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed((prev) => new Set([...prev, kind]))}
            className="ml-1 shrink-0 text-xs opacity-60 hover:opacity-100 transition-opacity"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
