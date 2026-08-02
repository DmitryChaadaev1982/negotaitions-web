import assert from "node:assert/strict";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

test("event create-session label is consistent in RU/EN", () => {
  assert.equal(ru.events.createSession, "Создать сессию");
  assert.equal(en.events.createSession, "Create Session");
});

test("createAnotherSession key is removed from RU/EN events dictionaries", () => {
  assert.equal("createAnotherSession" in ru.events, false);
  assert.equal("createAnotherSession" in en.events, false);
});
