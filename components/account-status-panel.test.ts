import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AccountStatusPanel } from "@/components/account-status-panel";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { I18nProvider } from "@/lib/i18n/useI18n";

const ROOT = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function renderPanel(locale: "ru" | "en") {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      { initialLocale: locale },
      createElement(AccountStatusPanel, {
        variant: "pending",
        email: "pending@example.com",
        name: "Pending User",
      }),
    ),
  );
}

test("pending approval RU copy does not fall back to English", () => {
  const markup = renderPanel("ru");
  assert.match(markup, new RegExp(ru.auth.pendingTitle));
  assert.match(markup, new RegExp(ru.auth.pendingMessage));
  assert.match(markup, new RegExp(ru.auth.pendingStatusLabel));
  assert.equal(markup.includes(en.auth.pendingTitle), false);
  assert.equal(markup.includes(en.auth.pendingMessage), false);
  assert.equal(markup.includes(en.auth.pendingStatusLabel), false);
  assert.equal(markup.includes("Name"), false);
  assert.equal(markup.includes(">Status<"), false);
});

test("pending approval EN copy uses the English dictionary", () => {
  const markup = renderPanel("en");
  assert.match(markup, new RegExp(en.auth.pendingTitle));
  assert.match(markup, new RegExp(en.auth.pendingMessage));
  assert.match(markup, new RegExp(en.auth.pendingStatusLabel));
  assert.equal(markup.includes(ru.auth.pendingTitle), false);
  assert.equal(markup.includes(ru.auth.pendingMessage), false);
});

test("status pages do not render a second site header", () => {
  const pages = [
    "app/(auth)/pending-approval/page.tsx",
    "app/(auth)/account/rejected/page.tsx",
    "app/(auth)/account/blocked/page.tsx",
  ];
  for (const page of pages) {
    const source = read(page);
    assert.equal(source.includes("BrandLogo"), false, page);
    assert.equal(source.includes("<header"), false, page);
    assert.equal(source.includes("StatusPageNav"), false, page);
  }

  const layout = read("app/(auth)/layout.tsx");
  assert.equal(layout.match(/<header\b/g)?.length, 1);
  const panel = renderPanel("ru");
  assert.equal(panel.includes("<header"), false);
  assert.equal(panel.includes("BrandLogo"), false);
  assert.equal(panel.includes("Переговор"), false);
});

test("rejected and blocked status copy follows the selected locale", () => {
  for (const variant of ["rejected", "blocked"] as const) {
    const ruMarkup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: "ru" },
        createElement(AccountStatusPanel, {
          variant,
          email: "status@example.com",
        }),
      ),
    );
    const enMarkup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: "en" },
        createElement(AccountStatusPanel, {
          variant,
          email: "status@example.com",
        }),
      ),
    );
    const title = variant === "rejected" ? "rejectedTitle" : "blockedTitle";
    const message = variant === "rejected" ? "rejectedMessage" : "blockedMessage";
    assert.match(ruMarkup, new RegExp(ru.auth[title]));
    assert.match(ruMarkup, new RegExp(ru.auth[message]));
    assert.equal(ruMarkup.includes(en.auth[title]), false);
    assert.match(enMarkup, new RegExp(en.auth[title]));
    assert.equal(enMarkup.includes(ru.auth[title]), false);
  }
});
