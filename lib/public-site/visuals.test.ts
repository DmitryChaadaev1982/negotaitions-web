import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getPublicSiteVisual } from "./visuals";

test("public homepage visuals map hero to a shared asset and flow to locale PNGs", () => {
  const ruHero = getPublicSiteVisual("hero-product", "ru");
  const enHero = getPublicSiteVisual("hero-product", "en");
  const ruFlow = getPublicSiteVisual("training-flow", "ru");
  const enFlow = getPublicSiteVisual("training-flow", "en");

  assert.equal(ruHero.src, "/images/landing/hero-negotiation-ai.jpg");
  assert.equal(enHero.src, ruHero.src);
  assert.equal(ruHero.width, 819);
  assert.equal(ruHero.height, 1024);
  assert.equal(ruFlow.src, "/images/public-site/public-how-it-works-ru-no-heading.png");
  assert.equal(enFlow.src, "/images/public-site/public-how-it-works-en-no-heading.png");
  assert.doesNotMatch(ruFlow.src, /-en-no-heading\.png$/);
  assert.doesNotMatch(enFlow.src, /-ru-no-heading\.png$/);
  assert.equal(ruFlow.width, 2173);
  assert.equal(ruFlow.height, 724);
  assert.equal(ruFlow.cropTop, 63);
  assert.equal(enFlow.cropTop, 36);
});

test("public homepage visual files exist at the mapped public paths", () => {
  const assets = [
    getPublicSiteVisual("hero-product", "ru"),
    getPublicSiteVisual("hero-product", "en"),
    getPublicSiteVisual("training-flow", "ru"),
    getPublicSiteVisual("training-flow", "en"),
  ];

  for (const asset of assets) {
    const filePath = path.join(process.cwd(), "public", asset.src.replace(/^\//, ""));
    assert.equal(existsSync(filePath), true, `missing ${filePath}`);
  }
});
