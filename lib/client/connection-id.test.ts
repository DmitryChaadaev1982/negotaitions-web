import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { generateClientConnectionId } from "@/lib/client/connection-id";

test("client connection id generator returns unique values", () => {
  const first = generateClientConnectionId("room-session-a");
  const second = generateClientConnectionId("room-session-a");

  assert.notEqual(first, second);
  assert.match(first, /^room-session-a-/);
  assert.match(second, /^room-session-a-/);
});

test("room and lobby connection id sources no longer use useId", () => {
  const roomSource = readFileSync("components/voximplant-negotiation-room-page.tsx", "utf-8");
  const lobbySource = readFileSync("components/event-lobby-view.tsx", "utf-8");
  const liveKitRoomSource = readFileSync("components/video-room-page.tsx", "utf-8");

  assert.equal(roomSource.includes("useId("), false);
  assert.equal(lobbySource.includes("useId("), false);
  assert.equal(liveKitRoomSource.includes("useId("), false);
});
