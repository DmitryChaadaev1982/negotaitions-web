import {
  ENHANCEMENT_D1_SCHEMA_VERSION,
  computeEnhancementProgress,
  mergeEnhancementJobIntoMetadata,
  type TranscriptEnhancementCancelReason,
  type TranscriptEnhancementChunkStatus,
  type TranscriptEnhancementDurableChunk,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import {
  applyLabCompletedEnhancementToTurns,
  type LabVisualTranscriptTurn,
} from "./post-transcription-lab-transcript";
import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";
import { query } from "./db";
import type { LabD1Fixture, PostTranscriptionLabScenarioDefinition } from "./post-transcription-lab-catalog";

export const BUG02_UAT_SCENARIO_IDS = [
  "LAB-07",
  "LAB-08",
  "LAB-10",
  "LAB-23",
  "LAB-27",
] as const;

export const BUG02_AUTOMATED_SCENARIO_IDS = [
  "LAB-01",
  "LAB-04",
  "LAB-08",
  "LAB-11",
  "LAB-15",
  "LAB-16",
  "LAB-17",
  "LAB-21",
  "LAB-22",
  "LAB-24",
  "LAB-26",
] as const;

export { type LabD1Fixture };

function buildChunks(input: {
  totalChunks: number;
  completedChunks: number;
  running?: boolean;
}): Record<string, TranscriptEnhancementDurableChunk> {
  const chunks: Record<string, TranscriptEnhancementDurableChunk> = {};
  for (let index = 0; index < input.totalChunks; index += 1) {
    let status: TranscriptEnhancementChunkStatus = "PENDING";
    if (index < input.completedChunks) status = "COMPLETED";
    else if (input.running && index === input.completedChunks) status = "RUNNING";
    chunks[String(index)] = {
      chunkIndex: index,
      status,
      targetIndexes: [index],
      attemptCount: status === "COMPLETED" ? 1 : 0,
      unpublishedByOrderIndex:
        status === "COMPLETED" ? { [String(index)]: `enhanced-${index}` } : {},
      lastErrorClass: null,
      lastHttpClass: null,
      lastSchemaResult: null,
      providerDurationMs: status === "COMPLETED" ? 12 : null,
      usageInputTokens: null,
      usageOutputTokens: null,
      usageTotalTokens: null,
      usageClassification: null,
      startedAt: status === "PENDING" ? null : new Date().toISOString(),
      finishedAt: status === "COMPLETED" ? new Date().toISOString() : null,
    };
  }
  return chunks;
}

export function buildLabEnhancementJob(
  fixture: LabD1Fixture,
  now = new Date(),
): TranscriptEnhancementJob {
  const totalChunks = fixture.totalChunks ?? 0;
  const completedChunks = fixture.completedChunks ?? 0;
  const running =
    fixture.executionStatus === "RUNNING" || fixture.executionStatus === "QUEUED";
  const chunks =
    fixture.historicalTimeout || totalChunks <= 0
      ? {}
      : buildChunks({ totalChunks, completedChunks, running });
  const progress = computeEnhancementProgress(chunks);
  return {
    schemaVersion: fixture.historicalTimeout ? "legacy" : ENHANCEMENT_D1_SCHEMA_VERSION,
    jobId: "lab-enhancement-job",
    runId: "lab-enhancement-run",
    leaseToken: running ? "lab-lease" : null,
    leaseExpiresAt: running ? new Date(now.getTime() + 60_000).toISOString() : null,
    executionStatus: fixture.executionStatus ?? "NOT_STARTED",
    publicationEligible: fixture.publicationEligible ?? false,
    terminalQuality: fixture.terminalQuality ?? null,
    inputIdentity: "lab-input",
    retranscribeCount: 0,
    triggerSource: "post-transcription-lab",
    cancelReason: (fixture.cancelReason as TranscriptEnhancementCancelReason | null) ?? null,
    cancelledAt: fixture.cancelReason ? now.toISOString() : null,
    publicationOutcome: null,
    progress,
    chunks,
    unpublishedByOrderIndex: {},
    queuedAt: now.toISOString(),
    startedAt: now.toISOString(),
    finishedAt: running ? null : now.toISOString(),
    safetyDeadlineAt: null,
    skipReason: fixture.skipReason ?? (fixture.historicalTimeout ? "timeout" : null),
    status: fixture.historicalTimeout
      ? "SKIPPED"
      : fixture.executionStatus === "RUNNING"
        ? "RUNNING"
        : fixture.executionStatus === "QUEUED"
          ? "QUEUED"
          : fixture.terminalQuality === "PARTIAL"
            ? "PARTIAL"
            : fixture.executionStatus === "FAILED"
              ? "FAILED"
              : fixture.executionStatus === "COMPLETED"
                ? "COMPLETED"
                : fixture.executionStatus === "CANCELLED_FOR_PUBLICATION"
                  ? "SKIPPED"
                  : "IDLE",
  };
}

export function buildLabEnhancementProcessingMetadata(
  definition: Pick<PostTranscriptionLabScenarioDefinition, "enhancement" | "d1">,
): Record<string, unknown> {
  if (definition.enhancement === "none") {
    return { mappingSuggestion: { source: "fixture", isApplied: false } };
  }

  const d1 = definition.d1 ?? defaultD1ForEnhancement(definition.enhancement);
  if (d1.historicalTimeout || definition.enhancement === "SKIPPED") {
    return {
      transcriptionProvider: "yandex_speechkit",
      transcriptEnhancement: {
        status: "SKIPPED",
        skipReason: d1.skipReason ?? "timeout",
        source: "post-transcription-lab",
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date(Date.now() - 50_000).toISOString(),
      },
      mappingSuggestion: { source: "fixture", isApplied: true },
    };
  }

  const job = buildLabEnhancementJob(d1);
  return mergeEnhancementJobIntoMetadata(
    {
      transcriptionProvider: "yandex_speechkit",
      mappingSuggestion: {
        source: "fixture",
        isApplied: definition.enhancement !== "RUNNING",
      },
    },
    job,
  );
}

function defaultD1ForEnhancement(
  enhancement: PostTranscriptionLabScenarioDefinition["enhancement"],
): LabD1Fixture {
  if (enhancement === "RUNNING") {
    return {
      executionStatus: "RUNNING",
      publicationEligible: true,
      completedChunks: 2,
      totalChunks: 7,
    };
  }
  if (enhancement === "COMPLETED") {
    return {
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      completedChunks: 2,
      totalChunks: 2,
    };
  }
  if (enhancement === "FAILED") {
    return {
      executionStatus: "FAILED",
      publicationEligible: false,
      terminalQuality: "FAILED",
      completedChunks: 0,
      totalChunks: 4,
    };
  }
  if (enhancement === "PARTIAL") {
    return {
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "PARTIAL",
      completedChunks: 3,
      totalChunks: 7,
    };
  }
  if (enhancement === "SKIPPED") {
    return { historicalTimeout: true, skipReason: "timeout", publicationEligible: false };
  }
  return { executionStatus: "NOT_STARTED", publicationEligible: false };
}

export async function patchLabEnhancementMetadata(
  transcriptId: string,
  fixture: LabD1Fixture,
): Promise<void> {
  const current = (
    await query<{ processingMetadata: unknown }>(
      `SELECT "processingMetadata" FROM "Transcript" WHERE "id" = $1`,
      [transcriptId],
    )
  )[0];
  const next = mergeEnhancementJobIntoMetadata(
    current?.processingMetadata ?? { transcriptionProvider: "yandex_speechkit" },
    buildLabEnhancementJob(fixture),
  );
  await query(
    `UPDATE "Transcript" SET "processingMetadata" = $2::jsonb, "updatedAt" = NOW() WHERE "id" = $1`,
    [transcriptId, JSON.stringify(next)],
  );
}

export async function publishLabEnhancedTranscript(input: {
  transcriptId: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
  buyerRole: string;
  sellerRole: string;
  sourceTurns: LabVisualTranscriptTurn[];
}): Promise<void> {
  const enhancedTurns = applyLabCompletedEnhancementToTurns(input.sourceTurns);
  const speakerMapping = {
    speaker_0: input.buyerId,
    speaker_1: input.sellerId,
  };
  const diarizedText = buildCanonicalDiarizedText({
    segments: enhancedTurns.map((turn, orderIndex) => ({
      speakerLabel: turn.speakerLabel,
      displaySpeakerLabel: null,
      startSeconds: turn.startSeconds,
      endSeconds: turn.endSeconds,
      text: turn.text,
      orderIndex,
    })),
    speakerMapping,
    participants: [
      {
        id: input.buyerId,
        displayName: input.buyerName,
        type: "PARTICIPANT",
        roleName: input.buyerRole,
      },
      {
        id: input.sellerId,
        displayName: input.sellerName,
        type: "PARTICIPANT",
        roleName: input.sellerRole,
      },
    ],
  });
  const lexical = enhancedTurns.map((turn) => turn.text).join("\n\n");
  const metadata = mergeEnhancementJobIntoMetadata(
    { transcriptionProvider: "yandex_speechkit" },
    buildLabEnhancementJob({
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "COMPLETED",
      completedChunks: enhancedTurns.length,
      totalChunks: enhancedTurns.length,
    }),
  );
  await query(
    `UPDATE "Transcript"
     SET "text" = $2, "diarizedText" = $3, "processingMetadata" = $4::jsonb, "updatedAt" = NOW()
     WHERE "id" = $1`,
    [input.transcriptId, lexical, diarizedText, JSON.stringify(metadata)],
  );
  for (const [index, turn] of enhancedTurns.entries()) {
    await query(
      `UPDATE "TranscriptSegment" SET "text" = $3, "updatedAt" = NOW()
       WHERE "transcriptId" = $1 AND "orderIndex" = $2`,
      [input.transcriptId, index, turn.text],
    );
  }
}
