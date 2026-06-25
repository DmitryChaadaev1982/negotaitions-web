import { expect, test } from "@playwright/test";

import {
  cleanupE2eData,
  createSnapshotJoinFixture,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanupE2eData();
});

test.afterAll(async () => {
  await cleanupE2eData();
});

test("RU/EN switch changes UI labels but not dynamic content or product spelling", async ({
  page,
}) => {
  const { joinToken } = await createSnapshotJoinFixture();

  await page.goto(`/join/${joinToken}`);
  await expect(page.getByText("E2E_DYNAMIC_CASE_TEXT_STAYS_ENGLISH")).toBeVisible();
  await expect(page.getByText("E2E_DYNAMIC_NOTE_NOT_TRANSLATED")).toBeVisible();
  await expect(page.getByText("NegotAItions")).toBeVisible();

  await page.evaluate(() => {
    window.localStorage.setItem("negotaitions_locale", "ru");
    document.cookie = "negotaitions_locale=ru;path=/";
  });
  await page.reload();
  await expect(page.getByText("Публичные инструкции")).toBeVisible();
  await expect(page.getByText("E2E_DYNAMIC_CASE_TEXT_STAYS_ENGLISH")).toBeVisible();
  await expect(page.getByText("E2E_DYNAMIC_NOTE_NOT_TRANSLATED")).toBeVisible();
  await expect(page.getByText("NegotAItions")).toBeVisible();

  await page.evaluate(() => {
    window.localStorage.setItem("negotaitions_locale", "en");
    document.cookie = "negotaitions_locale=en;path=/";
  });
  await page.reload();
  await expect(page.getByText("Public instructions")).toBeVisible();
  await expect(page.getByText("E2E_DYNAMIC_CASE_TEXT_STAYS_ENGLISH")).toBeVisible();
});

test("sticky headers do not overlap first visible content on core pages", async ({
  page,
}) => {
  for (const path of [
    "/dashboard",
    "/cases",
    "/sessions",
    "/events",
    "/admin",
  ]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 160));

    const layout = await page.evaluate(() => {
      const header = document.querySelector("header");

      if (!header) {
        return null;
      }

      const headerBox = header.getBoundingClientRect();
      const probeY = Math.min(headerBox.bottom + 8, window.innerHeight - 1);
      const contentBelowHeader = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        probeY,
      );

      return {
        headerBottom: headerBox.bottom,
        viewportHeight: window.innerHeight,
        isHeaderAtProbe: contentBelowHeader
          ? header.contains(contentBelowHeader)
          : true,
      };
    });

    if (!layout) {
      continue;
    }

    expect(
      layout.headerBottom,
      `${path} header should not fill the viewport`,
    ).toBeLessThan(layout.viewportHeight);
    expect(
      layout.isHeaderAtProbe,
      `${path} content directly below sticky header should remain reachable`,
    ).toBe(false);
  }
});

test("RU/EN terminology and navigation order match current product", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page.getByTestId("nav-dashboard")).toHaveText("Dashboard");
  await expect(page.getByTestId("nav-cases")).toHaveText("Cases");
  await expect(page.getByTestId("nav-events")).toHaveText("Events");
  await expect(page.getByTestId("nav-sessions")).toHaveText("Sessions");
  await expect(page.getByTestId("nav-admin")).toHaveText("Admin diagnostics");
  await expect(page.getByText("Signed in as Facilitator")).toHaveCount(0);

  await page.getByTestId("language-switch-ru").click();
  await expect(page.getByTestId("nav-dashboard")).toHaveText("Панель");
  await expect(page.getByTestId("nav-cases")).toHaveText("Кейсы");
  await expect(page.getByTestId("nav-events")).toHaveText("Встречи");
  await expect(page.getByTestId("nav-sessions")).toHaveText("Сессии");
  await expect(page.getByTestId("nav-admin")).toHaveText("Административная диагностика");

  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Встречи" })).toBeVisible();
  await expect(page.getByText("Тренировки")).toHaveCount(0);
  await expect(page.getByText("Вход выполнен как Фасилитатор")).toHaveCount(0);
});

test("live smoke tests are skipped by default", async () => {
  test.skip(
    process.env.RUN_LIVE_SMOKE_TESTS !== "true",
    "Live external-service smoke tests require RUN_LIVE_SMOKE_TESTS=true.",
  );
});

// ── Phase 6.2 i18n and language preference tests ─────────────────────────────

test.describe("Phase 6.2 — Language switcher on auth pages", () => {
  test("/register has visible language switcher", async ({ page }) => {
    await page.goto("/register");
    const switcher = page.locator('[data-testid="language-switch-ru"], [data-testid="language-switch-en"]').first();
    await expect(switcher).toBeVisible();
  });

  test("/login has visible language switcher", async ({ page }) => {
    await page.goto("/login");
    const switcher = page.locator('[data-testid="language-switch-ru"], [data-testid="language-switch-en"]').first();
    await expect(switcher).toBeVisible();
  });

  test("/register can switch RU/EN before login — labels change", async ({ page }) => {
    await page.goto("/register");

    await page.getByTestId("language-switch-en").click();
    await expect(page.getByText("Create account")).toBeVisible();

    await page.getByTestId("language-switch-ru").click();
    await expect(page.getByText("Создать аккаунт")).toBeVisible();
  });

  test("/register has preferred language selector", async ({ page }) => {
    await page.goto("/register");
    const select = page.getByTestId("preferred-locale-select");
    await expect(select).toBeVisible();
    // Should have ru and en options
    await expect(select.locator("option[value='ru']")).toHaveCount(1);
    await expect(select.locator("option[value='en']")).toHaveCount(1);
  });
});

test.describe("Phase 6.2 — Language switcher on legal pages", () => {
  const legalPaths = [
    "/privacy",
    "/terms",
    "/cookie-policy",
    "/data-processing-consent",
    "/ai-processing-notice",
  ];

  for (const path of legalPaths) {
    test(`${path} has visible language switcher`, async ({ page }) => {
      await page.goto(path);
      const switcher = page.locator('[data-testid="language-switch-ru"], [data-testid="language-switch-en"]').first();
      await expect(switcher).toBeVisible();
    });
  }

  test("/privacy renders RU content when locale is ru", async ({ page }) => {
    await page.evaluate(() => {
      document.cookie = "negotaitions_locale=ru;path=/";
    });
    await page.goto("/privacy");
    await expect(page.getByText("Политика конфиденциальности")).toBeVisible();
  });

  test("/privacy renders EN content when locale is en", async ({ page }) => {
    await page.evaluate(() => {
      document.cookie = "negotaitions_locale=en;path=/";
    });
    await page.goto("/privacy");
    await expect(page.getByText("Privacy Policy")).toBeVisible();
  });
});

test.describe("Phase 6.2 — i18n consent modals have RU/EN text (static validation)", () => {
  test("Recording consent modal keys exist in both EN and RU dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    expect(en.legal.recordingConsentTitle).toBeTruthy();
    expect(en.legal.recordingConsentText).toBeTruthy();
    expect(en.legal.recordingConsentConfirm).toBeTruthy();
    expect(ru.legal.recordingConsentTitle).toBeTruthy();
    expect(ru.legal.recordingConsentText).toBeTruthy();
    expect(ru.legal.recordingConsentConfirm).toBeTruthy();
  });

  test("AI processing warning keys exist in both EN and RU dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    expect(en.legal.aiAnalysisWarningTitle).toBeTruthy();
    expect(en.legal.aiAnalysisWarningText).toBeTruthy();
    expect(ru.legal.aiAnalysisWarningTitle).toBeTruthy();
    expect(ru.legal.aiAnalysisWarningText).toBeTruthy();
  });

  test("Share debrief warning keys exist in both EN and RU dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    expect(en.legal.shareDebriefWarningTitle).toBeTruthy();
    expect(en.legal.shareDebriefWarningText).toBeTruthy();
    expect(ru.legal.shareDebriefWarningTitle).toBeTruthy();
    expect(ru.legal.shareDebriefWarningText).toBeTruthy();
  });

  test("Case data warning and materials retention notice keys exist in both dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    expect(en.legal.caseDataWarning).toBeTruthy();
    expect(en.legal.materialsRetentionNotice).toBeTruthy();
    expect(en.legal.privateRoleDataWarning).toBeTruthy();
    expect(ru.legal.caseDataWarning).toBeTruthy();
    expect(ru.legal.materialsRetentionNotice).toBeTruthy();
    expect(ru.legal.privateRoleDataWarning).toBeTruthy();
  });

  test("preferredLocale registration keys exist in both EN and RU dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    expect(en.auth.preferredLocale).toBeTruthy();
    expect(en.auth.preferredLocaleRu).toBeTruthy();
    expect(en.auth.preferredLocaleEn).toBeTruthy();
    expect(ru.auth.preferredLocale).toBeTruthy();
    expect(ru.auth.preferredLocaleRu).toBeTruthy();
    expect(ru.auth.preferredLocaleEn).toBeTruthy();
  });

  test("Cookie banner keys exist in both dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    expect(en.legal.cookieBannerText).toBeTruthy();
    expect(en.legal.acceptAll).toBeTruthy();
    expect(en.legal.rejectOptional).toBeTruthy();
    expect(ru.legal.cookieBannerText).toBeTruthy();
    expect(ru.legal.acceptAll).toBeTruthy();
    expect(ru.legal.rejectOptional).toBeTruthy();
  });

  test("Auth pages (login/register/pending/rejected/blocked) keys exist in both dictionaries", async () => {
    const { en } = await import("../../lib/i18n/dictionaries/en");
    const { ru } = await import("../../lib/i18n/dictionaries/ru");

    const authKeys = [
      "loginTitle", "loginSubtitle", "registerTitle", "registerSubtitle",
      "pendingTitle", "pendingMessage", "rejectedTitle", "rejectedMessage",
      "blockedTitle", "blockedMessage",
    ] as const;

    for (const key of authKeys) {
      expect(en.auth[key], `EN missing auth.${key}`).toBeTruthy();
      expect(ru.auth[key], `RU missing auth.${key}`).toBeTruthy();
    }
  });
});

