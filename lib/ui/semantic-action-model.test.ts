import assert from "node:assert/strict";
import test from "node:test";

import {
  getSemanticActionPresentation,
  semanticKindForEventSessionAction,
} from "@/lib/ui/semantic-action-model";

test("event session action kinds map to UI-only semantic categories", () => {
  assert.equal(semanticKindForEventSessionAction("OPEN_ROOM"), "PRIMARY_PROGRESS");
  assert.equal(semanticKindForEventSessionAction("RETURN_TO_DEBRIEF"), "RETURN_TO_ACTIVE");
  assert.equal(semanticKindForEventSessionAction("OPEN_MATERIALS"), "REVIEW_RESULTS");
  assert.equal(semanticKindForEventSessionAction("OPEN_RESULTS"), "REVIEW_RESULTS");
});

test("semantic presentations preserve category and choose visual variants", () => {
  assert.deepEqual(getSemanticActionPresentation("PRIMARY_PROGRESS"), {
    kind: "PRIMARY_PROGRESS",
    visualVariant: "primary",
    size: "default",
  });
  assert.deepEqual(getSemanticActionPresentation("REVIEW_RESULTS", "compact"), {
    kind: "REVIEW_RESULTS",
    visualVariant: "review",
    size: "compact",
  });
  assert.deepEqual(getSemanticActionPresentation("DESTRUCTIVE"), {
    kind: "DESTRUCTIVE",
    visualVariant: "destructive",
    size: "default",
  });
});
