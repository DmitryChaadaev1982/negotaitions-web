/**
 * Cookie consent helper.
 *
 * Consent categories:
 *   - necessary  : always true; cannot be disabled
 *   - analytics  : disabled by default; public-site Yandex Metrica only
 *                  after explicit analytics=true on the current version
 *   - marketing  : disabled by default; no scripts currently use this
 *
 * Stored in localStorage under COOKIE_CONSENT_STORAGE_KEY.
 * The stored value intentionally does NOT contain auth tokens,
 * session cookies, joinToken, hostToken, participantToken,
 * passwordHash or sessionTokenHash.
 *
 * Version 2 is a new preference key. Historical v1 choices are not
 * migrated because the v1 notice said analytics scripts were not used.
 */

export const COOKIE_CONSENT_VERSION = 2 as const;
export const COOKIE_CONSENT_STORAGE_KEY = "negotaitions.cookieConsent.v2";
export const LEGACY_COOKIE_CONSENT_STORAGE_KEY = "negotaitions.cookieConsent.v1";
export const COOKIE_CONSENT_CHANGED_EVENT = "negotaitions-cookie-consent-changed";

export {
  CONSENT_TYPES,
  CURRENT_CONSENT_TYPES,
  LEGACY_CONSENT_TYPES,
  LEGACY_CONSENT_VERSION,
} from "@/lib/consent/user-consent";
export type { ConsentType } from "@/lib/consent/user-consent";
export {
  CURRENT_CONSENT_VERSION,
  CURRENT_REGISTRATION_CONSENT_TYPES,
} from "@/lib/legal/release";

export type CookieConsentCategory = "necessary" | "analytics" | "marketing";

export type CookieConsentPreferences = {
  version: typeof COOKIE_CONSENT_VERSION;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  updatedAt: string;
};

const defaultPreferences = (): CookieConsentPreferences => ({
  version: COOKIE_CONSENT_VERSION,
  necessary: true,
  analytics: false,
  marketing: false,
  updatedAt: new Date().toISOString(),
});

function getBrowserWindow(): Window | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as { window?: Window }).window;
  return candidate ?? null;
}

/**
 * Safely test whether localStorage is writable in this browser context.
 * Returns false in incognito when storage quota is 0, or when blocked by policy.
 */
export function isLocalStorageAvailable(): boolean {
  const w = getBrowserWindow();
  if (!w) return false;
  try {
    const testKey = "__ls_test__";
    w.localStorage.setItem(testKey, "1");
    w.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely test whether cookies appear to be enabled.
 * Uses document.cookie write/read; does not persist.
 */
export function areCookiesAvailable(): boolean {
  const w = getBrowserWindow();
  if (!w) return false;
  try {
    if (!w.navigator.cookieEnabled) return false;
    const testKey = "__cookie_test__";
    w.document.cookie = `${testKey}=1; path=/; SameSite=Lax`;
    const available = w.document.cookie.includes(`${testKey}=`);
    w.document.cookie = `${testKey}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    return available;
  } catch {
    return false;
  }
}

function notifyCookieConsentChanged(prefs: CookieConsentPreferences): void {
  const w = getBrowserWindow();
  if (!w) return;
  try {
    w.dispatchEvent(
      new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: prefs }),
    );
  } catch {
    // Non-browser unit tests may lack CustomEvent.
  }
}

/**
 * Read stored cookie consent preferences from localStorage.
 * Returns null if not yet set (i.e. banner should be shown)
 * or if localStorage is unavailable.
 * Historical v1 records are ignored and are not treated as analytics consent.
 */
export function getStoredCookieConsent(): CookieConsentPreferences | null {
  const w = getBrowserWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentPreferences>;
    if (parsed.version !== COOKIE_CONSENT_VERSION) return null;
    return {
      version: COOKIE_CONSENT_VERSION,
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
 * Silently skips write if localStorage is unavailable.
 */
export function storeCookieConsent(
  prefs: Omit<CookieConsentPreferences, "version" | "necessary" | "updatedAt">,
): CookieConsentPreferences {
  const stored: CookieConsentPreferences = {
    version: COOKIE_CONSENT_VERSION,
    necessary: true,
    analytics: prefs.analytics,
    marketing: prefs.marketing,
    updatedAt: new Date().toISOString(),
  };
  const w = getBrowserWindow();
  if (w) {
    try {
      w.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(stored));
      w.localStorage.removeItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY);
    } catch {
      // localStorage unavailable (quota exceeded, private browsing policy, etc.) — ignore
    }
  }
  notifyCookieConsentChanged(stored);
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
