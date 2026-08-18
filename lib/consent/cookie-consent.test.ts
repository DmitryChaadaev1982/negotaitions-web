import assert from "node:assert/strict";
import test from "node:test";

import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_VERSION,
  LEGACY_COOKIE_CONSENT_STORAGE_KEY,
  getStoredCookieConsent,
  hasCookieConsent,
  needsCookieConsentBanner,
  storeCookieConsent,
} from "@/lib/consent/cookie-consent";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const memoryStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
  (globalThis as { window?: unknown; localStorage?: unknown }).window = {
    localStorage: memoryStorage,
    dispatchEvent() {
      return true;
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = memoryStorage;
  return store;
}

test("v2 consent defaults analytics to false and ignores historical v1 analytics=true", () => {
  const store = installMemoryStorage();
  try {
    assert.equal(COOKIE_CONSENT_VERSION, 2);
    assert.equal(COOKIE_CONSENT_STORAGE_KEY, "negotaitions.cookieConsent.v2");
    assert.equal(needsCookieConsentBanner(), true);
    assert.equal(hasCookieConsent("analytics"), false);

    store.set(
      LEGACY_COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        necessary: true,
        analytics: true,
        marketing: true,
        updatedAt: new Date().toISOString(),
      }),
    );
    assert.equal(getStoredCookieConsent(), null);
    assert.equal(hasCookieConsent("analytics"), false);
    assert.equal(needsCookieConsentBanner(), true);

    const stored = storeCookieConsent({ analytics: false, marketing: false });
    assert.equal(stored.version, 2);
    assert.equal(stored.analytics, false);
    assert.equal(store.has(LEGACY_COOKIE_CONSENT_STORAGE_KEY), false);
    assert.equal(hasCookieConsent("analytics"), false);
    assert.equal(needsCookieConsentBanner(), false);
  } finally {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
