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

test("live smoke tests are skipped by default", async () => {
  test.skip(
    process.env.RUN_LIVE_SMOKE_TESTS !== "true",
    "Live external-service smoke tests require RUN_LIVE_SMOKE_TESTS=true.",
  );
});

