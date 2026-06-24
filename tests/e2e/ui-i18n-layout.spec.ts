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

