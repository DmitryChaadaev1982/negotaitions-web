import assert from "node:assert/strict";
import test from "node:test";

import { resolveSegmentEnhancementProvenance } from "@/lib/post-processing/enhancement-ux-presentation";
import {
  buildTranscriptEnhancementPublication,
  mergeTranscriptEnhancementPublication,
  parseTranscriptEnhancementPublication,
  planLexicalSaveSegments,
  processingMetadataAfterLexicalSave,
} from "@/lib/services/transcript-enhancement-publication";
import {
  buildInitialManualTurnsFromPersistedSegments,
  toSubmittedManualSpeakerTurns,
} from "@/lib/transcription/manual-speaker-turn-edits";

const RAW = {
  s1: "raw one",
  s2: "raw two",
  s3: "raw three",
} as const;
const ENHANCED = {
  s1: "enhanced one",
  s2: "enhanced two",
  s3: "raw three",
} as const;

const publication = buildTranscriptEnhancementPublication({
  runId: "run-final",
  retranscribeCount: 1,
  inputIdentity: "identity-final",
  publishedAt: "2026-09-18T00:00:00.000Z",
  segments: [
    { orderIndex: 0, publishedText: ENHANCED.s1, originalText: RAW.s1 },
    { orderIndex: 1, publishedText: ENHANCED.s2, originalText: RAW.s2 },
    { orderIndex: 2, publishedText: ENHANCED.s3, originalText: RAW.s3 },
  ],
});

const metadata = mergeTranscriptEnhancementPublication(
  {
    transcriptEnhancement: {
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      publicationOutcome: "published",
      runId: "run-final",
      retranscribeCount: 1,
    },
  },
  publication,
);

const existing = [
  { id: "seg-1", text: ENHANCED.s1, orderIndex: 0, qualityText: RAW.s1 },
  { id: "seg-2", text: ENHANCED.s2, orderIndex: 1, qualityText: RAW.s2 },
  { id: "seg-3", text: ENHANCED.s3, orderIndex: 2, qualityText: RAW.s3 },
];

function project(params: {
  metadata: unknown;
  segments: ReadonlyArray<{ orderIndex: number; text: string; qualityText: string | null }>;
  retranscribeCount?: number;
}) {
  const nextPublication = parseTranscriptEnhancementPublication(params.metadata);
  return params.segments.map((segment) =>
    resolveSegmentEnhancementProvenance({
      publication: nextPublication,
      currentRetranscribeCount: params.retranscribeCount ?? 1,
      orderIndex: segment.orderIndex,
      publishedText: segment.text,
      rawText: segment.qualityText,
    }),
  );
}

function applyLexicalSave(params: {
  existing: typeof existing;
  submittedIds: ReadonlyArray<string | null | undefined>;
  submittedTexts: ReadonlyArray<string>;
  metadata?: unknown;
}) {
  const plan = planLexicalSaveSegments({
    existingSegments: params.existing,
    submittedSegmentIds: params.submittedIds,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    throw new Error("expected a successful identity plan");
  }
  const nextMetadata = processingMetadataAfterLexicalSave({
    metadata: params.metadata ?? metadata,
    mode: plan.publicationMode,
    retainedSegments: plan.retainedSegments,
  });
  const byId = new Map(params.existing.map((segment) => [segment.id, { ...segment }]));
  for (const id of plan.deleteIds) {
    byId.delete(id);
  }
  for (const [index, operation] of plan.operations.entries()) {
    const nextText = params.submittedTexts[index];
    if (operation.type === "create") {
      byId.set(`new-${index}`, {
        id: `new-${index}`,
        text: nextText ?? "",
        orderIndex: operation.orderIndex,
        qualityText: null,
      });
      continue;
    }
    const current = byId.get(operation.id);
    if (!current) {
      continue;
    }
    if (nextText != null && nextText !== current.text) {
      current.text = nextText;
    }
    current.orderIndex = operation.orderIndex;
  }
  const nextSegments = [...byId.values()].sort((left, right) => left.orderIndex - right.orderIndex);
  return {
    plan,
    metadata: nextMetadata,
    segments: nextSegments,
    publication: parseTranscriptEnhancementPublication(nextMetadata),
  };
}

function applySameStructureSave(params: {
  existing: typeof existing;
  submittedIds: ReadonlyArray<string | null | undefined>;
  submittedTexts: ReadonlyArray<string>;
}) {
  return applyLexicalSave(params);
}

test("PROV-FINAL-01 edit only the second enhanced segment: green / yellow / gray", () => {
  const saved = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, "manual two", ENHANCED.s3],
  });
  assert.equal(saved.plan.publicationMode, "preserve");
  assert.deepEqual(project(saved), ["applied", "edited", "raw"]);
});

test("PROV-FINAL-02 unrelated enhanced segment text remains byte-identical after save", () => {
  const saved = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, "manual two", ENHANCED.s3],
  });
  assert.equal(saved.segments[0]?.text, ENHANCED.s1);
  assert.equal(saved.segments[0]?.text === existing[0]?.text, true);
});

test("PROV-FINAL-03 publication digest for unrelated enhanced segment remains applicable", () => {
  const saved = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, "manual two", ENHANCED.s3],
  });
  assert.equal(saved.publication?.segmentDigestByOrderIndex["0"], publication.segmentDigestByOrderIndex["0"]);
  assert.equal(
    project({
      metadata: saved.metadata,
      segments: [saved.segments[0]!],
    })[0],
    "applied",
  );
});

test("PROV-FINAL-04 edited segment retains historical published digest for comparison", () => {
  const saved = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, "manual two", ENHANCED.s3],
  });
  assert.equal(saved.publication?.segmentDigestByOrderIndex["1"], publication.segmentDigestByOrderIndex["1"]);
  assert.equal(project(saved)[1], "edited");
});

test("PROV-FINAL-05 edit yellow segment back to published enhanced text becomes green", () => {
  const afterManual = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, "manual two", ENHANCED.s3],
  });
  const editedExisting = afterManual.segments.map((segment) => ({
    id: segment.id,
    text: segment.text,
    orderIndex: segment.orderIndex,
    qualityText: segment.qualityText,
  }));
  const savedBack = applySameStructureSave({
    existing: editedExisting as typeof existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, ENHANCED.s2, ENHANCED.s3],
  });
  assert.equal(savedBack.plan.publicationMode, "preserve");
  assert.deepEqual(project(savedBack), ["applied", "applied", "raw"]);
});

test("PROV-FINAL-06 edit the same segment to raw becomes gray", () => {
  const saved = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, RAW.s2, ENHANCED.s3],
  });
  assert.deepEqual(project(saved), ["applied", "raw", "raw"]);
});

test("PROV-FINAL-07 speaker-only edit leaves all lexical provenance unchanged", () => {
  const saved = applySameStructureSave({
    existing,
    submittedIds: ["seg-1", "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, ENHANCED.s2, ENHANCED.s3],
  });
  assert.equal(saved.plan.publicationMode, "preserve");
  assert.deepEqual(project(saved), ["applied", "applied", "raw"]);
});

test("PROV-FINAL-08 insert/delete/reorder remaps by stable id and marks new turns edited", () => {
  const afterDelete = applyLexicalSave({
    existing,
    submittedIds: ["seg-1", "seg-3"],
    submittedTexts: [ENHANCED.s1, ENHANCED.s3],
  });
  assert.equal(afterDelete.plan.publicationMode, "invalidate_structure");
  assert.deepEqual(afterDelete.plan.deleteIds, ["seg-2"]);
  assert.equal(afterDelete.publication?.runId, "run-final");
  assert.equal(
    afterDelete.publication?.segmentDigestByOrderIndex["0"],
    publication.segmentDigestByOrderIndex["0"],
  );
  assert.notEqual(
    afterDelete.publication?.segmentDigestByOrderIndex["1"],
    publication.segmentDigestByOrderIndex["1"],
  );
  assert.deepEqual(project(afterDelete), ["applied", "raw"]);

  const afterInsert = applyLexicalSave({
    existing,
    submittedIds: ["seg-1", null, "seg-2", "seg-3"],
    submittedTexts: [ENHANCED.s1, "brand new turn", ENHANCED.s2, ENHANCED.s3],
  });
  assert.equal(afterInsert.plan.publicationMode, "invalidate_structure");
  assert.equal(afterInsert.publication?.segmentDigestByOrderIndex["1"], undefined);
  assert.equal(
    afterInsert.publication?.segmentDigestByOrderIndex["2"],
    publication.segmentDigestByOrderIndex["1"],
  );
  assert.deepEqual(project(afterInsert), ["applied", "edited", "applied", "raw"]);

  const afterReorder = applyLexicalSave({
    existing,
    submittedIds: ["seg-2", "seg-1", "seg-3"],
    submittedTexts: [ENHANCED.s2, ENHANCED.s1, ENHANCED.s3],
  });
  assert.equal(afterReorder.plan.publicationMode, "invalidate_structure");
  assert.equal(
    afterReorder.publication?.segmentDigestByOrderIndex["0"],
    publication.segmentDigestByOrderIndex["1"],
  );
  assert.equal(
    afterReorder.publication?.segmentDigestByOrderIndex["1"],
    publication.segmentDigestByOrderIndex["0"],
  );
  assert.deepEqual(project(afterReorder), ["applied", "applied", "raw"]);

  const afterEditAndDelete = applyLexicalSave({
    existing,
    submittedIds: ["seg-1", "seg-2"],
    submittedTexts: [ENHANCED.s1, "manual two"],
  });
  assert.equal(afterEditAndDelete.plan.publicationMode, "invalidate_structure");
  assert.deepEqual(afterEditAndDelete.plan.deleteIds, ["seg-3"]);
  assert.deepEqual(project(afterEditAndDelete), ["applied", "edited"]);
});

test("PROV-FINAL-09 manual no-raw segment behavior from C1 remains correct", () => {
  const noRawPublication = buildTranscriptEnhancementPublication({
    runId: "run-noraw",
    retranscribeCount: 1,
    inputIdentity: "identity-noraw",
    publishedAt: "2026-09-18T00:00:00.000Z",
    segments: [{ orderIndex: 0, publishedText: "enhanced facilitator turn", originalText: null }],
  });
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: noRawPublication,
      currentRetranscribeCount: 1,
      orderIndex: 0,
      publishedText: "enhanced facilitator turn",
      rawText: null,
    }),
    "applied",
  );
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication: noRawPublication,
      currentRetranscribeCount: 1,
      orderIndex: 0,
      publishedText: "manual rewrite",
      rawText: null,
    }),
    "edited",
  );
  assert.notEqual(
    resolveSegmentEnhancementProvenance({
      publication: noRawPublication,
      currentRetranscribeCount: 1,
      orderIndex: 0,
      publishedText: "enhanced facilitator turn",
      rawText: null,
    }),
    "raw",
  );
});

test("PROV-FINAL-10 generation mismatch behavior remains correct", () => {
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 9,
      orderIndex: 0,
      publishedText: ENHANCED.s1,
      rawText: RAW.s1,
    }),
    "edited",
  );
  assert.equal(
    resolveSegmentEnhancementProvenance({
      publication,
      currentRetranscribeCount: 9,
      orderIndex: 2,
      publishedText: RAW.s3,
      rawText: RAW.s3,
    }),
    "raw",
  );
});

test("PROV-FINAL omitted whitespace existing segment does not destroy mixed provenance", () => {
  const withWhitespace = [
    { id: "seg-1", text: ENHANCED.s1, orderIndex: 0, qualityText: RAW.s1 },
    { id: "seg-ws", text: " \n ", orderIndex: 1, qualityText: " \n " },
    { id: "seg-2", text: ENHANCED.s2, orderIndex: 2, qualityText: RAW.s2 },
    { id: "seg-3", text: ENHANCED.s3, orderIndex: 3, qualityText: RAW.s3 },
  ];
  const mixedPublication = buildTranscriptEnhancementPublication({
    runId: "run-ws",
    retranscribeCount: 1,
    inputIdentity: "identity-ws",
    publishedAt: "2026-09-18T00:00:00.000Z",
    segments: [
      { orderIndex: 0, publishedText: ENHANCED.s1, originalText: RAW.s1 },
      { orderIndex: 2, publishedText: ENHANCED.s2, originalText: RAW.s2 },
      { orderIndex: 3, publishedText: ENHANCED.s3, originalText: RAW.s3 },
    ],
  });
  const plan = planLexicalSaveSegments({
    existingSegments: withWhitespace,
    submittedSegmentIds: ["seg-1", "seg-2", "seg-3"],
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    throw new Error("expected a successful identity plan");
  }
  assert.equal(plan.publicationMode, "preserve");
  assert.deepEqual(plan.deleteIds, []);
  const nextMetadata = processingMetadataAfterLexicalSave({
    metadata: mergeTranscriptEnhancementPublication({}, mixedPublication),
    mode: plan.publicationMode,
    retainedSegments: plan.retainedSegments,
  });
  const nextSegments = [
    { orderIndex: 0, text: ENHANCED.s1, qualityText: RAW.s1 },
    { orderIndex: 1, text: " \n ", qualityText: " \n " },
    { orderIndex: 2, text: "manual two", qualityText: RAW.s2 },
    { orderIndex: 3, text: ENHANCED.s3, qualityText: RAW.s3 },
  ];
  assert.deepEqual(project({ metadata: nextMetadata, segments: nextSegments }), [
    "applied",
    "raw",
    "edited",
    "raw",
  ]);
});

test("PROV-FINAL UI submit helper keeps stable ids through a one-segment lexical edit", () => {
  const turns = buildInitialManualTurnsFromPersistedSegments(
    existing.map((segment) => ({
      id: segment.id,
      mappedParticipantId: "p1",
      text: segment.text,
      startSeconds: null,
      endSeconds: null,
      speakerLabel: "spk",
      orderIndex: segment.orderIndex,
    })),
  );
  turns[1] = { ...turns[1]!, text: "manual two" };
  const submitted = toSubmittedManualSpeakerTurns(turns);
  const saved = applySameStructureSave({
    existing,
    submittedIds: submitted.map((turn) => turn.id),
    submittedTexts: submitted.map((turn) => turn.text),
  });
  assert.deepEqual(submitted.map((turn) => turn.id), ["seg-1", "seg-2", "seg-3"]);
  assert.equal(saved.plan.publicationMode, "preserve");
  assert.deepEqual(project(saved), ["applied", "edited", "raw"]);
});
