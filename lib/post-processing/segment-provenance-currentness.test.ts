import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  countSegmentEnhancementProvenance,
  resolveSegmentEnhancementProvenance,
} from "@/lib/post-processing/enhancement-ux-presentation";
import { buildTranscriptEnhancementPublication, digestPublishedSegmentText } from "@/lib/services/transcript-enhancement-publication";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";

const MIXED_PUBLICATION = buildTranscriptEnhancementPublication({
  runId: "run-mixed",
  retranscribeCount: 2,
  inputIdentity: "identity-mixed",
  publishedAt: "2026-09-17T00:00:00.000Z",
  segments: [
    { orderIndex: 0, publishedText: "enhanced opening", originalText: "raw opening" },
    { orderIndex: 1, publishedText: "enhanced middle", originalText: "raw middle" },
    { orderIndex: 2, publishedText: "copy through", originalText: "copy through" },
    { orderIndex: 3, publishedText: "enhanced close", originalText: "raw close" },
  ],
});

const MIXED_SEGMENTS = [
  { orderIndex: 0, text: "enhanced opening", rawText: "raw opening" },
  { orderIndex: 1, text: "enhanced middle", rawText: "raw middle" },
  { orderIndex: 2, text: "copy through", rawText: "copy through" },
  { orderIndex: 3, text: "enhanced close", rawText: "raw close" },
];

function provenanceAt(
  orderIndex: number,
  text: string,
  rawText: string,
): ReturnType<typeof resolveSegmentEnhancementProvenance> {
  return resolveSegmentEnhancementProvenance({
    publication: MIXED_PUBLICATION,
    currentRetranscribeCount: 2,
    orderIndex,
    publishedText: text,
    rawText,
  });
}

test("P1 mixed published provenance keeps enhanced green and copy-through gray", () => {
  const counts = countSegmentEnhancementProvenance({
    publication: MIXED_PUBLICATION,
    currentRetranscribeCount: 2,
    segments: MIXED_SEGMENTS,
  });
  assert.equal(counts.total, 4);
  assert.equal(counts.applied, 3);
  assert.equal(counts.raw, 1);
  assert.equal(counts.edited, 0);
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
  assert.equal(provenanceAt(2, "copy through", "copy through"), "raw");
});

test("P2 editing one enhanced segment is edited and leaves unrelated provenance", () => {
  assert.equal(provenanceAt(1, "facilitator rewrite of middle", "raw middle"), "edited");
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
  assert.equal(provenanceAt(2, "copy through", "copy through"), "raw");
  assert.equal(provenanceAt(3, "enhanced close", "raw close"), "applied");
});

test("P3 editing one raw copy-through segment is edited and leaves unrelated provenance", () => {
  assert.equal(provenanceAt(2, "custom copy-through", "copy through"), "edited");
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
  assert.equal(provenanceAt(1, "enhanced middle", "raw middle"), "applied");
});

test("P4 editing an enhanced segment back to raw is gray", () => {
  assert.equal(provenanceAt(0, "raw opening", "raw opening"), "raw");
  assert.equal(provenanceAt(1, "enhanced middle", "raw middle"), "applied");
});

test("P5 editing back to the last published enhanced text is green again", () => {
  assert.equal(MIXED_PUBLICATION.segmentDigestByOrderIndex["0"] != null, true);
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
});

test("P6 speaker-only identity does not change lexical provenance", () => {
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
  assert.equal(provenanceAt(2, "copy through", "copy through"), "raw");
});

test("UX01-03 generation mismatch with current!=raw is edited, not forced raw", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: MIXED_PUBLICATION,
      currentRetranscribeCount: 9,
      orderIndex: 0,
      publishedText: "manual",
      rawText: "raw",
    }),
    "edited",
  );
});

test("UX01-03 generation mismatch with current==raw stays raw", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: MIXED_PUBLICATION,
      currentRetranscribeCount: 9,
      orderIndex: 0,
      publishedText: "raw",
      rawText: "raw",
    }),
    "raw",
  );
});

test("UX01-03 current generation matching published enhanced stays applied", () => {
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
});

test("UX01-03 current generation differing from raw and published is edited", () => {
  assert.equal(provenanceAt(0, "facilitator rewrite", "raw opening"), "edited");
});

test("raw to manual is edited and leaves unrelated provenance", () => {
  assert.equal(provenanceAt(2, "manual copy", "copy through"), "edited");
  assert.equal(provenanceAt(0, "enhanced opening", "raw opening"), "applied");
  assert.equal(provenanceAt(3, "enhanced close", "raw close"), "applied");
});

test("new manual segment without raw baseline is edited, not claimed raw", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: MIXED_PUBLICATION,
      currentRetranscribeCount: 2,
      orderIndex: 4,
      publishedText: "brand new manual turn",
      rawText: null,
    }),
    "edited",
  );
});

test("no-raw copy-through with a publication digest is applied, not raw", () => {
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-manual-copy",
    retranscribeCount: 2,
    inputIdentity: "identity-manual-copy",
    publishedAt: "2026-09-17T00:00:00.000Z",
    segments: [{ orderIndex: 4, publishedText: "manual copy through", originalText: null }],
  });
  assert.equal(publication.segmentDigestByOrderIndex["4"] != null, true);
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 2,
      orderIndex: 4,
      publishedText: "manual copy through",
      rawText: null,
    }),
    "applied",
  );
});

test("read-time digest uses the same algorithm as publication-time", () => {
  assert.equal(
    digestPublishedSegmentText("enhanced opening"),
    MIXED_PUBLICATION.segmentDigestByOrderIndex["0"],
  );
  assert.equal(
    digestPublishedSegmentText("enhanced opening"),
    digestPublishedSegmentText("enhanced opening"),
  );
  assert.notEqual(
    digestPublishedSegmentText("enhanced opening"),
    digestPublishedSegmentText("enhanced opening "),
  );
  assert.equal(
    digestPublishedSegmentText("цена — 日本語 🤝"),
    digestPublishedSegmentText("цена — 日本語 🤝"),
  );
  assert.equal(digestPublishedSegmentText(""), digestPublishedSegmentText(""));
  assert.equal(provenanceAt(2, "copy through", "copy through"), "raw");
});

test("manual/edited presentation uses a distinct copy key from green and gray", () => {
  assert.equal(en.sessionMaterials.enhancementTurnEdited, "Manually edited");
  assert.equal(ru.sessionMaterials.enhancementTurnEdited, "Отредактировано вручную");
  assert.notEqual(en.sessionMaterials.enhancementTurnEdited, en.sessionMaterials.enhancementTurnApplied);
  assert.notEqual(en.sessionMaterials.enhancementTurnEdited, en.sessionMaterials.enhancementTurnRaw);
  const section = readFileSync("components/recording-transcription-section.tsx", "utf8");
  assert.match(section, /enhancementTurnEdited/);
  assert.match(section, /data-provenance=\{provenance\}/);
});
