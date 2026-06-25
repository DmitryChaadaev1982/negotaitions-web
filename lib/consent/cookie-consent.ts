/**
 * Cookie consent helper.
 *
 * Consent categories:
 *   - necessary  : always true; cannot be disabled
 *   - analytics  : disabled by default; no scripts currently use this
 *   - marketing  : disabled by default; no scripts currently use this
 *
 * Stored in localStorage under COOKIE_CONSENT_STORAGE_KEY.
 * The stored value intentionally does NOT contain auth tokens,
 * session cookies, joinToken, hostToken, participantToken,
 * passwordHash or sessionTokenHash.
 */

export const COOKIE_CONSENT_STORAGE_KEY = "negotaitions.cookieConsent.v1";

export const CONSENT_TYPES = {
  TERMS_PRIVACY_V1: "TERMS_PRIVACY_V1",
  MVP_DATA_LIMITATION_V1: "MVP_DATA_LIMITATION_V1",
  EXTERNAL_INFRASTRUCTURE_V1: "EXTERNAL_INFRASTRUCTURE_V1",
} as const;

export type ConsentType = (typeof CONSENT_TYPES)[keyof typeof CONSENT_TYPES];

export type CookieConsentCategory = "necessary" | "analytics" | "marketing";

export type CookieConsentPreferences = {
  version: 1;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
};

const defaultPreferences = (): CookieConsentPreferences => ({
  version: 1,
  necessary: true,
  analytics: false,
  marketing: false,
  updatedAt: new Date().toISOString(),
});

/**
 * Read stored cookie consent preferences from localStorage.
 * Returns null if not yet set (i.e. banner should be shown).
 */
export function getStoredCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentPreferences>;
    if (parsed.version !== 1) return null;
    return {
      version: 1,
      necessary: true,
      analytics: Boolean(parsed.analytics),
      marketing: Boolean(parsed.marketing),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Persist cookie consent preferences to localStorage.
 * Always sets necessary=true regardless of input.
 */
export function storeCookieConsent(
  prefs: Omit<CookieConsentPreferences, "version" | "necessary" | "updatedAt">,
): CookieConsentPreferences {
  const stored: CookieConsentPreferences = {
    version: 1,
    necessary: true,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(stored));
  }
  return stored;
}

/** Accept all categories (analytics + marketing). */
export function acceptAllCookies(): CookieConsentPreferences {
  return storeCookieConsent({ analytics: true, marketing: true });
}

/** Reject optional categories (analytics=false, marketing=false). */
export function rejectOptionalCookies(): CookieConsentPreferences {
  return storeCookieConsent({ analytics: false, marketing: false });
}

/**
 * Check whether a specific consent category is granted.
 * necessary is always true.
 * analytics/marketing require stored consent; default is false.
 */
export function hasCookieConsent(category: CookieConsentCategory): boolean {
  if (category === "necessary") return true;
  const prefs = getStoredCookieConsent();
  if (!prefs) return false;
  return Boolean(prefs[category]);
}

/**
 * Returns true if the user has not yet made a consent choice
 * (banner should be displayed).
 */
export function needsCookieConsentBanner(): boolean {
  return getStoredCookieConsent() === null;
}

export { defaultPreferences };
