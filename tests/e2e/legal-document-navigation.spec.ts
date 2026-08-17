import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  createUserSessionCookie,
  query,
} from "./helpers/db";
import { legalUpdateDraftStorageKey } from "../../lib/legal/legal-update-draft";

function baseUrl() {
  return test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
}

async function addAuthCookie(
  page: import("@playwright/test").Page,
  cookieHeader: string,
) {
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookieHeader.slice("auth_session=".length),
      url: baseUrl(),
    },
  ]);
}

async function setLocale(
  page: import("@playwright/test").Page,
  locale: "ru" | "en",
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("negotaitions_locale", value);
    document.cookie = `negotaitions_locale=${value};path=/;max-age=31536000;samesite=lax`;
  }, locale);
  await page.context().addCookies([
    {
      name: "negotaitions_locale",
      value: locale,
      url: baseUrl(),
    },
  ]);
}

test.describe("Legal document compact header and return context", () => {
  test("direct /privacy uses home fallback and has no public nav", async ({
    page,
  }) => {
    await setLocale(page, "ru");
    await page.goto("/privacy");
    await expect(page.getByTestId("legal-document-header")).toBeVisible();
    await expect(page.getByTestId("public-header")).toHaveCount(0);
    await expect(page.getByTestId("legal-document-locale")).toBeVisible();
    await expect(page.getByTestId("language-switch-ru")).toHaveCount(1);
    await expect(page.getByTestId("legal-document-return")).toContainText(
      "На главную",
    );
    await page.getByTestId("legal-document-return").click();
    await expect(page).toHaveURL(/\/(?:\?.*)?$/);
    await expect(page.getByTestId("public-header")).toBeVisible();
  });

  test("legal-update Privacy and Consent return to confirmation with draft preserved", async ({
    page,
  }) => {
    const user = await createActiveUser({
      preferredLocale: "ru",
      legalRelease: "v1",
    });
    const cookieHeader = await createUserSessionCookie(user.id, {
      grantCurrentLegalRelease: false,
    });

    try {
      await addAuthCookie(page, cookieHeader);
      await setLocale(page, "ru");
      await page.goto("/legal-update");
      await page.getByTestId("consent-terms-privacy").check();
      await page.getByTestId("consent-personal-data-processing").check();

      await page.getByRole("link", { name: "Политика обработки персональных данных" }).first().click();
      await expect(page).toHaveURL(/\/privacy/);
      await expect(page.getByTestId("legal-document-return")).toContainText(
        "Вернуться к подтверждению",
      );
      await expect(page.url()).not.toContain("joinToken");
      await page.getByTestId("legal-document-return").click();
      await expect(page).toHaveURL(/\/legal-update/);
      await expect(page.getByTestId("consent-terms-privacy")).toBeChecked();
      await expect(page.getByTestId("consent-personal-data-processing")).toBeChecked();
      await expect(page.getByTestId("consent-training-session-notice")).not.toBeChecked();

      await page
        .getByRole("link", { name: "Согласие на обработку персональных данных" })
        .first()
        .click();
      await expect(page).toHaveURL(/\/data-processing-consent/);
      await expect(page.getByTestId("legal-document-return")).toContainText(
        "Вернуться к подтверждению",
      );
      await page.getByTestId("legal-document-return").click();
      await expect(page).toHaveURL(/\/legal-update/);
      await expect(page.getByTestId("consent-terms-privacy")).toBeChecked();
    } finally {
      await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
    }
  });

  test("successful legal-update acceptance clears the checkbox draft", async ({
    page,
  }) => {
    const user = await createActiveUser({
      preferredLocale: "ru",
      legalRelease: "none",
    });
    const cookieHeader = await createUserSessionCookie(user.id, {
      grantCurrentLegalRelease: false,
    });
    const draftKey = legalUpdateDraftStorageKey();

    try {
      await addAuthCookie(page, cookieHeader);
      await setLocale(page, "ru");
      await page.goto("/legal-update");
      await page.getByTestId("consent-terms-privacy").check();
      await page.getByTestId("consent-personal-data-processing").check();
      await page.getByTestId("consent-training-session-notice").check();
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      ).not.toBeNull();
      await page.getByTestId("legal-update-confirm").click();
      await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      ).toBeNull();
    } finally {
      await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
    }
  });

  test("logout from legal-update clears the checkbox draft", async ({ page }) => {
    const user = await createActiveUser({
      preferredLocale: "ru",
      legalRelease: "v1",
    });
    const cookieHeader = await createUserSessionCookie(user.id, {
      grantCurrentLegalRelease: false,
    });
    const draftKey = legalUpdateDraftStorageKey();

    try {
      await addAuthCookie(page, cookieHeader);
      await setLocale(page, "ru");
      await page.goto("/legal-update");
      await page.getByTestId("consent-terms-privacy").check();
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      ).not.toBeNull();
      await page.getByTestId("legal-update-logout").click();
      await expect(page).toHaveURL(/\/login/);
      expect(
        await page.evaluate((key) => sessionStorage.getItem(key), draftKey),
      ).toBeNull();
    } finally {
      await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
    }
  });

  test("registration legal links carry register return context", async ({
    page,
  }) => {
    await setLocale(page, "ru");
    await page.goto("/register");
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Пользовательское соглашение" }).first().click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/terms/);
    expect(popup.url()).toContain("returnContext=register");
    expect(popup.url()).toContain("returnTo=%2Fregister");
    await expect(popup.getByTestId("legal-document-return")).toContainText(
      "Вернуться к регистрации",
    );
    await popup.close();
  });

  test("public site footer returns to the originating public page", async ({
    page,
  }) => {
    await setLocale(page, "ru");
    await page.goto("/about");
    await expect(page.getByTestId("footer-privacy")).toHaveAttribute(
      "href",
      /returnContext=site/,
    );
    await page.getByTestId("footer-privacy").click();
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByTestId("legal-document-return")).toContainText(
      "Вернуться на сайт",
    );
    await page.getByTestId("legal-document-return").click();
    await expect(page).toHaveURL(/\/about(?:\?.*)?$/);
  });

  test("authenticated app footer returns to the platform", async ({ page }) => {
    const user = await createActiveUser({ preferredLocale: "ru" });
    const cookieHeader = await createUserSessionCookie(user.id);

    try {
      await addAuthCookie(page, cookieHeader);
      await setLocale(page, "ru");
      await page.goto("/dashboard");
      await expect(page.getByTestId("footer-privacy")).toHaveAttribute(
        "href",
        /returnContext=app/,
      );
      await page.getByTestId("footer-privacy").click();
      await expect(page).toHaveURL(/\/privacy/);
      await expect(page.getByTestId("legal-document-return")).toContainText(
        "Вернуться в платформу",
      );
      await page.getByTestId("legal-document-return").click();
      await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    } finally {
      await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
    }
  });

  test("token-bearing source path does not appear in the legal document URL", async ({
    page,
  }) => {
    const joinToken = "RAW_JOIN_TOKEN_SECRET";
    await setLocale(page, "ru");
    await page.goto(`/login?returnUrl=${encodeURIComponent(`/join/${joinToken}`)}`);
    await page.getByTestId("footer-privacy").click();
    await expect(page).toHaveURL(/\/privacy/);
    expect(page.url()).not.toContain(joinToken);
    expect(page.url()).not.toContain("joinToken");
    expect(page.url()).not.toContain("/join/");
  });

  test("RU to EN and EN to RU keep the legal document and return context", async ({
    page,
  }) => {
    await setLocale(page, "ru");
    await page.goto(
      "/privacy?returnTo=%2Flegal-update&returnContext=legal-update",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Политика обработки персональных данных",
    );
    const cookieBanner = page.getByTestId("cookie-banner");
    if (await cookieBanner.isVisible()) {
      await cookieBanner.getByRole("button", { name: "Принять все" }).click();
    }
    await page
      .getByTestId("legal-document-locale")
      .getByTestId("language-switch-en")
      .click();
    await expect(page).toHaveURL(/\/privacy\?.*returnContext=legal-update/);
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-legal-locale",
      "en",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Privacy Policy",
    );
    await expect(page.getByTestId("legal-document-return")).toContainText(
      "Back to confirmation",
    );
    await page.getByTestId("language-switch-ru").click();
    await expect(page).toHaveURL(/\/privacy\?.*returnContext=legal-update/);
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-legal-locale",
      "ru",
    );
    await expect(page.getByTestId("legal-document-return")).toContainText(
      "Вернуться к подтверждению",
    );
  });
});

test.describe("Legal document header on a mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("compact sticky header keeps return and locale usable", async ({
    page,
  }) => {
    await setLocale(page, "ru");
    await page.goto(
      "/privacy?returnTo=%2Flegal-update&returnContext=legal-update",
    );

    const header = page.getByTestId("legal-document-header");
    const returnLink = page.getByTestId("legal-document-return");
    const locale = page.getByTestId("legal-document-locale");
    await expect(header).toBeVisible();
    await expect(returnLink).toBeVisible();
    await expect(locale).toBeVisible();
    await expect(returnLink).toContainText("К подтверждению");
    await expect(page.getByTestId("public-header")).toHaveCount(0);

    const metrics = await page.evaluate(() => {
      const headerEl = document.querySelector(
        '[data-testid="legal-document-header"]',
      ) as HTMLElement | null;
      const returnEl = document.querySelector(
        '[data-testid="legal-document-return"]',
      ) as HTMLElement | null;
      const localeEl = document.querySelector(
        '[data-testid="legal-document-locale"]',
      ) as HTMLElement | null;
      const heading = document.querySelector("h1");
      const headerBox = headerEl?.getBoundingClientRect();
      const returnBox = returnEl?.getBoundingClientRect();
      const localeBox = localeEl?.getBoundingClientRect();
      const headingBox = heading?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        headerHeight: headerBox?.height ?? 0,
        returnHeight: returnBox?.height ?? 0,
        returnRight: returnBox?.right ?? 0,
        localeLeft: localeBox?.left ?? 0,
        headingTop: headingBox?.top ?? 0,
        headerBottom: headerBox?.bottom ?? 0,
      };
    });

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    expect(metrics.headerHeight).toBeGreaterThan(0);
    expect(metrics.headerHeight).toBeLessThan(88);
    expect(metrics.returnHeight).toBeGreaterThanOrEqual(40);
    expect(metrics.returnRight).toBeLessThanOrEqual(metrics.localeLeft + 1);
    expect(metrics.headingTop).toBeGreaterThanOrEqual(metrics.headerBottom - 1);

    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect(header).toBeVisible();
    await expect(returnLink).toBeVisible();
    await expect(locale).toBeVisible();

    await page.getByTestId("site-footer").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("site-footer")).toBeVisible();
  });
});
