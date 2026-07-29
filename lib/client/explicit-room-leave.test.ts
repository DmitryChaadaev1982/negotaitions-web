import assert from "node:assert/strict";
import test from "node:test";

import { persistExplicitRoomLeave } from "@/lib/client/explicit-room-leave";

test("persists explicit leave when API disconnects current connection", async () => {
  const result = await persistExplicitRoomLeave({
    sessionId: "session-1",
    body: { participantId: "participant-1", connectionId: "conn-1" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          disconnected: true,
          alreadyFinalized: false,
          roomClosed: false,
          finalState: "DISCONNECTED",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.disconnected, true);
  assert.equal(result.finalState, "DISCONNECTED");
});

test("treats superseded/already-finalized leave as persisted idempotent result", async () => {
  const result = await persistExplicitRoomLeave({
    sessionId: "session-1",
    body: { participantId: "participant-1", connectionId: "conn-old" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          disconnected: false,
          alreadyFinalized: true,
          roomClosed: false,
          finalState: "SUPERSEDED",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alreadyFinalized, true);
  assert.equal(result.finalState, "SUPERSEDED");
});

test("fails when API returns alreadyFinalized but connection is still ACTIVE", async () => {
  const result = await persistExplicitRoomLeave({
    sessionId: "session-1",
    body: { participantId: "participant-1", connectionId: "conn-1" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          disconnected: false,
          alreadyFinalized: true,
          roomClosed: false,
          finalState: "ACTIVE",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_persisted");
  assert.equal(result.finalState, "ACTIVE");
});

test("returns stale_connection outcome for 409 stale lease response", async () => {
  const result = await persistExplicitRoomLeave({
    sessionId: "session-1",
    body: { participantId: "participant-1", connectionId: "conn-1" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: "STALE_CONNECTION",
          error: "Connection lease is stale.",
          finalState: "SUPERSEDED",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "stale_connection");
  assert.equal(result.finalState, "SUPERSEDED");
});

test("times out with bounded wait when leave endpoint hangs", async () => {
  const startedAt = Date.now();
  const result = await persistExplicitRoomLeave({
    sessionId: "session-1",
    body: { participantId: "participant-1", connectionId: "conn-1" },
    timeoutMs: 30,
    fetchImpl: async () =>
      new Promise<Response>(() => {
        // Intentionally unresolved.
      }),
  });

  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "timeout");
  assert.ok(elapsedMs >= 20, `expected bounded timeout, got ${elapsedMs}ms`);
});
