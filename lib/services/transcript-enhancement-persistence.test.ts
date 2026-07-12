import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSegmentEnhancementUpdates,
  MODE_SWITCH_REVERTS_PERSISTED_TEXT,
  resolveEnhancementOriginalText,
  shouldPersistEnhancedText,
  type PersistableTranscriptSegment,
} from "@/lib/services/transcript-enhancement-persistence";

function makeSegments(): PersistableTranscriptSegment[] {
  return [
    {
      id: "seg-1",
      orderIndex: 0,
      text: "Отлично, все берусь, заворачивайте.",
      qualityText: null,
    },
    {
      id: "seg-2",
      orderIndex: 1,
      text: "артериальной гниле",
      qualityText: null,
    },
  ];
}

test("original segment text remains recoverable after COMPLETED enhancement", () => {
  assert.equal(shouldPersistEnhancedText("COMPLETED"), true);
  const segments = makeSegments();
  const updates = buildSegmentEnhancementUpdates(
    segments,
    new Map<number, string>([
      [0, "Отлично, всё беру. Заворачивайте."],
      [1, "артериальной гниле"],
    ]),
  );

  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.text, "Отлично, всё беру. Заворачивайте.");
  assert.equal(updates[0]?.qualityText, "Отлично, все берусь, заворачивайте.");
  assert.equal(updates[1]?.text, "артериальной гниле");
  assert.equal(updates[1]?.qualityText, "артериальной гниле");
});

test("original segment text remains recoverable after PARTIAL enhancement", () => {
  assert.equal(shouldPersistEnhancedText("PARTIAL"), true);
  const segments = makeSegments();
  const updates = buildSegmentEnhancementUpdates(
    segments,
    new Map<number, string>([
      [0, "Отлично, всё беру. Заворачивайте."],
      [1, "артериальной гниле"],
    ]),
  );

  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.qualityText, "Отлично, все берусь, заворачивайте.");
  assert.equal(updates[1]?.qualityText, "артериальной гниле");
});

test("FAILED enhancement does not request canonical text mutation", () => {
  assert.equal(shouldPersistEnhancedText("FAILED"), false);
  assert.equal(shouldPersistEnhancedText("SKIPPED"), false);
});

test("existing qualityText backup is preserved on re-enhancement", () => {
  const segments: PersistableTranscriptSegment[] = [
    {
      id: "seg-1",
      orderIndex: 0,
      text: "уже улучшенный текст",
      qualityText: "исходный провайдерный текст",
    },
  ];
  const updates = buildSegmentEnhancementUpdates(
    segments,
    new Map<number, string>([[0, "повторно улучшенный текст"]]),
  );
  assert.equal(updates[0]?.qualityText, "исходный провайдерный текст");
  assert.equal(updates[0]?.text, "повторно улучшенный текст");
});

test("mode switch does not claim rollback of already persisted text", () => {
  assert.equal(MODE_SWITCH_REVERTS_PERSISTED_TEXT, false);
});

test("repeated enhancement input uses preserved provider qualityText when present", () => {
  assert.equal(
    resolveEnhancementOriginalText({
      qualityText: "исходный провайдерный текст",
      text: "ранее улучшенный текст",
    }),
    "исходный провайдерный текст",
  );
});

test("enhancement input falls back to text when qualityText is null", () => {
  assert.equal(
    resolveEnhancementOriginalText({
      qualityText: null,
      text: "текущий текст сегмента",
    }),
    "текущий текст сегмента",
  );
});
