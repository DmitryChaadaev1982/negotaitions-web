import assert from "node:assert/strict";
import test from "node:test";

import {
  postProcessingRailTileToneClassName,
  resolvePostProcessingRailTileTone,
  resolveSpeakerMappingRailTileTone,
} from "@/lib/post-processing/rail-tile-tone";

test("rail tiles distinguish completed, active execution, and waiting", () => {
  assert.equal(resolvePostProcessingRailTileTone("ready"), "completed");
  assert.equal(resolvePostProcessingRailTileTone("COMPLETED"), "completed");
  assert.equal(resolvePostProcessingRailTileTone("running"), "active");
  assert.equal(resolvePostProcessingRailTileTone("QUEUED"), "active");
  assert.equal(resolvePostProcessingRailTileTone("in_progress"), "active");
  assert.equal(resolvePostProcessingRailTileTone("pending"), "waiting");
  assert.equal(resolvePostProcessingRailTileTone("not_started"), "waiting");
  assert.equal(resolvePostProcessingRailTileTone("waiting_for_transcript"), "waiting");

  const completed = postProcessingRailTileToneClassName("completed");
  const active = postProcessingRailTileToneClassName("active");
  const waiting = postProcessingRailTileToneClassName("waiting");
  assert.match(completed, /emerald-500/);
  assert.match(active, /cyan-/);
  assert.match(waiting, /slate-/);
  assert.notEqual(active, waiting);
  assert.notEqual(active, completed);
  assert.notEqual(waiting, completed);
});

test("completed mapping uses green rail chrome; mapping awaiting action does not", () => {
  assert.equal(resolveSpeakerMappingRailTileTone("ready"), "completed");
  assert.equal(resolveSpeakerMappingRailTileTone("informational"), "completed");
  assert.equal(resolveSpeakerMappingRailTileTone("action_required"), "action_required");
  assert.equal(resolveSpeakerMappingRailTileTone("required"), "action_required");
  assert.equal(resolveSpeakerMappingRailTileTone("pending"), "waiting");

  const completed = postProcessingRailTileToneClassName("completed");
  const awaiting = postProcessingRailTileToneClassName("action_required");
  assert.match(completed, /emerald-500/);
  assert.match(completed, /emerald-200/);
  assert.doesNotMatch(awaiting, /emerald-/);
  assert.match(awaiting, /amber-/);
  assert.notEqual(completed, awaiting);

  assert.equal(
    resolvePostProcessingRailTileTone("informational"),
    "informational",
    "enhancement skipped / other informational stages keep the advisory tone",
  );
  assert.match(postProcessingRailTileToneClassName("informational"), /sky-/);
});
