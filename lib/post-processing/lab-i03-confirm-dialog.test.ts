import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

function readLabSpec() {
  return readFileSync(join(ROOT, "tests/e2e/post-transcription-lab.spec.ts"), "utf8");
}

function readMaterialSaveUi() {
  return readFileSync(join(ROOT, "components/recording-transcription-section.tsx"), "utf8");
}

function readI03Block(lab: string) {
  const start = lab.indexOf('if (scenarioId === "I03")');
  const end = lab.indexOf('if (scenarioId === "I04")');
  assert.ok(start >= 0 && end > start, "I03 Lab block must exist before I04");
  return lab.slice(start, end);
}

test("Lab I03 waits on application ConfirmDialog, not a native browser dialog", () => {
  const lab = readLabSpec();
  assert.doesNotMatch(lab, /waitForEvent\(\s*["']dialog["']\s*\)/);
  assert.doesNotMatch(lab, /warningDialog\.accept\(/);
  assert.match(lab, /material-change-confirm-dialog/);
  assert.match(lab, /CHECKPOINT D \/ I03-B \/ MATERIAL CHANGE WARNING/);
  assert.match(lab, /same application dialog/);
});

test("Lab I03 requires the same ConfirmDialog after Inspector resume", () => {
  const i03 = readI03Block(readLabSpec());
  const afterI03B = i03.slice(i03.indexOf('substep: "I03-B"'));
  assert.doesNotMatch(afterI03B, /alreadyRewound/);
  assert.match(
    afterI03B,
    /ConfirmDialog disappeared during Inspector pause[\s\S]*will not treat an already-rewound AI as success/,
  );
  assert.match(afterI03B, /await expect\(warningDialog\)\.toBeVisible\(\);/);
  assert.match(afterI03B, /await materialChangeConfirmButton\(page\)\.click\(\);/);
  assert.match(afterI03B, /await expect\(warningDialog\)\.toHaveCount\(0\);/);
});

test("material save shows ConfirmDialog before the confirmed rewind POST", () => {
  const source = readMaterialSaveUi();
  assert.match(source, /testId="material-change-confirm-dialog"/);
  assert.match(source, /requestMaterialChangeConfirmation/);
  assert.match(source, /if \(!confirmed\) \{\s*return;/);
  assert.match(source, /confirmRewindPublication: true/);
  assert.doesNotMatch(source, /window\.confirm/);
});
