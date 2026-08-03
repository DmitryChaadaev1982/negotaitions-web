import assert from "node:assert/strict";
import test from "node:test";

import {
  persistExplicitRoomLeave,
  type ExplicitLeaveResult,
} from "@/lib/client/explicit-room-leave";
import { runExplicitLeaveSequence } from "@/lib/client/explicit-room-leave-sequence";
import {
  SESSION_DISAPPEARANCE_EVENTS,
  SESSION_EXIT_ACTIONS,
  SESSION_EXIT_DESTINATIONS,
  resolveSessionExitDisposition,
  type SessionExitAction,
} from "@/lib/client/session-exit-navigation";

const SESSION_ID = "session-exit-1";

function leaveResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Runs the canonical exit for one destination and reports what the room told
 * the server and where it sent the user.
 */
async function exitTo(destination: string) {
  const leaveCalls: string[] = [];
  const navigations: string[] = [];
  let markedInactive = 0;
  let providerDisconnects = 0;

  const outcome = await runExplicitLeaveSequence({
    persistLeave: () =>
      persistExplicitRoomLeave({
        sessionId: SESSION_ID,
        body: { connectionId: "conn-1" },
        fetchImpl: async (input) => {
          leaveCalls.push(String(input));
          return leaveResponse({
            ok: true,
            disconnected: true,
            alreadyFinalized: false,
            finalState: "DISCONNECTED",
          });
        },
      }),
    markLocalInactive: () => {
      markedInactive += 1;
    },
    disconnectProvider: async () => {
      providerDisconnects += 1;
    },
    navigate: () => {
      navigations.push(destination);
    },
  });

  return { outcome, leaveCalls, navigations, markedInactive, providerDisconnects };
}

const INTENTIONAL_EXIT_DESTINATIONS: Record<SessionExitAction, string> = {
  "event-lobby": "/events/event-1/lobby",
  dashboard: SESSION_EXIT_DESTINATIONS.dashboard,
  "sessions-overview": SESSION_EXIT_DESTINATIONS.sessionsOverview,
  "session-materials": `/sessions/${SESSION_ID}/materials`,
  rejoin: SESSION_EXIT_DESTINATIONS.rejoin,
  "leave-room": `/sessions/${SESSION_ID}/materials`,
};

for (const action of SESSION_EXIT_ACTIONS) {
  test(`intentional exit via ${action} terminates the connection immediately`, async () => {
    const destination = INTENTIONAL_EXIT_DESTINATIONS[action];
    const result = await exitTo(destination);

    assert.equal(resolveSessionExitDisposition(action), "EXPLICIT_LEAVE");
    assert.equal(result.outcome.ok, true);
    assert.deepEqual(result.leaveCalls, [
      `/api/sessions/${SESSION_ID}/presence/leave`,
    ]);
    assert.deepEqual(result.navigations, [destination]);
    assert.equal(result.markedInactive, 1);
    assert.equal(result.providerDisconnects, 1);
  });
}

test("every intentional exit uses one leave implementation and differs only in destination", async () => {
  const lobby = await exitTo("/events/event-1/lobby");
  const dashboard = await exitTo(SESSION_EXIT_DESTINATIONS.dashboard);

  assert.deepEqual(lobby.leaveCalls, dashboard.leaveCalls);
  assert.equal(lobby.providerDisconnects, dashboard.providerDisconnects);
  assert.notDeepEqual(lobby.navigations, dashboard.navigations);
});

for (const disappearance of SESSION_DISAPPEARANCE_EVENTS) {
  test(`${disappearance} stays lease-based and never persists an explicit leave`, () => {
    assert.equal(resolveSessionExitDisposition(disappearance), "LEASE_EXPIRY");
  });
}

test("route unmount is not treated as an intentional exit", () => {
  assert.equal(resolveSessionExitDisposition("route-unmount"), "LEASE_EXPIRY");
  assert.ok(
    !(SESSION_EXIT_ACTIONS as readonly string[]).includes("route-unmount"),
    "attaching explicit leave to unmount would turn a refresh into a departure",
  );
});

test("a duplicate leave for an already finalized connection stays successful", async () => {
  const result: ExplicitLeaveResult = await persistExplicitRoomLeave({
    sessionId: SESSION_ID,
    body: { connectionId: "conn-1" },
    fetchImpl: async () =>
      leaveResponse({
        ok: true,
        disconnected: false,
        alreadyFinalized: true,
        finalState: "DISCONNECTED",
      }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.alreadyFinalized, true);
  assert.equal(result.ok && result.disconnected, false);
});

test("navigation does not wait for provider teardown", async () => {
  const order: string[] = [];
  let releaseProvider: (() => void) | null = null;
  const providerSettled = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });

  const sequence = runExplicitLeaveSequence({
    persistLeave: () =>
      persistExplicitRoomLeave({
        sessionId: SESSION_ID,
        body: { connectionId: "conn-1" },
        fetchImpl: async () =>
          leaveResponse({
            ok: true,
            disconnected: true,
            alreadyFinalized: false,
            finalState: "DISCONNECTED",
          }),
      }),
    markLocalInactive: () => order.push("marked-inactive"),
    disconnectProvider: async () => {
      order.push("provider-teardown-started");
      await providerSettled;
      order.push("provider-teardown-finished");
    },
    navigate: () => order.push("navigated"),
  });

  // The navigation must already have happened while teardown is still pending.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, [
    "marked-inactive",
    "navigated",
    "provider-teardown-started",
  ]);

  releaseProvider!();
  await sequence;
  assert.equal(order.at(-1), "provider-teardown-finished");
});

test("a failed leave keeps the user in the room instead of navigating", async () => {
  const navigations: string[] = [];
  const outcome = await runExplicitLeaveSequence({
    persistLeave: () =>
      persistExplicitRoomLeave({
        sessionId: SESSION_ID,
        body: { connectionId: "conn-1" },
        fetchImpl: async () =>
          leaveResponse({ error: "stale", code: "STALE_CONNECTION" }, 409),
      }),
    markLocalInactive: () => {},
    disconnectProvider: async () => {},
    navigate: () => navigations.push("/dashboard"),
  });

  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.leave.reason, "stale_connection");
  assert.deepEqual(navigations, []);
});
