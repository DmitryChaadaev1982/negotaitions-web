import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("stale lobby connection unmounts the Vox room and drops local media controls", () => {
  const source = readFileSync("components/event-lobby-view.tsx", "utf-8");
  assert.match(source, /setStaleConnection\(true\)/);
  assert.match(source, /setLocalMediaController\(null\)/);
  assert.match(
    source,
    /staleConnection \? \(\s*<div[\s\S]*event-lobby-stale-connection-banner/,
  );
  assert.match(source, /Boolean\(localMediaController\) &&\s*!staleConnection/);
  assert.match(source, /if \(!state \|\| !localMediaController \|\| staleConnection\) return;/);
});

test("event lobby does not render temporary BUG03 diagnostic UI", () => {
  const source = readFileSync("components/event-lobby-view.tsx", "utf-8");
  assert.doesNotMatch(source, /event-lobby-browser-diag/);
  assert.doesNotMatch(source, /LobbyMountGateDiagStrip/);
  assert.doesNotMatch(source, /LobbyVoxRoomRenderBoundary/);
  assert.doesNotMatch(source, /lobby-browser-diag/);
  assert.doesNotMatch(source, /onFirstRender=/);
  assert.doesNotMatch(source, /onInnerDiagChange=/);
  assert.match(
    source,
    /videoProvider === "voximplant" &&\s*\(voxReady \|\| providerFaultSimulation !== "off"\) &&\s*lobbyConnectionId/,
  );
});

test("event lobby keeps two columns from md with a shrinking main column", () => {
  const source = readFileSync("components/event-lobby-view.tsx", "utf-8");
  assert.match(source, /data-testid="event-lobby-layout"/);
  assert.match(
    source,
    /md:grid-cols-\[minmax\(0,1fr\)_minmax\(15rem,20rem\)\]/,
  );
  assert.match(
    source,
    /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(16rem,22rem\)\]/,
  );
  assert.match(source, /min-w-0 w-full max-w-\[1600px\] flex-1 grid-cols-1/);
  assert.doesNotMatch(source, /xl:flex-row/);
  assert.doesNotMatch(source, /xl:w-\[360px\]/);
  assert.match(source, /data-testid="event-lobby-video-pane"/);
  assert.match(source, /aspect-video max-h-\[min\(22rem,46svh\)\]/);
  assert.match(source, /md:aspect-auto md:max-h-none md:flex-1/);
});
