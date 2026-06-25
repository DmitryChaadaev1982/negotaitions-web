"use client";

import { LanguageSwitcher } from "@/components/language-switcher";

/**
 * Language switcher for legal/public pages.
 * Client component — switching locale writes to localStorage + cookie.
 * The server-rendered legal page content requires a page reload to reflect
 * the new language. Users can navigate away and back to see the change.
 */
export function LegalPageLanguageSwitcher() {
  return (
    <div className="flex justify-end mb-6">
      <LanguageSwitcher />
    </div>
  );
}
