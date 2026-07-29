import assert from "node:assert/strict";
import test from "node:test";

import { resolveEventSessionPrimaryAction } from "@/lib/event-session-primary-action";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

test("active room access resolves to open-room primary action", () => {
  const action = resolveEventSessionPrimaryAction({
    roomAccessDecision: "ALLOW_ACTIVE_ROOM",
    roomHref: "/room/s1",
    materialsHref: "/materials/s1",
    redirectHref: null,
  });

  assert.deepEqual(action, {
    kind: "OPEN_ROOM",
    href: "/room/s1",
    labelKey: "events.openRoom",
  });
});

test("debrief room access resolves to return-to-debrief primary action", () => {
  const action = resolveEventSessionPrimaryAction({
    roomAccessDecision: "ALLOW_DEBRIEF",
    roomHref: "/room/s1",
    materialsHref: "/materials/s1",
    redirectHref: null,
  });

  assert.deepEqual(action, {
    kind: "RETURN_TO_DEBRIEF",
    href: "/room/s1",
    labelKey: "events.returnToDebrief",
  });
});

test("materials redirect resolves to materials primary action", () => {
  const action = resolveEventSessionPrimaryAction({
    roomAccessDecision: "REDIRECT_MATERIALS",
    roomHref: null,
    materialsHref: "/materials/s1",
    redirectHref: null,
  });

  assert.deepEqual(action, {
    kind: "OPEN_MATERIALS",
    href: "/materials/s1",
    labelKey: "events.openMaterials",
  });
});

test("event-results redirect prefers explicit redirect URL", () => {
  const action = resolveEventSessionPrimaryAction({
    roomAccessDecision: "REDIRECT_EVENT_RESULTS",
    roomHref: null,
    materialsHref: "/materials/s1",
    redirectHref: "/events/e1/lobby",
  });

  assert.deepEqual(action, {
    kind: "OPEN_RESULTS",
    href: "/events/e1/lobby",
    labelKey: "events.openResults",
  });
});

test("missing links resolves to no primary action", () => {
  const action = resolveEventSessionPrimaryAction({
    roomAccessDecision: "ALLOW_ACTIVE_ROOM",
    roomHref: null,
    materialsHref: null,
    redirectHref: null,
  });

  assert.equal(action, null);
});

test("canonical event-session primary labels stay consistent in RU/EN", () => {
  assert.equal(ru.events.openRoom, "Открыть комнату");
  assert.equal(ru.events.returnToDebrief, "Вернуться к разбору");
  assert.equal(ru.events.openMaterials, "Открыть материалы");
  assert.equal(ru.events.openResults, "Открыть результаты");

  assert.equal(en.events.openRoom, "Open room");
  assert.equal(en.events.returnToDebrief, "Return to debrief");
  assert.equal(en.events.openMaterials, "Open materials");
  assert.equal(en.events.openResults, "Open results");
});
