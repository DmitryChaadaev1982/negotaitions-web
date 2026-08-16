import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  createUserSessionCookie,
  query,
} from "./helpers/db";

function baseUrl() {
  return test.info().project.use.baseURL ?? "http://127.0.0.1:3100";
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

test("RU About, Support and FAQ render public chrome and approved copy @smoke", async ({
  page,
}) => {
  await setLocale(page, "ru");
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-header")).toBeVisible();
  await expect(page.getByTestId("nav-dashboard")).toHaveCount(0);
  await expect(page.getByTestId("public-header")).not.toContainText("Материалы");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Об авторе");
  await expect(page.getByTestId("about-author-name")).toHaveText(
    "Чаадаев Дмитрий Владимирович",
  );
  await expect(page.getByTestId("about-author-photo-slot")).toBeVisible();
  await expect(page.getByTestId("about-author-photo")).toHaveAttribute(
    "alt",
    "Чаадаев Дмитрий Владимирович",
  );
  await expect(page.getByTestId("about-author-photo")).toHaveAttribute(
    "src",
    /author-portrait-full\.jpg/,
  );
  await expect(page.getByTestId("public-about")).toContainText(
    "ПереговорИИ (NegotAItions)",
  );
  await expect(page.getByTestId("support-email")).toHaveAttribute(
    "href",
    "mailto:support@negotaitions.ru",
  );

  await page.goto("/support", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-header")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Поддержка");
  await expect(page.getByTestId("support-email")).toHaveAttribute(
    "href",
    "mailto:support@negotaitions.ru",
  );
  await expect(page.getByText("Не отправляйте пароль")).toBeVisible();

  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-header")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FAQ");
  await expect(page.getByTestId("faq-item-1")).toContainText(
    "Что такое ПереговорИИ (NegotAItions)?",
  );
  await expect(page.getByTestId("faq-item-10")).toBeVisible();
  await page.getByTestId("faq-item-1").locator("summary").click();
  await expect(page.getByTestId("faq-item-1")).toContainText(
    "проект об использовании искусственного интеллекта",
  );
});

test("EN communication pages use English branding and working navigation @browser-smoke", async ({
  page,
}) => {
  await setLocale(page, "en");
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("About");
  await expect(page.getByTestId("about-author-name")).toHaveText("Dmitry Chaadaev");
  await expect(page.getByTestId("about-author-photo")).toHaveAttribute(
    "alt",
    "Dmitry Chaadaev",
  );
  await expect(page.getByTestId("about-author-photo")).toHaveAttribute(
    "src",
    /author-portrait-full\.jpg/,
  );
  await expect(page.getByTestId("public-about")).not.toContainText("ПереговорИИ");
  await expect(page.getByTestId("public-about")).not.toContainText("Чаадаев");
  await expect(page.getByTestId("public-nav-author")).toHaveAttribute(
    "href",
    "/about",
  );
  await expect(page.getByTestId("footer-support")).toHaveAttribute(
    "href",
    "/support",
  );

  await page.goto("/support", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Support");
  await expect(page.locator("main")).not.toContainText("ПереговорИИ");
  await expect(page.getByTestId("support-email")).toHaveAttribute(
    "href",
    "mailto:support@negotaitions.ru",
  );

  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("faq-item-1")).toContainText("What is NegotAItions?");
  await expect(page.locator("main")).not.toContainText("ПереговорИИ");
  await expect(page.locator("main")).not.toContainText("Чаадаев");
});

test("authenticated visitor keeps public chrome on communication pages @browser-smoke", async ({
  page,
}) => {
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
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("public-header")).toBeVisible();
    await expect(page.getByTestId("public-cta-platform")).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(page.getByTestId("nav-dashboard")).toHaveCount(0);
    await expect(page.getByTestId("nav-cases")).toHaveCount(0);
    await expect(page.getByTestId("public-header")).not.toContainText("Materials");
    await expect(page.getByTestId("public-cta-login")).toHaveCount(0);
  } finally {
    await query(`DELETE FROM "User" WHERE "id" = $1`, [user.id]);
  }
});

test("FAQ accordion is keyboard-operable", async ({ page }) => {
  await setLocale(page, "en");
  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  const first = page.getByTestId("faq-item-1");
  await expect(first).not.toHaveAttribute("open");
  await first.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("open", "");
});
