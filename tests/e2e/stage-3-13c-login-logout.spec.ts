import { expect, test } from "@playwright/test";

import { createActiveUser, query } from "./helpers/db";

test("anonymous browser can log in, log out, and log in again with trusted-proxy headers @browser-smoke", async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error("Playwright baseURL is required.");

  const password = "Stage313C-login-logout!";
  const user = await createActiveUser({
    email: undefined,
    password,
    preferredLocale: "en",
  });

  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-host": "local.negotaitions.ru",
      "x-forwarded-proto": "https",
      "x-negotaitions-client-ip": "127.0.0.1",
    },
  });
  const page = await context.newPage();

  try {
    await page.goto("/login?returnUrl=%2Fdashboard");
    await expect(page.getByRole("heading", { name: /Welcome back|С возвращением/ })).toBeVisible();
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /Log in|Войти/ }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    await expect(page.getByTestId("account-menu-trigger")).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === "auth_session")).toBe(true);

    await page.getByTestId("account-menu-trigger").click();
    await page.getByTestId("account-menu-logout").press("Enter");
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((cookie) => cookie.name === "auth_session")).toBe(false);

    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /Log in|Войти/ }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?.*)?$/);
    await expect(page.getByTestId("account-menu-trigger")).toBeVisible();
    await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
  } finally {
    await context.close();
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});
