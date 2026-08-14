import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/facilitator-room-controls.tsx", "utf8");

test("early finish confirmation is a local UI gate for canonical actions", () => {
  assert.match(
    source,
    /if \(action === "STOP_PREPARATION" \|\| action === "FINISH"\) \{\s+setPendingFinishAction\(action\);\s+return;/,
  );
  assert.match(
    source,
    /const handleFinishConfirm = useCallback\(\(\) => \{[\s\S]*?void runAction\(action\);/,
  );
  assert.match(
    source,
    /const handleFinishCancel = useCallback\(\(\) => \{\s+if \(!actionInFlightRef\.current\) \{\s+setPendingFinishAction\(null\);/,
  );
  const confirmationHandlers = source.slice(
    source.indexOf("const handleFinishConfirm"),
    source.indexOf("const { negotiationState }"),
  );
  assert.doesNotMatch(confirmationHandlers, /"PAUSE|"RESUME/);
});

test("only phase-ending controls use the shared destructive button treatment", () => {
  assert.match(
    source,
    /<DangerButton\s+type="button"\s+data-testid="stop-preparation-button"/,
  );
  assert.match(
    source,
    /<DangerButton\s+type="button"\s+data-testid="finish-negotiation-button"/,
  );
  assert.doesNotMatch(
    source,
    /data-testid="pause-preparation-button"[\s\S]{0,250}<DangerButton/,
  );
  assert.doesNotMatch(
    source,
    /data-testid="pause-negotiation-button"[\s\S]{0,250}<DangerButton/,
  );
});
