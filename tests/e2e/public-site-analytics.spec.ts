import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  createUserSessionCookie,
} from "./helpers/db";
import {
  E2E_COOKIE_CONSENT_STORAGE_KEY,
  E2E_LEGACY_COOKIE_CONSENT_STORAGE_KEY,
  cookieConsentSeedJson,
} from "./helpers/cookie-consent";

function baseUrl() {
  return test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
}

async function blockRealMetrica(page: import("@playwright/test").Page) {
  await page.route("https://mc.yandex.ru/**", (route) => route.abort());
}

async function expectNoMetrica(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("yandex-metrica-active")).toHaveCount(0);
  const scripts = page.locator('script[src*="mc.yandex.ru"]');
  await expect(scripts).toHaveCount(0);
  await expect
    .poll(async () => page.evaluate(() => typeof (window as { ym?: unknown }).ym))
    .toBe("undefined");
}

test("Metrica does not load without a counter ID even after analytics consent @smoke", async ({
  page,
}) => {
  await blockRealMetrica(page);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [E2E_COOKIE_CONSENT_STORAGE_KEY, cookieConsentSeedJson({ analytics: true })],
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectNoMetrica(page);
});

test("Metrica does not load when analytics consent is absent or false @smoke", async ({
  page,
}) => {
  await blockRealMetrica(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expectNoMetrica(page);

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [
      E2E_COOKIE_CONSENT_STORAGE_KEY,
      cookieConsentSeedJson({ analytics: false }),
    ],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectNoMetrica(page);
});

test("historical v1 analytics=true does not count as Metrica consent @smoke", async ({
  page,
}) => {
  await blockRealMetrica(page);
  await page.addInitScript(
    ([legacyKey]) => {
      window.localStorage.setItem(
        legacyKey,
        JSON.stringify({
          version: 1,
          necessary: true,
          analytics: true,
          marketing: true,
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    [E2E_LEGACY_COOKIE_CONSENT_STORAGE_KEY],
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("cookie-banner")).toBeVisible();
  await expectNoMetrica(page);
});

test("client public navigation still does not load Metrica without a counter ID @smoke", async ({
  page,
}) => {
  await blockRealMetrica(page);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [E2E_COOKIE_CONSENT_STORAGE_KEY, cookieConsentSeedJson({ analytics: true })],
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  await expectNoMetrica(page);
});

test("authenticated app, login, and legal-update do not load Metrica @smoke", async ({
  page,
}) => {
  await blockRealMetrica(page);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [E2E_COOKIE_CONSENT_STORAGE_KEY, cookieConsentSeedJson({ analytics: true })],
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expectNoMetrica(page);

  await page.goto("/privacy", { waitUntil: "domcontentloaded" });
  await expectNoMetrica(page);

  const user = await createActiveUser({ preferredLocale: "en" });
  const cookieHeader = await createUserSessionCookie(user.id);
  try {
    await page.context().addCookies([
      {
        name: "auth_session",
        value: cookieHeader.slice("auth_session=".length),
        url: baseUrl(),
      },
    ]);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expectNoMetrica(page);
  } finally {
    await page.context().clearCookies();
  }
});
