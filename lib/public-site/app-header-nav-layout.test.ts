import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

const ROOT = process.cwd();

test("authenticated header brand and public-site link use locale-independent flex spacing", () => {
  const nav = readFileSync(join(ROOT, "components/app-header-nav.tsx"), "utf8");
  const header = readFileSync(join(ROOT, "components/app-header.tsx"), "utf8");
  const logo = readFileSync(join(ROOT, "components/ui/brand-logo.tsx"), "utf8");

  assert.match(nav, /flex shrink-0 items-center gap-4 sm:gap-6/);
  assert.match(nav, /data-testid="nav-public-site"/);
  assert.match(nav, /className="hidden max-w-\[320px\] sm:inline-flex"/);
  assert.match(nav, /shrink-0 rounded-lg px-3 py-2/);
  assert.doesNotMatch(nav, /fullLogoSpacingClass/);
  assert.doesNotMatch(nav, /locale === "ru" \? "sm:mr-/);
  assert.doesNotMatch(nav, /sm:mr-1 lg:mr-2/);
  assert.doesNotMatch(nav, /sm:mr-4 lg:mr-5/);
  assert.doesNotMatch(nav, /flex-1/);

  assert.match(header, /sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-6/);
  assert.match(header, /min-\[72rem\]:w-max min-\[72rem\]:min-w-\[72rem\] min-\[72rem\]:max-w-full/);
  assert.match(header, /data-testid="app-header-utilities"/);
  assert.match(header, /flex shrink-0 items-center gap-3/);
  assert.doesNotMatch(header, /ml-auto/);
  assert.doesNotMatch(header, /\babsolute\b|\bfixed\b|(?:^|[\s"'])-m[lr]-|(?:^|[\s"'])-left-|(?:^|[\s"'])-right-/);
  assert.match(nav, /shrink-0 rounded-lg px-3\.5 py-2 text-sm font-medium/);
  assert.equal(ru.nav.administration, "Администрирование");
  assert.equal(en.nav.administration, "Administration");
  assert.equal(ru.rejoin.rejoin, "Вернуться");
  assert.equal(en.rejoin.rejoin, "Rejoin");

  assert.match(logo, /inline-flex max-w-full shrink-0/);
  assert.match(logo, /block h-full w-auto max-w-full object-contain/);
  assert.match(logo, /wrapperClassName/);
});

test("public-site nav labels stay Сайт / Website", () => {
  assert.equal(ru.nav.publicSite, "Сайт");
  assert.equal(en.nav.publicSite, "Website");
});
