import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { ParticipantType, TranscriptStatus } from "@/app/generated/prisma/client";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import {
  isEffectiveTranscriptEnhancementRunning,
  resolveTranscriptEnhancementStatus,
  resolveTranscriptSectionEnhancementPresentation,
  resolveTranscriptSectionEnhancementRunning,
} from "@/lib/post-processing/enhancement-effective-state";
import {
  isEnhancementStatusRunning,
  projectPostProcessingStages,
} from "@/lib/post-processing/projection";
import { isTranscriptEnhancementRunning } from "@/lib/transcription/processing-metadata";

const buyer = { id: "buyer", type: ParticipantType.PARTICIPANT };
const seller = { id: "seller", type: ParticipantType.PARTICIPANT };

const incompleteMappingInput = {
  hasSpeakerDiarization: true,
  speakerMappingStatus: "REQUIRED",
  segments: [
    { speakerLabel: "speaker_1", mappedParticipantId: null, text: "Hello" },
    { speakerLabel: "speaker_2", mappedParticipantId: null, text: "Hi" },
  ],
  participants: [buyer, seller],
};

/** EH10: current new-session shape without depending on a live session id. */
function currentRealSessionEnhancementMetadata(status: string) {
  return {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: {
      status,
      runId: "fixture-enhancement-run",
      triggerSource: "automatic_initial_transcription",
      inputIdentity: "fixture-input-identity",
      idempotencyDecision: "started_new",
      queuedAt: "2026-08-20T09:43:24.026Z",
      startedAt: "2026-08-20T09:43:24.026Z",
      finishedAt: status === "RUNNING" || status === "IN_PROGRESS" ? null : "2026-08-20T09:43:28.206Z",
      completedAt: status === "COMPLETED" ? "2026-08-20T09:43:28.206Z" : null,
    },
    mappingSuggestion: { attempted: true, isApplied: false },
  };
}

function projectFromEnhancement(status: string) {
  return projectPostProcessingStages({
    recordingStage: "ready",
    transcriptStage: "ready",
    enhancementStatus: resolveTranscriptEnhancementStatus(
      currentRealSessionEnhancementMetadata(status),
    ),
    transcriptPresent: true,
    mappingInput: incompleteMappingInput,
    aiStage: "not_started",
  });
}

function simulateMaterialsStatusPoll(status: string) {
  const metadata = currentRealSessionEnhancementMetadata(status);
  const canonical = resolveTranscriptEnhancementStatus(metadata);
  return {
    metadata,
    canonical,
    rail: projectPostProcessingStages({
      recordingStage: "ready",
      transcriptStage: "ready",
      enhancementStatus: canonical,
      transcriptPresent: true,
      mappingInput: incompleteMappingInput,
      aiStage: "not_started",
    }),
    section: resolveTranscriptSectionEnhancementPresentation({
      canonicalEnhancementRunning: projectPostProcessingStages({
        recordingStage: "ready",
        transcriptStage: "ready",
        enhancementStatus: canonical,
        transcriptPresent: true,
        mappingInput: incompleteMappingInput,
        aiStage: "not_started",
      }).stages.TRANSCRIPT_ENHANCEMENT.semantic === "running",
      canonicalEnhancementStatus: canonical,
      localEnhancementStatus: "RUNNING",
      processingMetadata: currentRealSessionEnhancementMetadata("RUNNING"),
    }),
    transcriptSaveGuardRunning: isTranscriptEnhancementRunning(metadata),
    mappingSaveGuardRunning: isTranscriptEnhancementRunning(metadata),
    aiStartGuardRunning: isTranscriptEnhancementRunning(metadata),
  };
}

test("EH01_RUNNING_TO_COMPLETED_LIVE_PROJECTION", () => {
  const running = simulateMaterialsStatusPoll("RUNNING");
  const completed = simulateMaterialsStatusPoll("COMPLETED");

  assert.equal(running.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "running");
  assert.equal(running.section.running, true);
  assert.equal(running.transcriptSaveGuardRunning, true);

  assert.equal(completed.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(completed.section.running, false);
  assert.equal(completed.section.terminal, true);
  assert.equal(completed.transcriptSaveGuardRunning, false);
  assert.equal(completed.mappingSaveGuardRunning, false);
  assert.equal(completed.rail.stages.SPEAKER_MAPPING.semantic, "action_required");
  assert.equal(completed.rail.stages.AI_ANALYSIS.semantic, "pending");
});

test("EH02_RUNNING_TO_FAILED", () => {
  const failed = simulateMaterialsStatusPoll("FAILED");
  assert.equal(failed.section.running, false);
  assert.equal(failed.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "failed");
  assert.equal(failed.transcriptSaveGuardRunning, false);
});

test("EH03_RUNNING_TO_PARTIAL", () => {
  const partial = simulateMaterialsStatusPoll("PARTIAL");
  assert.equal(partial.section.running, false);
  assert.equal(partial.section.terminal, true);
  assert.equal(partial.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "failed");
  assert.equal(partial.transcriptSaveGuardRunning, false);
});

test("EH04_RUNNING_TO_SKIPPED", () => {
  const skipped = simulateMaterialsStatusPoll("SKIPPED");
  assert.equal(skipped.section.running, false);
  assert.equal(skipped.section.terminal, true);
  assert.equal(skipped.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "informational");
  assert.equal(skipped.transcriptSaveGuardRunning, false);
});

test("EH05_ROOM_MATERIALS_PARITY", () => {
  for (const status of ["RUNNING", "COMPLETED", "FAILED", "PARTIAL", "SKIPPED"]) {
    const snapshot = simulateMaterialsStatusPoll(status);
    const roomRunning = resolveTranscriptSectionEnhancementRunning({
      canonicalEnhancementStatus: snapshot.canonical,
    });
    const materialsRunning = isEnhancementStatusRunning(
      snapshot.rail.stages.TRANSCRIPT_ENHANCEMENT.raw.status as string,
    );
    assert.equal(roomRunning, materialsRunning, status);
    assert.equal(
      snapshot.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic === "running",
      roomRunning,
      status,
    );
  }
});

test("EH06_SERVER_GUARD_PARITY", () => {
  assert.equal(
    isTranscriptEnhancementRunning(currentRealSessionEnhancementMetadata("COMPLETED")),
    false,
  );
  assert.equal(
    isTranscriptEnhancementRunning(currentRealSessionEnhancementMetadata("RUNNING")),
    true,
  );
  assert.equal(
    isEffectiveTranscriptEnhancementRunning(
      currentRealSessionEnhancementMetadata("COMPLETED"),
    ),
    false,
  );
  assert.equal(
    isEffectiveTranscriptEnhancementRunning(
      currentRealSessionEnhancementMetadata("QUEUED"),
    ),
    true,
  );
});

test("EH07_POLLING_TRANSITION", () => {
  const pollSequence = ["RUNNING", "RUNNING", "COMPLETED"].map((status) =>
    simulateMaterialsStatusPoll(status),
  );
  assert.equal(pollSequence[0]?.section.running, true);
  assert.equal(pollSequence[0]?.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "running");
  assert.equal(pollSequence[2]?.section.running, false);
  assert.equal(pollSequence[2]?.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(pollSequence[2]?.canonical, "COMPLETED");
  assert.equal(pollSequence[2]?.section.status, "COMPLETED");
});

test("EH08_NO_STALE_LOCAL_RUNNING_FLAG", () => {
  const lockedByStaleLocal = resolveTranscriptSectionEnhancementRunning({
    localEnhancementStatus: "RUNNING",
    processingMetadata: currentRealSessionEnhancementMetadata("RUNNING"),
  });
  const unlockedByCanonical = resolveTranscriptSectionEnhancementRunning({
    canonicalEnhancementStatus: "COMPLETED",
    localEnhancementStatus: "RUNNING",
    processingMetadata: currentRealSessionEnhancementMetadata("RUNNING"),
  });
  assert.equal(lockedByStaleLocal, true);
  assert.equal(unlockedByCanonical, false);
});

test("EH09_MAPPING_NEXT_BLOCKER", () => {
  const projection = projectFromEnhancement("COMPLETED");
  const readiness = evaluateAiAnalysisReadiness({
    status: TranscriptStatus.COMPLETED,
    text: "Hello",
    diarizedText: "speaker_1: Hello",
    hasSpeakerDiarization: true,
    speakerMappingStatus: "REQUIRED",
    speakerMapping: null,
    enhancementStatus: "COMPLETED",
    participants: incompleteMappingInput.participants,
    segments: incompleteMappingInput.segments,
  });

  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "action_required");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "SPEAKER_MAPPING_REQUIRED");
  assert.notEqual(readiness.reason, "ENHANCEMENT_RUNNING");
});

test("EH10_CURRENT_REAL_SESSION_SHAPE", () => {
  const metadata = currentRealSessionEnhancementMetadata("COMPLETED");
  const canonical = resolveTranscriptEnhancementStatus(metadata);
  const section = resolveTranscriptSectionEnhancementPresentation({
    canonicalEnhancementStatus: canonical,
    localEnhancementStatus: "RUNNING",
    processingMetadata: currentRealSessionEnhancementMetadata("RUNNING"),
  });
  const projection = projectFromEnhancement("COMPLETED");

  assert.equal(canonical, "COMPLETED");
  assert.equal(section.running, false);
  assert.equal(projection.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(projection.stages.SPEAKER_MAPPING.semantic, "action_required");
  assert.equal(isTranscriptEnhancementRunning(metadata), false);
});

test("resolveTranscriptEnhancementStatus maps every running alias to IN_PROGRESS", () => {
  for (const status of ["RUNNING", "IN_PROGRESS", "QUEUED"]) {
    assert.equal(
      resolveTranscriptEnhancementStatus({ transcriptEnhancement: { status } }),
      "IN_PROGRESS",
    );
  }
});

test("ET08_LIVE_RUNNING_TO_COMPLETED", () => {
  const running = simulateMaterialsStatusPoll("RUNNING");
  const completed = simulateMaterialsStatusPoll("COMPLETED");
  assert.equal(running.section.running, true);
  assert.equal(running.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "running");
  assert.equal(completed.section.running, false);
  assert.equal(completed.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "ready");
  assert.equal(completed.section.terminal, true);
});

test("ET09_LIVE_RUNNING_TO_TIMEOUT", () => {
  const running = simulateMaterialsStatusPoll("RUNNING");
  const timedOut = simulateMaterialsStatusPoll("SKIPPED");
  assert.equal(running.section.running, true);
  assert.equal(timedOut.section.running, false);
  assert.equal(timedOut.section.terminal, true);
  assert.equal(timedOut.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic, "informational");
  assert.equal(timedOut.transcriptSaveGuardRunning, false);
  assert.equal(timedOut.mappingSaveGuardRunning, false);
  assert.equal(timedOut.aiStartGuardRunning, false);
});

test("ET10_ROOM_MATERIALS_PARITY", () => {
  for (const status of ["RUNNING", "COMPLETED", "FAILED", "PARTIAL", "SKIPPED"]) {
    const snapshot = simulateMaterialsStatusPoll(status);
    const roomRunning = resolveTranscriptSectionEnhancementRunning({
      canonicalEnhancementRunning:
        snapshot.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic === "running",
      canonicalEnhancementStatus: snapshot.canonical,
    });
    const materialsRunning = isEnhancementStatusRunning(
      snapshot.rail.stages.TRANSCRIPT_ENHANCEMENT.raw.status as string,
    );
    assert.equal(roomRunning, materialsRunning, status);
    assert.equal(
      snapshot.rail.stages.TRANSCRIPT_ENHANCEMENT.semantic === "running",
      roomRunning,
      status,
    );
  }
});

test("split-brain: rail terminal running flag unlocks a stale local RUNNING snapshot", () => {
  assert.equal(
    resolveTranscriptSectionEnhancementRunning({
      canonicalEnhancementRunning: false,
      canonicalEnhancementStatus: "COMPLETED",
      localEnhancementStatus: "IN_PROGRESS",
      processingMetadata: currentRealSessionEnhancementMetadata("RUNNING"),
    }),
    false,
  );
});

test("EH source contract: section and panel consume canonical enhancement status", async () => {
  const section = await readFile(
    path.join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  const panel = await readFile(
    path.join(process.cwd(), "components/session-post-processing-panel.tsx"),
    "utf8",
  );
  const transcriptRoute = await readFile(
    path.join(process.cwd(), "app/api/sessions/[sessionId]/transcript/route.ts"),
    "utf8",
  );
  const mappingRoute = await readFile(
    path.join(process.cwd(), "app/api/sessions/[sessionId]/speaker-mapping/route.ts"),
    "utf8",
  );
  const attributionRoute = await readFile(
    path.join(
      process.cwd(),
      "app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts",
    ),
    "utf8",
  );
  const analyzeRoute = await readFile(
    path.join(process.cwd(), "app/api/sessions/[sessionId]/analyze/route.ts"),
    "utf8",
  );

  assert.match(section, /canonicalEnhancementStatus/);
  assert.match(section, /canonicalEnhancementRunning/);
  assert.match(section, /resolveTranscriptSectionEnhancementRunning/);
  assert.doesNotMatch(section, /enhancement\?\.status !== "IN_PROGRESS"/);
  assert.match(panel, /canonicalEnhancementStatus=/);
  assert.match(panel, /canonicalEnhancementRunning=/);
  assert.match(panel, /postProcessing\?\.stages.TRANSCRIPT_ENHANCEMENT/);
  assert.match(transcriptRoute, /isAuthoritativeEnhancementLockActive/);
  assert.match(mappingRoute, /isAuthoritativeEnhancementLockActive/);
  assert.match(attributionRoute, /isAuthoritativeEnhancementLockActive/);
  assert.match(analyzeRoute, /isAuthoritativeEnhancementLockActive/);
});
