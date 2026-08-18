import type { Page } from "@playwright/test";

export const E2E_COOKIE_CONSENT_STORAGE_KEY = "negotaitions.cookieConsent.v2";
export const E2E_LEGACY_COOKIE_CONSENT_STORAGE_KEY =
  "negotaitions.cookieConsent.v1";

export function cookieConsentSeedJson(args?: {
  analytics?: boolean;
  marketing?: boolean;
}): string {
  return JSON.stringify({
    version: 2,
    necessary: true,
    analytics: args?.analytics ?? false,
    marketing: args?.marketing ?? false,
    updatedAt: new Date().toISOString(),
  });
}

export async function seedCookieConsent(
  page: Page,
  args?: { analytics?: boolean; marketing?: boolean },
): Promise<void> {
  const value = cookieConsentSeedJson(args);
  await page.addInitScript(
    ([key, stored]) => {
      window.localStorage.setItem(key, stored);
    },
    [E2E_COOKIE_CONSENT_STORAGE_KEY, value] as const,
  );
}
