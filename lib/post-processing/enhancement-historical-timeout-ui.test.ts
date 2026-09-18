import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  resolveEnhancementUxState,
  shouldShowDurableEnhancementProgress,
} from "@/lib/post-processing/enhancement-ux-presentation";

test("historical SKIPPED/timeout remains renderable without fake durable progress", async () => {
  const historical = {
    uiStatus: "SKIPPED",
    skipReason: "timeout",
    publicationEligible: false,
    progress: { completedChunks: 0, totalChunks: 0 },
  };
  assert.equal(resolveEnhancementUxState(historical), "ENHANCEMENT_HISTORICAL_TIMEOUT");
  assert.equal(shouldShowDurableEnhancementProgress(historical), false);

  const section = await readFile(
    path.join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  assert.match(section, /enhancement-historical-timeout/);
  assert.match(panel, /enhancement\?\.status === "SKIPPED"/);
  assert.match(panel, /canStartTranscriptEnhancement/);
});
