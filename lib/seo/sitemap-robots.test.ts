import assert from "node:assert/strict";
import test from "node:test";

import { isCredentialBearingPath } from "@/lib/seo/indexing";
import { buildPublicMarketingMetadata } from "@/lib/seo/page-metadata";
import { buildRobotsPolicy } from "@/lib/seo/robots-policy";
import { getSitemapEntries, sitemapContainsPath } from "@/lib/seo/sitemap-pages";
import { PUBLIC_SITEMAP_URL } from "@/lib/seo/site";

test("robots.txt references the production sitemap and disallows private areas", () => {
  const robots = buildRobotsPolicy();
  assert.equal(robots.sitemap, PUBLIC_SITEMAP_URL);
  const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
  assert.ok(rules);
  const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
  for (const path of [
    "/login",
    "/register",
    "/dashboard",
    "/join",
    "/room",
    "/admin",
    "/legal-update",
    "/api",
  ]) {
    assert.ok(disallow.includes(path), path);
  }
  assert.equal(disallow.includes("/"), false);
  assert.equal(disallow.includes("/about"), false);
  assert.equal(disallow.includes("/privacy"), false);
  assert.equal(disallow.includes("/favicon.ico"), false);
  const blocksFavicon = disallow.some(
    (path) =>
      typeof path === "string" &&
      (path === "/favicon.ico" ||
        path === "/favicon" ||
        "/favicon.ico".startsWith(`${path}/`)),
  );
  assert.equal(blocksFavicon, false);
  const serialized = JSON.stringify(robots);
  assert.doesNotMatch(serialized, /joinToken|hostToken|participantToken/);
});

test("sitemap allowlists only public marketing canonical URLs", () => {
  const entries = getSitemapEntries();
  const urls = entries.map((entry) => entry.url);
  assert.deepEqual(urls, [
    "https://negotaitions.ru",
    "https://negotaitions.ru/about",
    "https://negotaitions.ru/support",
    "https://negotaitions.ru/faq",
  ]);
  for (const entry of entries) {
    assert.equal("lastModified" in entry, false);
  }
  assert.equal(sitemapContainsPath("/privacy"), false);
  assert.equal(sitemapContainsPath("/login"), false);
  assert.equal(sitemapContainsPath("/join/token"), false);
  assert.equal(sitemapContainsPath("/legal-update"), false);
  assert.equal(sitemapContainsPath("/admin"), false);
  assert.equal(isCredentialBearingPath("/join/token"), true);
});

test("public page metadata has unique titles, canonical, and OG fields", () => {
  const home = buildPublicMarketingMetadata({ locale: "ru", pathname: "/" });
  const about = buildPublicMarketingMetadata({ locale: "ru", pathname: "/about" });
  const faq = buildPublicMarketingMetadata({ locale: "en", pathname: "/faq" });
  const support = buildPublicMarketingMetadata({ locale: "en", pathname: "/support" });

  assert.equal(
    typeof home.title === "object" && home.title && "absolute" in home.title
      ? home.title.absolute
      : home.title,
    "ПереговорИИ (NegotAItions) — учебные переговоры с AI-разбором",
  );
  assert.equal(about.title, "Об авторе");
  assert.equal(faq.title, "FAQ");
  assert.equal(support.title, "Support");
  assert.notEqual(home.description, about.description);
  assert.equal(home.alternates?.canonical, "https://negotaitions.ru");
  assert.equal(about.alternates?.canonical, "https://negotaitions.ru/about");
  assert.equal(home.openGraph?.url, "https://negotaitions.ru");
  assert.equal(home.openGraph?.title, "ПереговорИИ (NegotAItions) — учебные переговоры с AI-разбором");
  assert.ok(Array.isArray(home.openGraph?.images) && home.openGraph.images[0]);
  const image = Array.isArray(home.openGraph?.images) ? home.openGraph.images[0] : null;
  assert.ok(image && typeof image === "object" && "alt" in image);
  assert.equal(home.twitter?.card, "summary_large_image");
  assert.equal("verification" in home, false);
  assert.doesNotMatch(JSON.stringify(home), /joinToken|hostToken|returnTo/);
});
