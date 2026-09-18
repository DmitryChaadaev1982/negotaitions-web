import assert from "node:assert/strict";
import test from "node:test";

import { createAllBenchWorkloads, createBenchWorkload } from "./workloads";

test("S/M/L/XL workloads are deterministic and not mechanical repeats", () => {
  const first = createAllBenchWorkloads();
  const second = createAllBenchWorkloads();
  for (const id of ["S", "M", "L", "XL"] as const) {
    assert.equal(first[id].charCount, second[id].charCount);
    assert.deepEqual(
      first[id].segments.map((segment) => segment.originalText),
      second[id].segments.map((segment) => segment.originalText),
    );
    const unique = new Set(first[id].segments.map((segment) => segment.originalText));
    assert.ok(unique.size >= Math.min(8, first[id].segmentCount));
    const speakers = new Set(first[id].segments.map((segment) => segment.speakerLabel));
    assert.ok(speakers.size >= 2);
  }
  assert.ok(first.L.segmentCount >= 70);
  assert.ok(first.L.charCount >= 9000);
  assert.ok(first.XL.segmentCount >= 200);
  assert.ok(first.XL.charCount >= 25000);
  assert.ok(first.S.charCount < first.M.charCount);
  assert.ok(first.M.charCount < first.L.charCount);
});

test("L is the BUG02-shaped class and XL stays hour-scale", () => {
  const large = createBenchWorkload("L");
  const xl = createBenchWorkload("XL");
  assert.ok(large.segmentCount >= 72 && large.segmentCount <= 90);
  assert.ok(xl.charCount > large.charCount * 2);
  assert.ok(xl.segments.some((segment) => segment.originalText.includes("?")));
  assert.ok(xl.segments.some((segment) => /\d/.test(segment.originalText)));
});
