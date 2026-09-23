import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AccountSettingsView } from "@/components/account-settings-view";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { I18nProvider } from "@/lib/i18n/useI18n";

const ROOT = process.cwd();

function renderSettings(locale: "ru" | "en") {
  return renderToStaticMarkup(
    // React 19 types require children on the props object for this component.
    // eslint-disable-next-line react/no-children-prop
    createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(AccountSettingsView, {
        email: "settings@example.com",
        currentName: "Settings User",
        currentLocale: "en",
      }),
    }),
  );
}

test("account settings heading follows the selected UI locale", () => {
  const page = readFileSync(
    join(ROOT, "app/(app)/account/settings/page.tsx"),
    "utf8",
  );
  assert.equal(page.includes("getServerDictionary"), false);
  assert.equal(page.includes("getServerLocale"), false);

  const ruMarkup = renderSettings("ru");
  assert.match(ruMarkup, new RegExp(ru.auth.accountSettings));
  assert.equal(ruMarkup.includes(en.auth.accountSettings), false);
  assert.match(ruMarkup, /settings@example.com/);

  const enMarkup = renderSettings("en");
  assert.match(enMarkup, new RegExp(en.auth.accountSettings));
  assert.equal(enMarkup.includes(ru.auth.accountSettings), false);
});
