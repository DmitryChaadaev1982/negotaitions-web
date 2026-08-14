import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getObjectPictogramPath,
  getObjectPictogramThemePaths,
} from "@/lib/object-pictograms";

function assertPublicAssetExists(assetPath: string) {
  const absolute = path.join(process.cwd(), "public", assetPath.replace(/^\//, ""));
  assert.equal(
    existsSync(absolute),
    true,
    `Expected asset file to exist: ${absolute}`,
  );
}

test("maps object semantic types to approved light assets", () => {
  assert.equal(
    getObjectPictogramPath({
      objectType: "event",
      theme: "light",
      requestedSize: 40,
    }),
    "/icons/objects/light/event-48.png",
  );
  assert.equal(
    getObjectPictogramPath({
      objectType: "room",
      theme: "light",
      requestedSize: 24,
    }),
    "/icons/objects/light/room-32.png",
  );
  assert.equal(
    getObjectPictogramPath({
      objectType: "case",
      theme: "light",
      requestedSize: 60,
    }),
    "/icons/objects/light/case-64.png",
  );
});

test("returns both light and dark sources for theme-aware rendering", () => {
  const sources = getObjectPictogramThemePaths({
    objectType: "event",
    requestedSize: 32,
  });
  assert.deepEqual(sources, {
    light: "/icons/objects/light/event-32.png",
    dark: "/icons/objects/dark/event-32.png",
  });
});

test("resolved object pictogram assets exist in public runtime path", () => {
  for (const objectType of ["event", "room", "case"] as const) {
    const sources = getObjectPictogramThemePaths({
      objectType,
      requestedSize: 48,
    });
    assertPublicAssetExists(sources.light);
    assertPublicAssetExists(sources.dark);
  }
});
