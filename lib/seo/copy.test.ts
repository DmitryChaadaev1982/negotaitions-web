import assert from "node:assert/strict";
import test from "node:test";

import { getPublicSeoCopy } from "@/lib/seo/copy";

const FORBIDDEN = [
  /guaranteed/i,
  /гарантир/i,
  /objective AI assessment/i,
  /autonomous AI negotiation/i,
  /legal advice/i,
  /юридическ(ая|ую) консультац/i,
];

test("SEO copy stays locale-specific and does not introduce unapproved claims", () => {
  const ru = getPublicSeoCopy("ru");
  const en = getPublicSeoCopy("en");

  assert.equal(ru.siteName, "ПереговорИИ (NegotAItions)");
  assert.equal(en.siteName, "NegotAItions");
  assert.match(ru.pages["/"].description, /ПереговорИИ \(NegotAItions\)/);
  assert.match(en.pages["/"].description, /^NegotAItions /);
  assert.doesNotMatch(en.pages["/"].title, /ПереговорИИ/);
  assert.notEqual(ru.pages["/"].title, ru.pages["/about"].title);
  assert.notEqual(en.pages["/"].title, en.pages["/faq"].title);

  for (const copy of [JSON.stringify(ru), JSON.stringify(en)]) {
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(copy, pattern);
    }
  }
});
