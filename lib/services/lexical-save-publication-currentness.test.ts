import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import {
  buildTranscriptEnhancementPublication,
  decideLexicalSavePublicationMode,
  mergeTranscriptEnhancementPublication,
  parseTranscriptEnhancementPublication,
  planLexicalSaveSegments,
  processingMetadataAfterLexicalSave,
  resolveQualityTextAfterLexicalSave,
} from "@/lib/services/transcript-enhancement-publication";

const published = buildTranscriptEnhancementPublication({
  runId: "run-a",
  retranscribeCount: 3,
  inputIdentity: "identity-a",
  publishedAt: "2026-09-17T00:00:00.000Z",
  segments: [
    { orderIndex: 0, publishedText: "enhanced 0", originalText: "raw 0" },
    { orderIndex: 1, publishedText: "enhanced 1", originalText: "raw 1" },
    { orderIndex: 2, publishedText: "copy", originalText: "copy" },
  ],
});

const jobMetadata = {
  transcriptEnhancement: {
    schemaVersion: "d1-v1",
    executionStatus: "COMPLETED",
    publicationEligible: false,
    terminalQuality: "COMPLETED",
    publicationOutcome: "published",
    runId: "run-a",
    inputIdentity: "identity-a",
    retranscribeCount: 3,
  },
  providerHistory: [{ attempt: 1, status: "COMPLETED" }],
};

const existingABC = [
  { id: "seg-a", qualityText: "raw A" },
  { id: "seg-b", qualityText: "raw B" },
  { id: "seg-c", qualityText: "raw C" },
];

function qualityForPlan(
  existing: ReadonlyArray<{ id: string; qualityText: string | null }>,
  submittedIds: ReadonlyArray<string | null>,
) {
  const plan = planLexicalSaveSegments({
    existingSegments: existing,
    submittedSegmentIds: submittedIds,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    throw new Error("expected a successful identity plan");
  }
  const previousById = new Map(existing.map((segment) => [segment.id, segment]));
  return {
    plan,
    qualityTexts: plan.operations.map((operation) => {
      if (operation.type === "create") {
        return resolveQualityTextAfterLexicalSave({ matchedExistingSegment: false });
      }
      return resolveQualityTextAfterLexicalSave({
        matchedExistingSegment: true,
        previousQualityText: previousById.get(operation.id)?.qualityText ?? null,
      });
    }),
  };
}

test("same-structure lexical save preserves publication identity and job history", () => {
  const mode = decideLexicalSavePublicationMode({
    previousSegmentIds: ["seg-a", "seg-b", "seg-c"],
    submittedSegmentIds: ["seg-a", "seg-b", "seg-c"],
  });
  assert.equal(mode, "preserve");
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode,
  });
  const publication = parseTranscriptEnhancementPublication(next);
  const job = parseTranscriptEnhancementJob(next);
  assert.equal(publication?.runId, "run-a");
  assert.equal(publication?.inputIdentity, "identity-a");
  assert.deepEqual(publication?.segmentDigestByOrderIndex, published.segmentDigestByOrderIndex);
  assert.equal(job.executionStatus, "COMPLETED");
  assert.equal(job.publicationOutcome, "published");
  assert.deepEqual(next.providerHistory, jobMetadata.providerHistory);
});

test("P7 same-structure save does not rewrite publication.runId or drop unrelated digests", () => {
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: "preserve",
  });
  const publication = parseTranscriptEnhancementPublication(next);
  assert.equal(publication?.runId, "run-a");
  assert.equal(publication?.segmentDigestByOrderIndex["0"], published.segmentDigestByOrderIndex["0"]);
  assert.equal(publication?.segmentDigestByOrderIndex["1"], published.segmentDigestByOrderIndex["1"]);
});

test("UX01-01 A existing SpeechKit segment keeps qualityText across a lexical edit", () => {
  const { plan, qualityTexts } = qualityForPlan(
    [{ id: "seg-a", qualityText: "raw A" }],
    ["seg-a"],
  );
  assert.equal(plan.publicationMode, "preserve");
  assert.equal(plan.operations[0]?.type, "update");
  assert.equal(qualityTexts[0], "raw A");
  assert.equal(
    resolveQualityTextAfterLexicalSave({
      matchedExistingSegment: true,
      previousQualityText: "raw A",
    }),
    "raw A",
  );
});

test("UX01-01 B speaker-only identity keeps qualityText and publication evidence", () => {
  const { plan, qualityTexts } = qualityForPlan(existingABC, ["seg-a", "seg-b", "seg-c"]);
  assert.equal(plan.publicationMode, "preserve");
  assert.deepEqual(qualityTexts, ["raw A", "raw B", "raw C"]);
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: plan.publicationMode,
  });
  assert.deepEqual(parseTranscriptEnhancementPublication(next)?.segmentDigestByOrderIndex, published.segmentDigestByOrderIndex);
  assert.equal(parseTranscriptEnhancementJob(next).executionStatus, "COMPLETED");
});

test("UX01-01 C new manual segment does not receive fake SpeechKit qualityText", () => {
  const { plan, qualityTexts } = qualityForPlan(existingABC, ["seg-a", "seg-b", null]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  assert.equal(plan.operations[2]?.type, "create");
  assert.equal(qualityTexts[2], null);
  assert.equal(
    resolveQualityTextAfterLexicalSave({
      matchedExistingSegment: false,
      previousQualityText: "manual C",
    }),
    null,
  );
});

test("UX01-01 D reorder retains each existing raw baseline by stable id", () => {
  const { plan, qualityTexts } = qualityForPlan(existingABC, ["seg-c", "seg-a", "seg-b"]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  assert.deepEqual(
    plan.operations.map((operation) => (operation.type === "update" ? operation.id : null)),
    ["seg-c", "seg-a", "seg-b"],
  );
  assert.deepEqual(qualityTexts, ["raw C", "raw A", "raw B"]);
  assert.deepEqual(plan.deleteIds, []);
});

test("S1 exact same stable sequence keeps publication evidence applicable", () => {
  const { plan } = qualityForPlan(existingABC, ["seg-a", "seg-b", "seg-c"]);
  assert.equal(plan.publicationMode, "preserve");
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: plan.publicationMode,
  });
  assert.deepEqual(parseTranscriptEnhancementPublication(next)?.segmentDigestByOrderIndex, published.segmentDigestByOrderIndex);
});

test("S2 reorder remaps published digests by stable id", () => {
  const { plan } = qualityForPlan(existingABC, ["seg-b", "seg-a", "seg-c"]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: plan.publicationMode,
    retainedSegments: plan.ok ? plan.retainedSegments : [],
  });
  const remapped = parseTranscriptEnhancementPublication(next);
  assert.equal(remapped?.runId, "run-a");
  assert.equal(remapped?.segmentDigestByOrderIndex["0"], published.segmentDigestByOrderIndex["1"]);
  assert.equal(remapped?.segmentDigestByOrderIndex["1"], published.segmentDigestByOrderIndex["0"]);
  assert.equal(remapped?.segmentDigestByOrderIndex["2"], undefined);
  assert.deepEqual(next.providerHistory, jobMetadata.providerHistory);
  assert.equal(parseTranscriptEnhancementJob(next).runId, "run-a");
});

test("S3 delete does not let a later segment inherit the deleted digest", () => {
  const { plan } = qualityForPlan(existingABC, ["seg-a", "seg-c"]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  assert.deepEqual(plan.deleteIds, ["seg-b"]);
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: plan.publicationMode,
    retainedSegments: plan.ok ? plan.retainedSegments : [],
  });
  const remapped = parseTranscriptEnhancementPublication(next);
  assert.equal(remapped?.runId, "run-a");
  assert.equal(remapped?.segmentDigestByOrderIndex["0"], published.segmentDigestByOrderIndex["0"]);
  assert.notEqual(remapped?.segmentDigestByOrderIndex["1"], published.segmentDigestByOrderIndex["1"]);
  assert.equal(remapped?.segmentDigestByOrderIndex["1"], undefined);
});

test("S4 insert does not inherit the prior digest at that orderIndex", () => {
  const { plan, qualityTexts } = qualityForPlan(existingABC, ["seg-a", null, "seg-b", "seg-c"]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  assert.equal(plan.operations[1]?.type, "create");
  assert.equal(qualityTexts[1], null);
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: plan.publicationMode,
    retainedSegments: plan.ok ? plan.retainedSegments : [],
  });
  const remapped = parseTranscriptEnhancementPublication(next);
  assert.equal(remapped?.runId, "run-a");
  assert.equal(remapped?.segmentDigestByOrderIndex["0"], published.segmentDigestByOrderIndex["0"]);
  assert.equal(remapped?.segmentDigestByOrderIndex["1"], undefined);
  assert.equal(remapped?.segmentDigestByOrderIndex["2"], published.segmentDigestByOrderIndex["1"]);
});

test("S5 same-count delete+insert is not treated as preserve", () => {
  const { plan, qualityTexts } = qualityForPlan(existingABC, ["seg-a", null, "seg-c"]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  assert.deepEqual(plan.deleteIds, ["seg-b"]);
  assert.equal(plan.operations[1]?.type, "create");
  assert.equal(qualityTexts[1], null);
});

test("S6 duplicate submitted segment ID fails closed", () => {
  const plan = planLexicalSaveSegments({
    existingSegments: existingABC,
    submittedSegmentIds: ["seg-a", "seg-a", "seg-c"],
  });
  assert.deepEqual(plan, { ok: false, reason: "duplicate_segment_id" });
});

test("S7 unknown segment ID fails closed", () => {
  const plan = planLexicalSaveSegments({
    existingSegments: existingABC,
    submittedSegmentIds: ["seg-a", "seg-other", "seg-c"],
  });
  assert.deepEqual(plan, { ok: false, reason: "unknown_segment_id" });
});

test("omitted empty/whitespace existing segment is still same-structure preserve", () => {
  const existing = [
    { id: "seg-a", text: "enhanced one", orderIndex: 0 },
    { id: "seg-ws", text: "   ", orderIndex: 1 },
    { id: "seg-c", text: "raw three", orderIndex: 2 },
  ];
  const plan = planLexicalSaveSegments({
    existingSegments: existing,
    submittedSegmentIds: ["seg-a", "seg-c"],
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    throw new Error("expected a successful identity plan");
  }
  assert.equal(plan.publicationMode, "preserve");
  assert.deepEqual(plan.deleteIds, []);
  assert.deepEqual(
    plan.operations.map((operation) =>
      operation.type === "update" ? { id: operation.id, orderIndex: operation.orderIndex } : operation,
    ),
    [
      { id: "seg-a", orderIndex: 0 },
      { id: "seg-c", orderIndex: 2 },
    ],
  );
  const next = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: plan.publicationMode,
    retainedSegments: plan.retainedSegments,
  });
  assert.deepEqual(
    parseTranscriptEnhancementPublication(next)?.segmentDigestByOrderIndex,
    published.segmentDigestByOrderIndex,
  );
});

test("S8 missing stable identity is not count-only preserve", () => {
  const { plan, qualityTexts } = qualityForPlan(existingABC, [null, null, null]);
  assert.equal(plan.publicationMode, "invalidate_structure");
  assert.deepEqual(
    plan.operations.map((operation) => operation.type),
    ["create", "create", "create"],
  );
  assert.deepEqual(plan.deleteIds, ["seg-a", "seg-b", "seg-c"]);
  assert.deepEqual(qualityTexts, [null, null, null]);
  assert.equal(
    decideLexicalSavePublicationMode({
      previousSegmentIds: ["seg-a", "seg-b", "seg-c"],
      submittedSegmentIds: [null, null, null],
    }),
    "invalidate_structure",
  );
});

test("structural rewrite remaps remaining publication evidence and keeps job history", () => {
  assert.equal(
    decideLexicalSavePublicationMode({
      previousSegmentIds: ["seg-a", "seg-b", "seg-c"],
      submittedSegmentIds: ["seg-a", "seg-b"],
    }),
    "invalidate_structure",
  );
  const remapped = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication(jobMetadata, published),
    mode: "invalidate_structure",
    retainedSegments: [
      { id: "seg-a", previousOrderIndex: 0, nextOrderIndex: 0 },
      { id: "seg-b", previousOrderIndex: 1, nextOrderIndex: 1 },
    ],
  });
  const publication = parseTranscriptEnhancementPublication(remapped);
  assert.equal(publication?.runId, "run-a");
  assert.equal(publication?.segmentDigestByOrderIndex["0"], published.segmentDigestByOrderIndex["0"]);
  assert.equal(publication?.segmentDigestByOrderIndex["1"], published.segmentDigestByOrderIndex["1"]);
  assert.deepEqual(remapped.providerHistory, jobMetadata.providerHistory);
  assert.equal(parseTranscriptEnhancementJob(remapped).executionStatus, "COMPLETED");
  assert.equal(parseTranscriptEnhancementJob(remapped).runId, "run-a");
});

test("attribution route preserves publication on same-structure saves and does not drop digests", () => {
  const source = readFileSync(
    "app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts",
    "utf8",
  );
  assert.match(source, /planLexicalSaveSegments/);
  assert.match(source, /processingMetadataAfterLexicalSave/);
  assert.match(source, /LexicalSaveIdentityError/);
  assert.doesNotMatch(source, /dropMismatchedPublicationDigests/);
  assert.match(source, /retainedSegments: plan.retainedSegments/);
  assert.match(source, /processingMetadata,/);
  assert.match(source, /matchedExistingSegment: false/);
  assert.match(source, /orderIndex: true/);
  assert.match(source, /text: true/);
  assert.doesNotMatch(source, /previousByOrderIndex/);
});

test("mapping-owned save path does not rewrite publication provenance", () => {
  const mapping = readFileSync("lib/transcription/mapping-persistence.ts", "utf8");
  assert.doesNotMatch(mapping, /dropMismatchedPublicationDigests/);
  assert.doesNotMatch(mapping, /invalidatePublicationAfterBroadLexicalRewrite/);
  assert.match(mapping, /Does not write/);
  assert.doesNotMatch(mapping, /qualityText/);
});
