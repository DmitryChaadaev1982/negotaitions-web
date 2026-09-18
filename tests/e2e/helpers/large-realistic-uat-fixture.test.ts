import assert from "node:assert/strict";
import test from "node:test";

import {
  LARGE_REALISTIC_FIXTURE_STATS,
  LARGE_REALISTIC_RAW_TURNS,
  LARGE_REALISTIC_SEGMENTS,
  measureLargeRealisticFixture,
  validateLargeRealisticFixture,
} from "./large-realistic-uat-fixture";
import {
  HISTORICAL_PROBLEM_RAW_CHARS,
  MIN_RAW_CHARS,
  TARGET_SEGMENT_MAX,
  TARGET_SEGMENT_MIN,
} from "./large-realistic-uat-constants";

test("large realistic fixture is deterministic and in range", () => {
  const first = validateLargeRealisticFixture();
  const second = validateLargeRealisticFixture();
  assert.equal(first.ok, true, first.issues.map((issue) => issue.message).join("; "));
  assert.deepEqual(first.stats, second.stats);
  assert.equal(LARGE_REALISTIC_SEGMENTS.length, first.stats.segments);
  assert.equal(LARGE_REALISTIC_RAW_TURNS.length, first.stats.segments);
  assert.equal(LARGE_REALISTIC_FIXTURE_STATS.rawChars, first.stats.rawChars);
  assert.ok(first.stats.rawChars >= MIN_RAW_CHARS);
  assert.ok(first.stats.rawChars >= 24_000);
  assert.ok(first.stats.rawChars <= 30_000);
  assert.ok(first.stats.segments >= TARGET_SEGMENT_MIN);
  assert.ok(first.stats.segments <= TARGET_SEGMENT_MAX);
  assert.ok(first.stats.ratioVsHistorical9592 >= 2);
  assert.equal(
    Math.round((first.stats.rawChars / HISTORICAL_PROBLEM_RAW_CHARS) * 100) / 100,
    first.stats.ratioVsHistorical9592,
  );
});

test("large realistic fixture has two long same-speaker turns split into many segments", () => {
  const stats = measureLargeRealisticFixture();
  assert.notEqual(stats.longTurn1.speakerLabel, stats.longTurn2.speakerLabel);
  assert.ok(stats.longTurn1.segmentCount >= 8);
  assert.ok(stats.longTurn2.segmentCount >= 8);
  assert.ok(stats.longTurn1.durationSeconds >= 150);
  assert.ok(stats.longTurn1.durationSeconds <= 210);
  assert.ok(stats.longTurn2.durationSeconds >= 150);
  assert.ok(stats.longTurn2.durationSeconds <= 210);
  const long1Speakers = new Set(
    LARGE_REALISTIC_SEGMENTS
      .filter(
        (segment) =>
          segment.orderIndex >= stats.longTurn1.startOrderIndex &&
          segment.orderIndex <= stats.longTurn1.endOrderIndex,
      )
      .map((segment) => segment.speakerLabel),
  );
  assert.equal(long1Speakers.size, 1);
});

test("large realistic fixture is synthetic Russian BUYER/SELLER negotiation", () => {
  const joined = LARGE_REALISTIC_RAW_TURNS.map((turn) => turn.text).join("\n");
  assert.equal(LARGE_REALISTIC_FIXTURE_STATS.synthetic, true);
  assert.match(joined, /цена|брак|отгруз|оплат|гарант|штраф/i);
  assert.doesNotMatch(joined, /инн\s*\d{10}/i);
  assert.ok(LARGE_REALISTIC_RAW_TURNS.some((turn) => turn.text === turn.text.toLowerCase()));
  assert.ok(LARGE_REALISTIC_RAW_TURNS.some((turn) => /[А-ЯЁ]/.test(turn.text)));
});
