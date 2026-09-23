import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

test("auth forms do not render a second language switcher", () => {
  const forms = [
    "app/(auth)/login/page.tsx",
    "app/(auth)/register/page.tsx",
    "app/(auth)/forgot-password/page.tsx",
    "components/reset-password-form.tsx",
    "app/(auth)/pending-approval/page.tsx",
  ];
  for (const form of forms) {
    assert.equal(read(form).includes("LanguageSwitcher"), false, form);
  }

  const layoutNav = read("components/auth-layout-nav.tsx");
  assert.equal(layoutNav.match(/<LanguageSwitcher\b/g)?.length, 1);
});
