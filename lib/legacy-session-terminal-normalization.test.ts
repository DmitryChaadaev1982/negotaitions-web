import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NegotiationState,
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";
import {
  assertLegacyTerminalExpectedCounts,
  classifyLegacyTerminalCandidate,
  LEGACY_TERMINAL_REPAIR_FIELDS,
  parseLegacyTerminalNormalizationCli,
  type LegacyTerminalCandidateInput,
} from "@/lib/legacy-session-terminal-normalization";

const normalizationScriptSource = readFileSync(
  new URL(
    "../scripts/ops/normalize-legacy-session-terminal-state.ts",
    import.meta.url,
  ),
  "utf8",
);

function candidate(
  overrides: Partial<LegacyTerminalCandidateInput> = {},
): LegacyTerminalCandidateInput {
  return {
    negotiationState: NegotiationState.FINISHED,
    roomLifecycle: RoomLifecycle.CLOSED,
    status: SessionStatus.READY,
    negotiationEndedAt: new Date("2026-07-01T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

test("classifies authoritative CLOSED rows with stale coarse status", () => {
  for (const status of [SessionStatus.READY, SessionStatus.DRAFT]) {
    assert.equal(
      classifyLegacyTerminalCandidate(candidate({ status })),
      "CATEGORY_A_CLOSED_STALE_STATUS",
    );
  }
});

test("classifies only unambiguous FINISHED legacy null rows", () => {
  assert.equal(
    classifyLegacyTerminalCandidate(
      candidate({
        roomLifecycle: null,
        status: SessionStatus.READY,
      }),
    ),
    "CATEGORY_B_FINISHED_NULL_LIFECYCLE",
  );
  assert.equal(
    classifyLegacyTerminalCandidate(
      candidate({
        roomLifecycle: null,
        negotiationEndedAt: null,
      }),
    ),
    null,
  );
});

test("never classifies Debrief, deleted, or nonterminal sessions", () => {
  for (const input of [
    candidate({ roomLifecycle: RoomLifecycle.DEBRIEF_OPEN }),
    candidate({ deletedAt: new Date("2026-08-13T10:00:00.000Z") }),
    candidate({
      negotiationState: NegotiationState.RUNNING,
      roomLifecycle: null,
    }),
    candidate({
      status: SessionStatus.COMPLETED,
      roomLifecycle: RoomLifecycle.CLOSED,
    }),
  ]) {
    assert.equal(classifyLegacyTerminalCandidate(input), null);
  }
});

test("CLI defaults to dry-run and apply requires both expected counts", () => {
  assert.deepEqual(parseLegacyTerminalNormalizationCli([]), {
    apply: false,
    expectedCategoryA: null,
    expectedCategoryB: null,
    sampleLimit: 25,
  });
  assert.throws(
    () => parseLegacyTerminalNormalizationCli(["--apply"]),
    /requires --expected-category-a and --expected-category-b/,
  );
  assert.deepEqual(
    parseLegacyTerminalNormalizationCli([
      "--apply",
      "--expected-category-a",
      "17",
      "--expected-category-b",
      "56",
      "--sample-limit",
      "10",
    ]),
    {
      apply: true,
      expectedCategoryA: 17,
      expectedCategoryB: 56,
      sampleLimit: 10,
    },
  );
});

test("apply count fence rejects population drift", () => {
  assert.doesNotThrow(() =>
    assertLegacyTerminalExpectedCounts({
      actualCategoryA: 17,
      actualCategoryB: 56,
      expectedCategoryA: 17,
      expectedCategoryB: 56,
    }),
  );
  assert.throws(
    () =>
      assertLegacyTerminalExpectedCounts({
        actualCategoryA: 18,
        actualCategoryB: 56,
        expectedCategoryA: 17,
        expectedCategoryB: 56,
      }),
    /Candidate count mismatch/,
  );
});

test("normalization repair contract writes only the required terminal fields", () => {
  assert.deepEqual(LEGACY_TERMINAL_REPAIR_FIELDS, {
    categoryA: ["status"],
    categoryB: ["status", "roomLifecycle"],
  });
  assert.equal(
    [...normalizationScriptSource.matchAll(/SET "status"\s*=/g)].length,
    2,
  );
  assert.equal(
    [...normalizationScriptSource.matchAll(/,\s*"roomLifecycle"\s*=/g)].length,
    1,
  );
  assert.doesNotMatch(normalizationScriptSource, /"endedAt"\s*=/);
  assert.doesNotMatch(normalizationScriptSource, /"updatedAt"\s*=/);
});
