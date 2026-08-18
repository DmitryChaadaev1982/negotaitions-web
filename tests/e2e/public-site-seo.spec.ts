import { expect, test } from "@playwright/test";

import {
  createActiveUser,
  createUserSessionCookie,
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

async function optionalAttribute(
  page: import("@playwright/test").Page,
  selector: string,
  attribute: string,
) {
  const locator = page.locator(selector);
  if ((await locator.count()) === 0) {
    return null;
  }
  return locator.first().getAttribute(attribute);
}

test("homepage exposes indexable title, description, canonical, and OG @smoke @browser-smoke", async ({
  page,
}) => {
  await setLocale(page, "ru");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(
    /ПереговорИИ \(NegotAItions\) — учебные переговоры с AI-разбором/,
  );
  const description = page.locator('meta[name="description"]');
  await expect(description).toHaveAttribute(
    "content",
    /ПереговорИИ \(NegotAItions\) — платформа для учебных переговорных сессий/,
  );
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /index/);
  await expect(robots).not.toHaveAttribute("content", /noindex/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /^https:\/\/negotaitions\.ru\/?$/,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    /ПереговорИИ \(NegotAItions\)/,
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    /^https:\/\/negotaitions\.ru\/?$/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveCount(1);
  await expect(page.locator('meta[name="yandex-verification"]')).toHaveCount(0);
  const canonical = await optionalAttribute(page, 'link[rel="canonical"]', "href");
  const ogUrl = await optionalAttribute(page, 'meta[property="og:url"]', "content");
  expect(canonical ?? "").not.toContain("returnTo");
  expect(ogUrl ?? "").not.toContain("returnTo");
  const html = await page.content();
  expect(html).not.toMatch(/joinToken|hostToken|participantToken/i);
  const iconHref = await optionalAttribute(page, 'link[rel="icon"]', "href");
  const shortcutHref = await optionalAttribute(
    page,
    'link[rel="shortcut icon"]',
    "href",
  );
  expect(`${iconHref ?? ""} ${shortcutHref ?? ""}`).toMatch(/favicon\.ico/i);
});

test("about FAQ and support metadata titles differ and stay canonical @smoke", async ({
  page,
}) => {
  await setLocale(page, "ru");
  await page.goto("/about", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/Об авторе/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://negotaitions.ru/about",
  );

  await page.goto("/faq", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/FAQ/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://negotaitions.ru/faq",
  );

  await page.goto("/support", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/Поддержка/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://negotaitions.ru/support",
  );
});

test("legal documents are noindex follow and strip returnTo from canonical @smoke", async ({
  page,
}) => {
  await page.goto("/privacy?returnTo=/dashboard&returnContext=app", {
    waitUntil: "domcontentloaded",
  });
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/i);
  await expect(robots).toHaveAttribute("content", /follow/i);
  const canonical = await optionalAttribute(page, 'link[rel="canonical"]', "href");
  expect(canonical).toBe("https://negotaitions.ru/privacy");
  expect(canonical ?? "").not.toContain("returnTo");
  const ogUrl = await optionalAttribute(page, 'meta[property="og:url"]', "content");
  expect(ogUrl ?? "").not.toContain("returnTo");
});

test("login and dashboard are noindex and do not canonicalize to the homepage @smoke", async ({
  page,
}) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/i,
  );

  const user = await createActiveUser({ preferredLocale: "en" });
  const cookieHeader = await createUserSessionCookie(user.id);
  await page.context().addCookies([
    {
      name: "auth_session",
      value: cookieHeader.slice("auth_session=".length),
      url: baseUrl(),
    },
  ]);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/i,
  );
  const canonical = await optionalAttribute(page, 'link[rel="canonical"]', "href");
  const ogUrl = await optionalAttribute(page, 'meta[property="og:url"]', "content");
  expect(canonical ?? "").not.toMatch(/^https:\/\/negotaitions\.ru\/?$/);
  expect(ogUrl ?? "").not.toMatch(/^https:\/\/negotaitions\.ru\/?$/);
});

test("join token routes do not expose the token in canonical or OG URL @smoke", async ({
  page,
}) => {
  const token = "synthetic-join-token-leak-test-xyz";
  const response = await page.goto(`/join/${token}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBeLessThan(500);
  const html = await page.content();
  const canonical = await optionalAttribute(page, 'link[rel="canonical"]', "href");
  const ogUrl = await optionalAttribute(page, 'meta[property="og:url"]', "content");
  expect(canonical ?? "").not.toContain(token);
  expect(ogUrl ?? "").not.toContain(token);
  expect(html).not.toContain(`https://negotaitions.ru/join/${token}`);
});

test("robots.txt and sitemap.xml stay conservative @smoke @browser-smoke", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBeTruthy();
  const robotsBody = await robots.text();
  expect(robotsBody).toContain("https://negotaitions.ru/sitemap.xml");
  expect(robotsBody).toMatch(/Allow:\s*\/\s*$/m);
  expect(robotsBody).toContain("Disallow: /login");
  expect(robotsBody).toContain("Disallow: /dashboard");
  expect(robotsBody).toContain("Disallow: /join");
  expect(robotsBody).toContain("Disallow: /room");
  expect(robotsBody).toContain("Disallow: /admin");
  expect(robotsBody).toContain("Disallow: /legal-update");
  expect(robotsBody).not.toContain("joinToken");
  expect(robotsBody).not.toMatch(/Disallow:\s*\/about/);

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBeTruthy();
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toMatch(/https:\/\/negotaitions\.ru\/?<\/loc>/);
  expect(sitemapBody).toContain("https://negotaitions.ru/about");
  expect(sitemapBody).toContain("https://negotaitions.ru/faq");
  expect(sitemapBody).toContain("https://negotaitions.ru/support");
  expect(sitemapBody).not.toContain("/privacy");
  expect(sitemapBody).not.toContain("/login");
  expect(sitemapBody).not.toContain("/dashboard");
  expect(sitemapBody).not.toContain("/join");
  expect(sitemapBody).not.toContain("/admin");
  expect(sitemapBody).not.toContain("/legal-update");
  expect(sitemapBody).not.toContain("/api");

  const ogImage = await request.get("/opengraph-image");
  expect(ogImage.ok()).toBeTruthy();
  expect(ogImage.headers()["content-type"] ?? "").toMatch(/image\/png/);

  const favicon = await request.get("/favicon.ico", { maxRedirects: 0 });
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"] ?? "").toMatch(
    /image\/(x-icon|vnd\.microsoft\.icon)/i,
  );
  const faviconBody = Buffer.from(await favicon.body());
  expect(faviconBody.readUInt16LE(0)).toBe(0);
  expect(faviconBody.readUInt16LE(2)).toBe(1);
  expect(faviconBody.readUInt16LE(4)).toBeGreaterThan(0);
});
