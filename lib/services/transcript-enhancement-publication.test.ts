import assert from "node:assert/strict";
import test from "node:test";

import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import {
  buildTranscriptEnhancementPublication,
  digestPublishedSegmentText,
  dropMismatchedPublicationDigests,
  invalidatePublicationAfterBroadLexicalRewrite,
  mergeTranscriptEnhancementPublication,
  parseTranscriptEnhancementPublication,
  preserveTranscriptEnhancementPublication,
  shouldRecordPublishedSegmentDigest,
} from "@/lib/services/transcript-enhancement-publication";

const publishedA = buildTranscriptEnhancementPublication({
  runId: "run-a",
  retranscribeCount: 4,
  inputIdentity: "identity-a",
  publishedAt: "2026-01-01T00:00:00.000Z",
  segments: [
    { orderIndex: 0, publishedText: "enhanced 0", originalText: "raw 0" },
    { orderIndex: 1, publishedText: "unchanged", originalText: "unchanged" },
  ],
});

test("publication records digests only for AI-changed segments", () => {
  assert.equal(
    publishedA.segmentDigestByOrderIndex["0"],
    digestPublishedSegmentText("enhanced 0"),
  );
  assert.equal(publishedA.segmentDigestByOrderIndex["1"], undefined);
  assert.equal(
    shouldRecordPublishedSegmentDigest({
      publishedText: "unchanged",
      originalText: "unchanged",
    }),
    false,
  );
});

test("publication records a digest for no-raw copy-through", () => {
  const publication = buildTranscriptEnhancementPublication({
    runId: "run-manual",
    retranscribeCount: 1,
    inputIdentity: "identity-manual",
    publishedAt: "2026-01-01T00:00:00.000Z",
    segments: [{ orderIndex: 0, publishedText: "manual text", originalText: null }],
  });
  assert.equal(
    shouldRecordPublishedSegmentDigest({
      publishedText: "manual text",
      originalText: null,
    }),
    true,
  );
  assert.equal(
    publication.segmentDigestByOrderIndex["0"],
    digestPublishedSegmentText("manual text"),
  );
});

test("Repeat Improve preserve keeps existing publication sibling", () => {
  const metadata = mergeTranscriptEnhancementPublication(
    {
      transcriptEnhancement: {
        executionStatus: "RUNNING",
        publicationEligible: true,
        runId: "run-b",
      },
      mappingSuggestion: { reason: "keep" },
    },
    publishedA,
  );
  const preserved = preserveTranscriptEnhancementPublication({
    metadata,
    job: parseTranscriptEnhancementJob(metadata),
    retranscribeCount: 4,
    segments: [
      { orderIndex: 0, text: "enhanced 0", qualityText: "raw 0" },
      { orderIndex: 1, text: "unchanged", qualityText: "unchanged" },
    ],
  });
  assert.deepEqual(parseTranscriptEnhancementPublication(preserved), publishedA);
  assert.deepEqual(preserved.mappingSuggestion, { reason: "keep" });
});

test("historical COMPLETED without publication namespace is snapshotted on Repeat", () => {
  const metadata = {
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      publicationOutcome: "published",
      runId: "run-a",
      inputIdentity: "identity-a",
      finishedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const preserved = preserveTranscriptEnhancementPublication({
    metadata,
    job: parseTranscriptEnhancementJob(metadata),
    retranscribeCount: 4,
    publishedAt: "2026-01-01T00:00:00.000Z",
    segments: [
      { orderIndex: 0, text: "enhanced 0", qualityText: "raw 0" },
      { orderIndex: 1, text: "unchanged", qualityText: "unchanged" },
    ],
  });
  assert.deepEqual(parseTranscriptEnhancementPublication(preserved), publishedA);
});

test("historical COMPLETED snapshot records a digest for no-raw published text", () => {
  const metadata = {
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      publicationOutcome: "published",
      runId: "run-manual",
      inputIdentity: "identity-manual",
      finishedAt: "2026-01-01T00:00:00.000Z",
    },
  };
  const preserved = preserveTranscriptEnhancementPublication({
    metadata,
    job: parseTranscriptEnhancementJob(metadata),
    retranscribeCount: 1,
    publishedAt: "2026-01-01T00:00:00.000Z",
    segments: [{ orderIndex: 0, text: "manual text", qualityText: null }],
  });
  const publication = parseTranscriptEnhancementPublication(preserved);
  assert.equal(publication?.runId, "run-manual");
  assert.equal(
    publication?.segmentDigestByOrderIndex["0"],
    digestPublishedSegmentText("manual text"),
  );
});

test("first Improve Skip does not mint publication provenance", () => {
  const metadata = {
    transcriptEnhancement: {
      executionStatus: "CANCELLED_FOR_PUBLICATION",
      publicationEligible: false,
      publicationOutcome: "cancelled_continue",
      runId: "run-first",
    },
  };
  const preserved = preserveTranscriptEnhancementPublication({
    metadata,
    job: parseTranscriptEnhancementJob(metadata),
    retranscribeCount: 0,
    segments: [{ orderIndex: 0, text: "raw", qualityText: "raw" }],
  });
  assert.equal(parseTranscriptEnhancementPublication(preserved), null);
});

test("human lexical edit drops only the edited segment digest", () => {
  const metadata = mergeTranscriptEnhancementPublication({}, publishedA);
  const next = dropMismatchedPublicationDigests({
    metadata,
    currentRetranscribeCount: 4,
    segments: [
      { orderIndex: 0, text: "human edited" },
      { orderIndex: 1, text: "unchanged" },
    ],
  });
  const publication = parseTranscriptEnhancementPublication(next);
  assert.equal(publication?.runId, "run-a");
  assert.equal(publication?.segmentDigestByOrderIndex["0"], undefined);
});

test("broad lexical rewrite clears publication identity", () => {
  const cleared = invalidatePublicationAfterBroadLexicalRewrite(
    mergeTranscriptEnhancementPublication({ mappingSuggestion: { keep: true } }, publishedA),
  );
  assert.equal(parseTranscriptEnhancementPublication(cleared), null);
  assert.deepEqual(cleared.mappingSuggestion, { keep: true });
});
