import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_LOCALE, detectBrowserLocale } from "@/lib/i18n/config";

test("default locale for a new visitor without a language signal is ru", () => {
  assert.equal(DEFAULT_LOCALE, "ru");
  assert.equal(detectBrowserLocale(undefined), "ru");
  assert.equal(detectBrowserLocale(null), "ru");
  assert.equal(detectBrowserLocale(""), "ru");
  assert.equal(detectBrowserLocale("de-DE,fr;q=0.8"), "ru");
});

test("Accept-Language ru and en tags are honoured in listed order", () => {
  assert.equal(detectBrowserLocale("ru"), "ru");
  assert.equal(detectBrowserLocale("ru-RU,en;q=0.8"), "ru");
  assert.equal(detectBrowserLocale("en-US,en;q=0.9"), "en");
  assert.equal(detectBrowserLocale("en"), "en");
  assert.equal(detectBrowserLocale("de,en;q=0.9"), "en");
});
