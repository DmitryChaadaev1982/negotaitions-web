import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getDictionary } from "@/lib/i18n/dictionaries";
import { PUBLIC_FAQ_ITEMS } from "@/lib/public-site/faq-items";
import {
  AUTHOR_PORTRAIT_AVAILABLE,
  AUTHOR_PORTRAIT_HEIGHT,
  AUTHOR_PORTRAIT_PUBLIC_PATH,
  AUTHOR_PORTRAIT_WIDTH,
} from "@/lib/public-site/author-portrait";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/seo/indexing";

test("RU and EN About copy use locale-specific product and author names", () => {
  const ru = getDictionary("ru");
  const en = getDictionary("en");

  assert.equal(ru.publicAbout.title, "Об авторе");
  assert.equal(ru.publicAbout.authorName, "Чаадаев Дмитрий Владимирович");
  assert.match(ru.publicAbout.p2, /ПереговорИИ \(NegotAItions\)/);
  assert.match(ru.publicAbout.p8, new RegExp(PUBLIC_CONTACT_EMAIL));

  assert.equal(en.publicAbout.title, "About");
  assert.equal(en.publicAbout.authorName, "Dmitry Chaadaev");
  assert.match(en.publicAbout.p2, /NegotAItions emerged/);
  assert.doesNotMatch(en.publicAbout.p2, /ПереговорИИ/);
  assert.doesNotMatch(en.publicAbout.authorName, /Чаадаев/);
  assert.doesNotMatch(JSON.stringify(en.publicAbout), /ПереговорИИ|Чаадаев/);
  assert.equal(ru.publicAbout.photoAlt, "Чаадаев Дмитрий Владимирович");
  assert.equal(en.publicAbout.photoAlt, "Dmitry Chaadaev");
  assert.equal(AUTHOR_PORTRAIT_PUBLIC_PATH, "/images/public-site/author-portrait.jpg");
  assert.equal(AUTHOR_PORTRAIT_AVAILABLE, true);
  assert.equal(AUTHOR_PORTRAIT_WIDTH, 1024);
  assert.equal(AUTHOR_PORTRAIT_HEIGHT, 768);
  assert.equal(
    existsSync(
      path.join(process.cwd(), "public", AUTHOR_PORTRAIT_PUBLIC_PATH.replace(/^\//, "")),
    ),
    true,
  );
});

test("RU and EN Support copy keep the public contact address and EN branding", () => {
  const ru = getDictionary("ru");
  const en = getDictionary("en");

  assert.equal(ru.publicSupport.title, "Поддержка");
  assert.match(ru.publicSupport.intro, /ПереговорИИ \(NegotAItions\)/);
  assert.equal(en.publicSupport.title, "Support");
  assert.match(en.publicSupport.intro, /NegotAItions/);
  assert.doesNotMatch(en.publicSupport.intro, /ПереговорИИ/);
  assert.doesNotMatch(JSON.stringify(en.publicSupport), /ПереговорИИ|Чаадаев/);
});

test("FAQ has ten Wave 2A items and EN answers omit Russian branding", () => {
  const ru = getDictionary("ru");
  const en = getDictionary("en");

  assert.equal(PUBLIC_FAQ_ITEMS.length, 10);
  assert.equal(ru.publicFaq.q1, "Что такое ПереговорИИ (NegotAItions)?");
  assert.equal(en.publicFaq.q1, "What is NegotAItions?");
  assert.doesNotMatch(JSON.stringify(en.publicFaq), /ПереговорИИ|Чаадаев/);
  assert.match(ru.publicFaq.a10p1, new RegExp(PUBLIC_CONTACT_EMAIL));
  assert.match(en.publicFaq.a10p1, new RegExp(PUBLIC_CONTACT_EMAIL));
  assert.doesNotMatch(en.publicFaq.a7p1, /absolute truth|guaranteed|always correct/i);
});
