import assert from "node:assert/strict";
import test from "node:test";

import { buildActiveAudioFilterGraph } from "@/lib/transcription/active-audio-builder";

test("buildActiveAudioFilterGraph builds concat pipeline for active intervals", () => {
  const graph = buildActiveAudioFilterGraph([
    {
      partIndex: 0,
      realStartMs: 0,
      realEndMs: 20_000,
      activeStartMs: 0,
      activeEndMs: 20_000,
      durationMs: 20_000,
    },
    {
      partIndex: 1,
      realStartMs: 30_000,
      realEndMs: 70_000,
      activeStartMs: 20_000,
      activeEndMs: 60_000,
      durationMs: 40_000,
    },
  ]);

  assert.equal(graph.concatLabel, "active_out");
  assert.equal(graph.filterChain.length, 3);
  assert.ok(graph.filterChain[0]?.includes("atrim=start=0.000000:end=20.000000"));
  assert.ok(graph.filterChain[1]?.includes("atrim=start=30.000000:end=70.000000"));
  assert.ok(graph.filterChain[2]?.includes("concat=n=2:v=0:a=1[active_out]"));
});
