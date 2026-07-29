import assert from "node:assert/strict";
import test from "node:test";

import {
  getRoomClosureRedirectFromConflict,
  isStaleConnectionResponse,
} from "@/lib/client/stale-connection";

function makeConflict(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
}

test("detects stale-connection conflict payloads", async () => {
  assert.equal(
    await isStaleConnectionResponse(
      makeConflict({ code: "STALE_CONNECTION", redirectTo: "/room/x?stale=1" }),
    ),
    true,
  );
  assert.equal(
    await isStaleConnectionResponse(makeConflict({ error: "staleConnection" })),
    true,
  );
});

test("keeps room/event closure redirects distinct from stale conflicts", async () => {
  const roomClosed = makeConflict({
    code: "ROOM_CLOSED",
    redirectTo: "/sessions/s1/materials",
  });

  assert.equal(await isStaleConnectionResponse(roomClosed), false);
  assert.equal(
    await getRoomClosureRedirectFromConflict(roomClosed),
    "/sessions/s1/materials",
  );
});
