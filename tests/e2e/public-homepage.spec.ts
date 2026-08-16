import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  createUserSessionCookie,
  query,
} from "./helpers/db";

async function gotoHome(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("unauthenticated public homepage stays on / and exposes login and register @browser-smoke @smoke", async ({
  page,
}) => {
  await gotoHome(page);
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await expect(page).not.toHaveURL(/dashboard|login/);
  await expect(page.getByTestId("public-header")).toBeVisible();
  await expect(page.getByTestId("public-hero")).toBeVisible();
  await expect(page.getByTestId("public-cta-login")).toBeVisible();
  await expect(page.getByTestId("public-cta-register")).toBeVisible();
  await expect(page.getByTestId("public-hero-primary")).toHaveAttribute(
    "href",
    "/login",
  );
  await expect(page.getByTestId("footer-privacy")).toHaveAttribute(
    "href",
    "/privacy",
  );
  await expect(page.getByTestId("footer-terms")).toHaveAttribute("href", "/terms");
  await expect(page.getByTestId("footer-about")).toHaveAttribute("href", "/about");
  await expect(page.getByTestId("footer-support")).toHaveAttribute(
    "href",
    "/support",
  );
  await expect(page.getByTestId("footer-faq")).toHaveAttribute("href", "/faq");
  await expect(page.getByTestId("public-nav-author")).toHaveAttribute(
    "href",
    "/about",
  );
  await expect(page.getByTestId("public-nav-faq")).toHaveAttribute("href", "/faq");
  await expect(page.getByRole("heading", { name: /Автор и сотрудничество|Author and collaboration/ })).toHaveCount(0);
  await expect(page.getByText("капитаном переговорного клуба")).toHaveCount(0);
  await expect(page.getByText("Материалы")).toHaveCount(0);
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /^(?!.*noindex).*$/i);
});

test("authenticated / remains the public homepage and offers the platform CTA @browser-smoke", async ({
  page,
}) => {
  const user = await createActiveUser({ preferredLocale: "en" });
  const cookieHeader = await createUserSessionCookie(user.id);

  try {
    await page.context().addCookies([
      {
        name: "auth_session",
        value: cookieHeader.slice("auth_session=".length),
        url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
      },
    ]);
    await gotoHome(page);
    await expect(page).toHaveURL(/\/(?:\?.*)?$/);
    await expect(page.getByTestId("public-hero")).toBeVisible();
    await expect(page.getByTestId("public-cta-platform")).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(page.getByTestId("public-hero-primary")).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(page.getByTestId("public-cta-login")).toHaveCount(0);
    await expect(page.getByTestId("public-cta-register")).toHaveCount(0);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("unauthenticated /dashboard remains auth-gated @smoke", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdashboard/);
});

test("RU locale cookie renders approved homepage copy", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("negotaitions_locale", "ru");
    document.cookie = "negotaitions_locale=ru;path=/;max-age=31536000;samesite=lax";
  });
  await page.context().addCookies([
    {
      name: "negotaitions_locale",
      value: "ru",
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
    },
  ]);
  await gotoHome(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Тренируйте переговоры.",
  );
  await expect(page.getByText("ПереговорИИ (NegotAItions)").first()).toBeVisible();
  await expect(page.getByText("ИИ — не вместо собеседника.")).toBeVisible();
  await expect(page.getByTestId("site-footer")).toContainText(
    "© 2026 Чаадаев Дмитрий Владимирович · ПереговорИИ (NegotAItions)",
  );
  await expect(page.locator('[data-public-visual-slot="hero-product"] img')).toHaveAttribute(
    "src",
    /hero-negotiation-ai\.jpg/,
  );
  await expect(page.locator('[data-public-visual-slot="training-flow"] img')).toHaveAttribute(
    "src",
    /public-how-it-works-ru-no-heading\.png/,
  );
  await expect(page.locator('[data-public-visual-slot="training-flow"] img')).not.toHaveAttribute(
    "src",
    /-en\.png/,
  );
});

test("EN locale cookie renders equivalent homepage copy", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("negotaitions_locale", "en");
    document.cookie = "negotaitions_locale=en;path=/;max-age=31536000;samesite=lax";
  });
  await page.context().addCookies([
    {
      name: "negotaitions_locale",
      value: "en",
      url: test.info().project.use.baseURL ?? "http://127.0.0.1:3100",
    },
  ]);
  await gotoHome(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Train negotiations.",
  );
  await expect(page.getByTestId("public-hero-brand")).toHaveText("NegotAItions");
  await expect(page.getByTestId("public-hero-brand")).not.toContainText("ПереговорИИ");
  await expect(page.getByTestId("site-footer")).toContainText(
    "© 2026 Dmitry Chaadaev · NegotAItions",
  );
  await expect(page.getByTestId("site-footer")).not.toContainText("Чаадаев");
  await expect(page.getByTestId("site-footer")).not.toContainText("ПереговорИИ");
  await expect(page.getByTestId("public-hero")).not.toContainText("ПереговорИИ");
  await expect(page.locator("main")).not.toContainText("ПереговорИИ");
  await expect(page.locator("main")).not.toContainText("Чаадаев");
  await expect(page.locator('[data-public-visual-slot="hero-product"] img')).toHaveAttribute(
    "src",
    /hero-negotiation-ai\.jpg/,
  );
  await expect(page.locator('[data-public-visual-slot="training-flow"] img')).toHaveAttribute(
    "src",
    /public-how-it-works-en-no-heading\.png/,
  );
  await expect(page.locator('[data-public-visual-slot="training-flow"] img')).not.toHaveAttribute(
    "src",
    /-ru\.png/,
  );
});

test("login is noindex while the public homepage is not", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/i);
});

test("mobile public navigation opens with the keyboard toggle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 720 });
  await gotoHome(page);
  await expect(page.getByTestId("public-nav-desktop")).toBeHidden();
  await page.getByTestId("public-nav-mobile-toggle").click();
  await expect(page.getByTestId("public-nav-mobile")).toBeVisible();
  await expect(
    page.getByTestId("public-nav-mobile").getByTestId("public-nav-capabilities"),
  ).toBeVisible();
});
