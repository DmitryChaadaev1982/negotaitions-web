import assert from "node:assert/strict";
import test from "node:test";

import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";

const segments = [
  {
    speakerLabel: "speaker_0",
    displaySpeakerLabel: "Speaker 1",
    startSeconds: 0,
    endSeconds: 5,
    text: "Мы готовы обсуждать условия.",
    orderIndex: 0,
  },
  {
    speakerLabel: "speaker_1",
    displaySpeakerLabel: "Speaker 2",
    startSeconds: 5.3,
    endSeconds: 11,
    text: "Для нас главным вопросом являются сроки.",
    orderIndex: 1,
  },
];

const participants = [
  { id: "buyer", displayName: "Lab Buyer", type: "PARTICIPANT", roleName: "Buyer" },
  { id: "seller", displayName: "Lab Seller", type: "PARTICIPANT", roleName: "Seller" },
];

test("canonical diarizedText uses lexical text plus mapped participant names", () => {
  const text = buildCanonicalDiarizedText({
    segments,
    speakerMapping: { speaker_0: "buyer", speaker_1: "seller" },
    participants,
  });

  assert.match(text, /Lab Buyer \/ Buyer/);
  assert.match(text, /Lab Seller \/ Seller/);
  assert.match(text, /Мы готовы обсуждать условия/);
  assert.match(text, /Для нас главным вопросом являются сроки/);
});

test("enhancement-style lexical rewrite keeps mapped names", () => {
  const enhanced = segments.map((segment) => ({
    ...segment,
    text: `${segment.text} (уточнено)`,
  }));
  const text = buildCanonicalDiarizedText({
    segments: enhanced,
    speakerMapping: { speaker_0: "buyer", speaker_1: "seller" },
    participants,
  });

  assert.match(text, /Lab Buyer \/ Buyer/);
  assert.match(text, /\(уточнено\)/);
  assert.doesNotMatch(text, /Speaker 1/);
});

test("mapping rewrite does not change lexical segment text", () => {
  const before = buildCanonicalDiarizedText({
    segments,
    speakerMapping: null,
    participants,
  });
  const after = buildCanonicalDiarizedText({
    segments,
    speakerMapping: { speaker_0: "buyer", speaker_1: "seller" },
    participants,
  });

  assert.match(before, /Мы готовы обсуждать условия/);
  assert.match(after, /Мы готовы обсуждать условия/);
  assert.match(before, /Speaker 1/);
  assert.match(after, /Lab Buyer \/ Buyer/);
});
