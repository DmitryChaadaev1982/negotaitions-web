import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  deleteUserByEmail,
  getUserPreferredLocale,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

/**
 * Phase 6.2.1 — Logged-in language switch persists to User.preferredLocale.
 *
 * Verifies that an authenticated ACTIVE user switching language in the app
 * header updates the DB column (via the updateUserPreferredLocale server
 * action) while the client-side switch remains immediate.
 */
test.describe("Phase 6.2.1 — logged-in language persistence", () => {
  let userEmail: string | null = null;

  test.afterEach(async () => {
    if (userEmail) {
      await deleteUserByEmail(userEmail);
      userEmail = null;
    }
  });

  test("active user switching RU→EN persists preferredLocale to DB", async ({
    page,
  }) => {
    const user = await createActiveUser({ preferredLocale: "ru" });
    userEmail = user.email;

    await expect.poll(() => getUserPreferredLocale(user.email)).toBe("ru");

    // Log in via the form so a real session cookie is established.
    await page.goto("/login");
    await page.locator("#email").fill(user.email);
    await page.locator("#password").fill(user.password);
    await page.locator('button[type="submit"]').click();

    // Active non-admin users land on the dashboard, which renders the app
    // header LanguageSwitcher (persistToServer enabled).
    await page.waitForURL("**/dashboard");

    await page.getByTestId("language-switch-en").click();

    // Client-side switch is immediate; navigation labels render in English.
    await expect(page.getByTestId("nav-dashboard")).toHaveText("Dashboard");

    // Server action persists the change to the DB.
    await expect
      .poll(() => getUserPreferredLocale(user.email), { timeout: 10_000 })
      .toBe("en");
  });
});
