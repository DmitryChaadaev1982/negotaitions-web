import assert from "node:assert/strict";
import test from "node:test";

import { persistMappingOwnedTranscriptUpdate } from "@/lib/transcription/mapping-persistence";
import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

type MappingState = {
  id: string;
  processingMetadata: Record<string, unknown>;
  retranscribeCount: number;
  speakerMapping: SpeakerMapping;
  diarizedText: string | null;
  segments: Array<{
    id: string;
    orderIndex: number;
    speakerLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
    mappingLocked: boolean;
    mappedParticipantId: string | null;
  }>;
};

function createMappingTx(state: MappingState) {
  const updatePayloads: Array<Record<string, unknown>> = [];
  const tx = {
    transcript: {
      findUnique: async () => ({
        id: state.id,
        processingMetadata: structuredClone(state.processingMetadata),
        retranscribeCount: state.retranscribeCount,
        speakerMapping: state.speakerMapping,
        diarizedText: state.diarizedText,
        segments: state.segments.map((segment) => ({ ...segment })),
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        updatePayloads.push(args.data);
        if ("speakerMapping" in args.data) {
          state.speakerMapping = args.data.speakerMapping as SpeakerMapping;
        }
        if ("diarizedText" in args.data) {
          state.diarizedText = (args.data.diarizedText as string | null) ?? null;
        }
        if (
          "processingMetadata" in args.data &&
          args.data.processingMetadata &&
          typeof args.data.processingMetadata === "object"
        ) {
          state.processingMetadata = args.data.processingMetadata as Record<string, unknown>;
        }
        return state;
      },
    },
    transcriptSegment: {
      update: async (args: {
        where: { id: string };
        data: { mappedParticipantId?: string | null };
      }) => {
        const segment = state.segments.find((item) => item.id === args.where.id);
        if (segment && "mappedParticipantId" in args.data) {
          segment.mappedParticipantId = args.data.mappedParticipantId ?? null;
        }
      },
    },
  };
  return { tx, updatePayloads };
}

function cancelledEnhancementState(): MappingState {
  return {
    id: "tr-map",
    retranscribeCount: 2,
    speakerMapping: { speaker_1: "old-buyer" },
    diarizedText: "stale-raw diarized snapshot",
    processingMetadata: {
      transcriptionProvider: "yandex_speechkit",
      historicalCustom: { keep: true },
      transcriptEnhancementPublication: {
        runId: "run-a",
        retranscribeCount: 2,
        inputIdentity: "id-a",
        publishedAt: "2026-01-01T00:00:00.000Z",
        segmentDigestByOrderIndex: { "0": "digest-a" },
      },
      transcriptEnhancement: {
        schemaVersion: "d1-v1",
        executionStatus: "CANCELLED_FOR_PUBLICATION",
        publicationEligible: false,
        terminalQuality: null,
        runId: "run-skip",
        chunks: {
          "0": {
            chunkIndex: 0,
            status: "COMPLETED",
            targetIndexes: [0],
            unpublishedByOrderIndex: { "0": "enhanced-0" },
          },
        },
      },
      mappingSuggestion: { reason: "old" },
    },
    segments: [
      {
        id: "seg-1",
        orderIndex: 0,
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 1,
        text: "published current lexical",
        mappingLocked: false,
        mappedParticipantId: "old-buyer",
      },
    ],
  };
}

test("mapping persist patches mappingSuggestion without reviving Skip or deleting checkpoints", async () => {
  const state = cancelledEnhancementState();
  const { tx, updatePayloads } = createMappingTx(state);
  const persisted = await persistMappingOwnedTranscriptUpdate({
    tx: tx as never,
    transcriptId: "tr-map",
    patch: {
      speakerMapping: { speaker_1: "buyer" },
      speakerMappingStatus: "CONFIRMED",
      mappingSuggestion: { reason: "human_save", isApplied: true },
    },
    rebuildDiarizedText: true,
    participants: [
      {
        id: "buyer",
        displayName: "Buyer",
        type: "PARTICIPANT",
        roleName: "Buyer",
      },
    ],
    segmentUpdates: [
      {
        orderIndex: 0,
        mappedParticipantId: "buyer",
        mappingSource: "CLUSTER_MAPPING",
      },
    ],
  });
  assert.equal(persisted.ok, true);
  const job = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(job.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(job.publicationEligible, false);
  assert.equal(job.chunks["0"]?.status, "COMPLETED");
  assert.deepEqual(state.processingMetadata.historicalCustom, { keep: true });
  assert.deepEqual(state.processingMetadata.transcriptEnhancementPublication, {
    runId: "run-a",
    retranscribeCount: 2,
    inputIdentity: "id-a",
    publishedAt: "2026-01-01T00:00:00.000Z",
    segmentDigestByOrderIndex: { "0": "digest-a" },
  });
  assert.deepEqual(state.processingMetadata.mappingSuggestion, {
    reason: "human_save",
    isApplied: true,
  });
  assert.equal(state.speakerMapping.speaker_1, "buyer");
  assert.match(state.diarizedText ?? "", /published current lexical/);
  assert.doesNotMatch(state.diarizedText ?? "", /stale-raw diarized snapshot/);
  assert.equal(
    updatePayloads.some((payload) => {
      const enhancement = (payload.processingMetadata as { transcriptEnhancement?: unknown } | undefined)
        ?.transcriptEnhancement as
        | { executionStatus?: string; publicationEligible?: boolean }
        | undefined;
      return enhancement?.executionStatus === "RUNNING" || enhancement?.publicationEligible === true;
    }),
    false,
  );
});

test("mapping persist rebuilds diarizedText from current segment.text not a pre-lock snapshot", async () => {
  const state = cancelledEnhancementState();
  state.processingMetadata.transcriptEnhancement = {
    schemaVersion: "d1-v1",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    chunks: { "0": { chunkIndex: 0, status: "COMPLETED" } },
  };
  const { tx } = createMappingTx(state);
  const persisted = await persistMappingOwnedTranscriptUpdate({
    tx: tx as never,
    transcriptId: "tr-map-running",
    patch: { speakerMapping: { speaker_1: "buyer" } },
    rebuildDiarizedText: true,
    participants: [
      { id: "buyer", displayName: "Buyer", type: "PARTICIPANT", roleName: "Buyer" },
    ],
  });
  assert.equal(persisted.ok, true);
  const job = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(job.executionStatus, "RUNNING");
  assert.equal(job.publicationEligible, true);
  assert.equal(job.chunks["0"]?.status, "COMPLETED");
  assert.match(state.diarizedText ?? "", /published current lexical/);
});

test("MAP-GEN-02 wrong transcriptId is rejected without writing", async () => {
  const state = cancelledEnhancementState();
  const { tx, updatePayloads } = createMappingTx(state);
  const persisted = await persistMappingOwnedTranscriptUpdate({
    tx: tx as never,
    transcriptId: "tr-map",
    expectedTranscriptId: "other-transcript",
    expectedRetranscribeCount: 2,
    patch: { speakerMapping: { speaker_1: "buyer" } },
    rebuildDiarizedText: true,
  });
  assert.equal(persisted.ok, false);
  if (!persisted.ok) {
    assert.equal(persisted.reason, "generation_mismatch");
  }
  assert.equal(state.speakerMapping.speaker_1, "old-buyer");
  assert.equal(updatePayloads.length, 0);
});

test("MAP-GEN-03 wrong retranscribeCount is rejected without writing", async () => {
  const state = cancelledEnhancementState();
  const { tx, updatePayloads } = createMappingTx(state);
  const persisted = await persistMappingOwnedTranscriptUpdate({
    tx: tx as never,
    transcriptId: "tr-map",
    expectedTranscriptId: "tr-map",
    expectedRetranscribeCount: 1,
    patch: { speakerMapping: { speaker_1: "buyer" } },
    rebuildDiarizedText: true,
  });
  assert.equal(persisted.ok, false);
  if (!persisted.ok) {
    assert.equal(persisted.reason, "generation_mismatch");
  }
  assert.equal(state.speakerMapping.speaker_1, "old-buyer");
  assert.equal(state.diarizedText, "stale-raw diarized snapshot");
  assert.equal(updatePayloads.length, 0);
});

test("MAP-GEN-01 stale generation N mapping does not attach to N+1", async () => {
  const state = cancelledEnhancementState();
  state.retranscribeCount = 3;
  const { tx, updatePayloads } = createMappingTx(state);
  const persisted = await persistMappingOwnedTranscriptUpdate({
    tx: tx as never,
    transcriptId: "tr-map",
    expectedTranscriptId: "tr-map",
    expectedRetranscribeCount: 2,
    patch: { speakerMapping: { speaker_1: "buyer" } },
    requestedMapping: { speaker_1: "buyer" },
    rebuildDiarizedText: true,
    participants: [
      { id: "buyer", displayName: "Buyer", type: "PARTICIPANT", roleName: "Buyer" },
    ],
  });
  assert.equal(persisted.ok, false);
  if (!persisted.ok) {
    assert.equal(persisted.reason, "generation_mismatch");
  }
  assert.equal(state.speakerMapping.speaker_1, "old-buyer");
  assert.equal(state.segments[0]?.mappedParticipantId, "old-buyer");
  assert.equal(updatePayloads.length, 0);
});
