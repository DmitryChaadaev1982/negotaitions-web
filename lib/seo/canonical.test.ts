import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCanonicalPath, toCanonicalUrl } from "@/lib/seo/canonical";
import { PUBLIC_CANONICAL_ORIGIN } from "@/lib/seo/site";

test("canonical URLs drop query, hash, and trailing slash", () => {
  assert.equal(toCanonicalUrl("/"), PUBLIC_CANONICAL_ORIGIN);
  assert.equal(toCanonicalUrl("/about"), `${PUBLIC_CANONICAL_ORIGIN}/about`);
  assert.equal(
    toCanonicalUrl("/privacy?returnTo=/dashboard&returnContext=app"),
    `${PUBLIC_CANONICAL_ORIGIN}/privacy`,
  );
  assert.equal(
    toCanonicalUrl("/about?utm_source=test#hero"),
    `${PUBLIC_CANONICAL_ORIGIN}/about`,
  );
  assert.equal(normalizeCanonicalPath("/faq/"), "/faq");
});

test("canonical URLs never keep join or auth parameters", () => {
  assert.equal(
    toCanonicalUrl("/join/secret-token?hostToken=abc"),
    `${PUBLIC_CANONICAL_ORIGIN}/join/secret-token`,
  );
  assert.doesNotMatch(toCanonicalUrl("/privacy?returnTo=/join/tok"), /join\/tok/);
  assert.doesNotMatch(toCanonicalUrl("/about?foo=bar"), /\?/);
});
