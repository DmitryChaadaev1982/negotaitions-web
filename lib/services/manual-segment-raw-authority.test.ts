import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveSegmentEnhancementProvenance } from "@/lib/post-processing/enhancement-ux-presentation";
import {
  buildSegmentEnhancementUpdates,
  resolveEnhancementOriginalText,
  resolveInitialQualityText,
  resolvePersistedEnhancementQualityText,
} from "@/lib/services/transcript-enhancement-persistence";
import {
  buildTranscriptEnhancementPublication,
  dropMismatchedPublicationDigests,
  parseTranscriptEnhancementPublication,
  resolveQualityTextAfterLexicalSave,
} from "@/lib/services/transcript-enhancement-publication";

const MANUAL_TEXT = "manual facilitator turn";
const ENHANCED_TEXT = "enhanced facilitator turn";
const COPY_THROUGH_TEXT = "manual copy through";

test("MRAW-01 new manual segment inserted: qualityText = null", () => {
  assert.equal(
    resolveQualityTextAfterLexicalSave({ matchedExistingSegment: false }),
    null,
  );
  assert.equal(
    resolveQualityTextAfterLexicalSave({
      matchedExistingSegment: false,
      previousQualityText: MANUAL_TEXT,
    }),
    null,
  );
  assert.equal(resolvePersistedEnhancementQualityText({ qualityText: null }), null);
});

test("MRAW-02 manual segment enters enhancement: provider input uses current text", () => {
  assert.equal(
    resolveEnhancementOriginalText({
      qualityText: null,
      text: MANUAL_TEXT,
    }),
    MANUAL_TEXT,
  );
});

test("MRAW-03 after successful enhancement: qualityText remains null", () => {
  const updates = buildSegmentEnhancementUpdates(
    [{ id: "seg-manual", orderIndex: 0, text: MANUAL_TEXT, qualityText: null }],
    new Map<number, string>([[0, ENHANCED_TEXT]]),
  );
  assert.equal(updates[0]?.text, ENHANCED_TEXT);
  assert.equal(updates[0]?.qualityText, null);
});

test("MRAW-04 enhanced text differs from manual input: published digest applies, qualityText remains null", () => {
  const updates = buildSegmentEnhancementUpdates(
    [{ id: "seg-manual", orderIndex: 0, text: MANUAL_TEXT, qualityText: null }],
    new Map<number, string>([[0, ENHANCED_TEXT]]),
  );
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-mraw-04",
    retranscribeCount: 2,
    inputIdentity: "identity-mraw-04",
    publishedAt: "2026-09-17T00:00:00.000Z",
    segments: [{ orderIndex: 0, publishedText: ENHANCED_TEXT, originalText: updates[0]?.qualityText ?? null }],
  });
  assert.equal(updates[0]?.qualityText, null);
  assert.equal(publication.segmentDigestByOrderIndex["0"] != null, true);
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 2,
      orderIndex: 0,
      publishedText: ENHANCED_TEXT,
      rawText: null,
    }),
    "applied",
  );
});

test("MRAW-05 AI copy-through: published digest may be current, qualityText remains null, not RAW", () => {
  const updates = buildSegmentEnhancementUpdates(
    [{ id: "seg-manual", orderIndex: 0, text: COPY_THROUGH_TEXT, qualityText: null }],
    new Map<number, string>([[0, COPY_THROUGH_TEXT]]),
  );
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-mraw-05",
    retranscribeCount: 2,
    inputIdentity: "identity-mraw-05",
    publishedAt: "2026-09-17T00:00:00.000Z",
    segments: [
      { orderIndex: 0, publishedText: COPY_THROUGH_TEXT, originalText: updates[0]?.qualityText ?? null },
    ],
  });
  assert.equal(updates[0]?.qualityText, null);
  assert.equal(publication.segmentDigestByOrderIndex["0"] != null, true);
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 2,
      orderIndex: 0,
      publishedText: COPY_THROUGH_TEXT,
      rawText: null,
    }),
    "applied",
  );
  assert.notEqual(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 2,
      orderIndex: 0,
      publishedText: COPY_THROUGH_TEXT,
      rawText: null,
    }),
    "raw",
  );
});

test("MRAW-06 manual edit after enhancement: mismatched current text is EDITED", () => {
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-mraw-06",
    retranscribeCount: 2,
    inputIdentity: "identity-mraw-06",
    publishedAt: "2026-09-17T00:00:00.000Z",
    segments: [{ orderIndex: 0, publishedText: ENHANCED_TEXT, originalText: null }],
  });
  const afterEdit = dropMismatchedPublicationDigests({
    metadata: { transcriptEnhancementPublication: publication },
    currentRetranscribeCount: 2,
    segments: [{ orderIndex: 0, text: "facilitator rewrite" }],
  });
  const nextPublication = parseTranscriptEnhancementPublication(afterEdit);
  assert.equal(nextPublication?.segmentDigestByOrderIndex["0"], undefined);
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 2,
      orderIndex: 0,
      publishedText: "facilitator rewrite",
      rawText: null,
    }),
    "edited",
  );
});

test("MRAW-07 Repeat Improve: qualityText remains null through the second enhancement", () => {
  const afterFirst = buildSegmentEnhancementUpdates(
    [{ id: "seg-manual", orderIndex: 0, text: MANUAL_TEXT, qualityText: null }],
    new Map<number, string>([[0, ENHANCED_TEXT]]),
  );
  assert.equal(afterFirst[0]?.qualityText, null);
  const afterSecond = buildSegmentEnhancementUpdates(
    [
      {
        id: "seg-manual",
        orderIndex: 0,
        text: afterFirst[0]?.text ?? ENHANCED_TEXT,
        qualityText: afterFirst[0]?.qualityText ?? null,
      },
    ],
    new Map<number, string>([[0, "second enhance"]]),
  );
  assert.equal(afterSecond[0]?.text, "second enhance");
  assert.equal(afterSecond[0]?.qualityText, null);
  assert.equal(
    resolveEnhancementOriginalText({
      qualityText: afterFirst[0]?.qualityText ?? null,
      text: afterFirst[0]?.text ?? ENHANCED_TEXT,
    }),
    ENHANCED_TEXT,
  );
});

test("MRAW-08 ordinary SpeechKit-derived segment: qualityText remains non-null immutable raw", () => {
  const raw = "speechkit raw";
  const updates = buildSegmentEnhancementUpdates(
    [{ id: "seg-asr", orderIndex: 0, text: "already enhanced", qualityText: raw }],
    new Map<number, string>([[0, "repeat enhanced"]]),
  );
  assert.equal(updates[0]?.text, "repeat enhanced");
  assert.equal(updates[0]?.qualityText, raw);
  const copyThrough = buildSegmentEnhancementUpdates(
    [{ id: "seg-asr", orderIndex: 0, text: raw, qualityText: raw }],
    new Map<number, string>([[0, raw]]),
  );
  assert.equal(copyThrough[0]?.qualityText, raw);
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-mraw-08",
    retranscribeCount: 0,
    inputIdentity: "identity-mraw-08",
    publishedAt: "2026-09-17T00:00:00.000Z",
    segments: [{ orderIndex: 0, publishedText: raw, originalText: raw }],
  });
  assert.equal(publication.segmentDigestByOrderIndex["0"], undefined);
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 0,
      orderIndex: 0,
      publishedText: raw,
      rawText: raw,
    }),
    "raw",
  );
});

test("MRAW-09 future genuine retranscription may establish a fresh real qualityText", () => {
  const speechkitText = "new speechkit generation";
  assert.equal(resolveInitialQualityText(speechkitText, null), speechkitText);
  assert.notEqual(resolveInitialQualityText(speechkitText, null), null);
  const runner = readFileSync("lib/services/transcription-runner.ts", "utf8");
  assert.match(runner, /qualityText: resolveInitialQualityText\(segment\.text, null\)/);
  const updates = buildSegmentEnhancementUpdates(
    [{ id: "seg-new-asr", orderIndex: 0, text: speechkitText, qualityText: speechkitText }],
    new Map<number, string>([[0, "enhanced generation"]]),
  );
  assert.equal(updates[0]?.qualityText, speechkitText);
});
