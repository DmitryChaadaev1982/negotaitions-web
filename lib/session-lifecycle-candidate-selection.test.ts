import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NegotiationState,
  RoomLifecycle,
} from "@/app/generated/prisma/client";
import {
  DEFAULT_SESSION_ABANDONED_CLOSE_MS,
  DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
  DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS,
} from "@/lib/config/session-lifecycle-settings";
import { buildSessionLifecycleCandidateSelectionPlan } from "@/lib/session-lifecycle-candidate-selection";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const DURATIONS = {
  debriefEmptyCloseMs: DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
  debriefMaxDurationMs: DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS,
  abandonedCloseMs: DEFAULT_SESSION_ABANDONED_CLOSE_MS,
};

test("candidate plan excludes occupied/not-due rows from the empty and abandoned pages", () => {
  const plan = buildSessionLifecycleCandidateSelectionPlan({
    now: NOW,
    limit: 1,
    durations: DURATIONS,
  });

  assert.equal(plan.take, 1);
  assert.deepEqual(plan.debriefEmptyWhere.roomLifecycle, RoomLifecycle.DEBRIEF_OPEN);
  assert.ok(plan.debriefEmptyWhere.roomConnections);
  assert.ok(plan.abandonedWhere.AND);
  const abandonedAnd = plan.abandonedWhere.AND;
  assert.ok(Array.isArray(abandonedAnd));
  assert.ok(
    abandonedAnd.some((clause) => clause && "roomConnections" in clause),
    "abandoned page must skip currently occupied Sessions",
  );
  assert.equal(
    "roomConnections" in plan.debriefMaxWhere,
    false,
    "max-duration Debrief remains selectable while occupied",
  );
});

test("C1 selector strategy prefers later due work over a leading occupied/not-due row", () => {
  const plan = buildSessionLifecycleCandidateSelectionPlan({
    now: NOW,
    limit: 1,
    durations: DURATIONS,
  });
  const emptyCutoff = plan.emptyCutoff.getTime();
  const occupiedNotDueEndedAt = NOW.getTime() - 10_000;
  const laterDueEndedAt = NOW.getTime() - DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS - 1_000;

  assert.ok(
    occupiedNotDueEndedAt > emptyCutoff,
    "leading occupied/not-due Session is outside the empty-close candidate page",
  );
  assert.ok(
    laterDueEndedAt <= emptyCutoff,
    "later empty-due Session remains inside the bounded candidate page",
  );
});

test("C2 successive pages use a stable oldest-first bound rather than a sticky occupied prefix", () => {
  const plan = buildSessionLifecycleCandidateSelectionPlan({
    now: NOW,
    limit: 2,
    durations: DURATIONS,
  });
  assert.deepEqual(plan.orderBy, [{ updatedAt: "asc" }, { id: "asc" }]);
  assert.equal(plan.take, 2);
});

test("C3 candidate plan excludes terminal-parent and Event-closed children from automatic pages", () => {
  const plan = buildSessionLifecycleCandidateSelectionPlan({
    now: NOW,
    limit: 1,
    durations: DURATIONS,
  });

  assert.equal(plan.debriefEmptyWhere.closedByEventAt, null);
  assert.equal(plan.debriefMaxWhere.closedByEventAt, null);
  assert.equal(plan.abandonedWhere.closedByEventAt, null);

  for (const where of [plan.debriefEmptyWhere, plan.debriefMaxWhere]) {
    assert.ok(Array.isArray(where.OR));
    assert.ok(
      where.OR?.some((clause) => clause && "eventId" in clause && clause.eventId === null),
      "standalone Sessions must remain selectable",
    );
    assert.ok(
      where.OR?.some((clause) => clause && "event" in clause),
      "only operable parent Events remain selectable",
    );
  }
});

test("selector reuses shared current-generation departure SQL instead of a second clock", () => {
  const selector = readFileSync(
    "lib/session-lifecycle-candidate-selection.ts",
    "utf8",
  );
  const sql = readFileSync("lib/session-lifecycle-sql.ts", "utf8");
  assert.match(selector, /sqlDebriefEmptyReferenceAt/);
  assert.match(selector, /sqlAbandonedReferenceAt/);
  assert.match(selector, /sqlParentEventStillOperableGuard/);
  assert.match(sql, /sqlLastCurrentGenerationDepartureSubquery/);
  assert.equal(selector.includes("disconnectedReason"), false);
});

test("operable Sessions cannot have NULL negotiationState; selector need not include it", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const baseline = readFileSync(
    "prisma/migrations/20260627_production_initial_baseline/migration.sql",
    "utf8",
  );
  const standaloneCreate = readFileSync("app/actions/sessions.ts", "utf8");
  const eventCreate = readFileSync("lib/create-event-session.ts", "utf8");

  assert.match(
    schema,
    /negotiationState\s+NegotiationState\s+@default\(PREPARATION\)/,
  );
  assert.match(
    baseline,
    /"negotiationState" "NegotiationState" NOT NULL DEFAULT 'PREPARATION'/,
  );
  assert.equal(standaloneCreate.includes("negotiationState: null"), false);
  assert.equal(eventCreate.includes("negotiationState: null"), false);
  assert.equal(NegotiationState.PREPARATION, "PREPARATION");

  const plan = buildSessionLifecycleCandidateSelectionPlan({
    now: NOW,
    limit: 1,
    durations: DURATIONS,
  });
  const abandonedOr = plan.abandonedWhere.OR;
  assert.ok(Array.isArray(abandonedOr));
  for (const clause of abandonedOr) {
    assert.deepEqual(clause?.negotiationState, {
      not: NegotiationState.FINISHED,
    });
  }
});
