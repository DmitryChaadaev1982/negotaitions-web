import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

test("recording file key is rendered with wrapping classes", () => {
  const filePath = path.resolve(
    process.cwd(),
    "components/recording-transcription-section.tsx",
  );
  const content = readFileSync(filePath, "utf8");

  assert.match(content, /whitespace-pre-wrap/);
  assert.match(content, /break-all/);
  assert.match(content, /max-w-full/);
});
