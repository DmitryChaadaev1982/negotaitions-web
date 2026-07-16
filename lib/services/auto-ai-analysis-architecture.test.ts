import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

test("speaker-mapping route does not use self-HTTP /analyze fetch", async () => {
  const routePath = join(
    root,
    "app/api/sessions/[sessionId]/speaker-mapping/route.ts",
  );
  const source = await readFile(routePath, "utf8");

  assert.equal(source.includes("/api/sessions/${sessionId}/analyze"), false);
  assert.equal(source.includes("fetch("), false);
});

test("both mapping and enhancement flows call shared auto trigger helper", async () => {
  const mappingRoutePath = join(
    root,
    "app/api/sessions/[sessionId]/speaker-mapping/route.ts",
  );
  const enhancementOrchestrationPath = join(
    root,
    "lib/services/transcript-enhancement-orchestration.ts",
  );

  const mappingSource = await readFile(mappingRoutePath, "utf8");
  const enhancementSource = await readFile(enhancementOrchestrationPath, "utf8");

  assert.equal(
    mappingSource.includes("maybeRequestAutomaticAiAnalysis"),
    true,
  );
  assert.equal(
    enhancementSource.includes("maybeRequestAutomaticAiAnalysis"),
    true,
  );
});
