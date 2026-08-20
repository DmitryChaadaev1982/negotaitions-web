import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

test("PT-16 Save transcript is the RU/EN primary transcript action", () => {
  assert.equal(ru.recording.saveTranscript, "Сохранить транскрипт");
  assert.equal(en.recording.saveTranscript, "Save transcript");
  assert.equal(ru.recording.saveMappingAction, "Сохранить сопоставление");
  assert.equal(en.recording.saveMappingAction, "Save mapping");
  assert.notEqual(ru.recording.saveTranscript, ru.recording.saveMappingAction);
  assert.notEqual(en.recording.saveTranscript, en.recording.saveMappingAction);
});

test("PT-16 mapping-only save stays a separate control", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  assert.match(source, /save-speaker-mapping-button/);
  assert.match(source, /saveTranscript/);
  assert.match(source, /GradientButton/);
});

function buttonSnippetForTestId(source: string, testId: string) {
  const marker = `data-testid="${testId}"`;
  const markerIdx = source.indexOf(marker);
  if (markerIdx < 0) {
    return null;
  }

  const gradientOpen = source.lastIndexOf("<GradientButton", markerIdx);
  const secondaryOpen = source.lastIndexOf("<SecondaryButton", markerIdx);
  const openIdx = Math.max(gradientOpen, secondaryOpen);
  if (openIdx < 0) {
    return null;
  }

  const isGradient = gradientOpen === openIdx;
  const closeTag = isGradient ? "</GradientButton>" : "</SecondaryButton>";
  const closeIdx = source.indexOf(closeTag, markerIdx);
  if (closeIdx < 0) {
    return null;
  }

  return {
    kind: isGradient ? "GradientButton" : "SecondaryButton",
    snippet: source.slice(openIdx, closeIdx + closeTag.length),
  };
}

test("PT-16 save mapping reuses the same primary GradientButton as save transcript", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );

  const transcriptSave = buttonSnippetForTestId(source, "save-transcript-button");
  const mappingSave = buttonSnippetForTestId(source, "save-speaker-mapping-button");
  const skipMapping = buttonSnippetForTestId(source, "skip-speaker-mapping-button");

  assert.equal(transcriptSave?.kind, "GradientButton");
  assert.equal(mappingSave?.kind, "GradientButton");
  assert.equal(skipMapping?.kind, "SecondaryButton");
  assert.match(mappingSave?.snippet ?? "", /recording\.saveMappingAction/);
  assert.match(skipMapping?.snippet ?? "", /recording\.skipSpeakerMappingForNow/);
  assert.equal(ru.recording.saveMappingAction, "Сохранить сопоставление");
  assert.equal(en.recording.saveMappingAction, "Save mapping");
  assert.equal(ru.recording.skipSpeakerMappingForNow, "Пропустить пока");
  assert.equal(en.recording.skipSpeakerMappingForNow, "Skip for now");
});
