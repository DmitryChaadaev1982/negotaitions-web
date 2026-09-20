import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveRoleSlotPresentation } from "@/lib/voximplant/room-layout-model";

test("R24 logically present without a current endpoint is media-unavailable, not empty", () => {
  const slot = resolveRoleSlotPresentation({
    activeTile: null,
    logicallyPresentTile: { id: "participant-a", name: "Дима" },
  });
  assert.equal(slot.kind, "media_unavailable");
  assert.equal(slot.kind === "media_unavailable" ? slot.tile.id : null, "participant-a");
  assert.notEqual(slot.kind, "empty");
  assert.notEqual(slot.kind, "media");
});

test("R25 current endpoint return replaces the reconnecting placeholder with a media tile", () => {
  const reconnecting = resolveRoleSlotPresentation({
    activeTile: null,
    logicallyPresentTile: { id: "participant-a" },
  });
  assert.equal(reconnecting.kind, "media_unavailable");
  const restored = resolveRoleSlotPresentation({
    activeTile: { id: "ep-a", live: true },
    logicallyPresentTile: { id: "participant-a" },
  });
  assert.equal(restored.kind, "media");
  assert.equal(restored.kind === "media" ? restored.tile.id : null, "ep-a");
});

test("logically absent role slot remains empty", () => {
  const slot = resolveRoleSlotPresentation({
    activeTile: null,
    logicallyPresentTile: null,
  });
  assert.equal(slot.kind, "empty");
});

test("layout uses role-slot presentation instead of treating missing endpoints as empty slots", () => {
  const source = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(source, /resolveRoleSlotPresentation/);
  assert.match(source, /vox-slot-media-unavailable/);
  assert.match(source, /room\.mediaReconnecting/);
  assert.match(source, /isLogicallyPresent === true/);
});
