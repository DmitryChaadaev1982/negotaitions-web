import assert from "node:assert/strict";
import test from "node:test";

import { resolveAutomaticCloseLogEmission } from "@/lib/session-lifecycle-observability";

test("periodic no-op evaluations emit no per-session log", () => {
  for (const decision of ["occupied", "not_due", "ineligible", "already_terminal"] as const) {
    assert.deepEqual(
      resolveAutomaticCloseLogEmission({
        invocation: "periodic",
        decision,
        closed: false,
      }),
      { emit: false, level: "info" },
      decision,
    );
  }
});

test("periodic closed and lost_race remain actionable", () => {
  assert.deepEqual(
    resolveAutomaticCloseLogEmission({
      invocation: "periodic",
      decision: "closed",
      closed: true,
    }),
    { emit: true, level: "info" },
  );
  assert.deepEqual(
    resolveAutomaticCloseLogEmission({
      invocation: "periodic",
      decision: "lost_race",
      closed: false,
    }),
    { emit: true, level: "warn" },
  );
});

test("direct transition callers retain bounded no-op diagnostics", () => {
  assert.deepEqual(
    resolveAutomaticCloseLogEmission({
      invocation: "transition",
      decision: "occupied",
      closed: false,
    }),
    { emit: true, level: "info" },
  );
  assert.deepEqual(
    resolveAutomaticCloseLogEmission({
      invocation: "transition",
      decision: "not_due",
      closed: false,
    }),
    { emit: true, level: "info" },
  );
});
