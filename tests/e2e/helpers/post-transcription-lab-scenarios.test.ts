import assert from "node:assert/strict";
import test from "node:test";

import { buildLabCanonicalAnalysisJson } from "./post-transcription-lab-analysis";
import { formatLabBriefing } from "./post-transcription-lab-briefing";
import {
  getLabScenario,
  isBug02LabScenario,
  isPipelineLabScenario,
  parseLabScenarioIds,
  POST_TRANSCRIPTION_LAB_SCENARIO_IDS,
} from "./post-transcription-lab-catalog";
import { buildLabEnhancementProcessingMetadata } from "./post-transcription-lab-bug02";
import {
  applyLabCompletedEnhancementToTurns,
  LAB_ENHANCED_LEXICAL_MARKER,
  LAB_VISUAL_TWO_PARTY_TRANSCRIPT,
} from "./post-transcription-lab-transcript";
import { parseCanonicalAnalysisOutput } from "../../../lib/materials-ai-analysis-view";

test("catalog includes the required Phase A scenario matrix", () => {
  for (const id of [
    "S02",
    "S03",
    "S10",
    "S11",
    "S17",
    "S18",
    "E01",
    "E02",
    "E03",
    "E05",
    "E06",
    "E07",
    "I01",
    "I02",
    "I03",
    "I04",
    "I05",
    "N01",
    "N02",
    "N03",
    "N04",
    "N05",
    "NM01",
    "F05",
    "AM01",
    "AM11",
  ]) {
    assert.equal(getLabScenario(id).id, id);
  }
  assert.equal(POST_TRANSCRIPTION_LAB_SCENARIO_IDS.length, 72);
  assert.equal(getLabScenario("AM04B").id, "AM04B");
  assert.equal(getLabScenario("LAB-01").id, "LAB-01");
  assert.equal(getLabScenario("LAB-28").id, "LAB-28");
  assert.equal(getLabScenario("LAB-07").evidenceClass, "OPERATOR");
  assert.equal(getLabScenario("LAB-01").evidenceClass, "AUTOMATED");
  assert.equal(getLabScenario("AM01").fixtureClass, "PIPELINE_FIXTURE");
  assert.equal(getLabScenario("S10").fixtureClass, "STATE_FIXTURE");
});

test("E05 is the terminal enhancement visual proof", () => {
  const scenario = getLabScenario("E05");
  assert.equal(scenario.enhancement, "COMPLETED");
  assert.equal(scenario.mapping, "AUTO_SUGGESTED_COMPLETE");
  const enhanced = applyLabCompletedEnhancementToTurns(LAB_VISUAL_TWO_PARTY_TRANSCRIPT);
  assert.equal(enhanced[0]?.text.includes(LAB_ENHANCED_LEXICAL_MARKER), false);
  assert.equal(enhanced[0]?.text, LAB_VISUAL_TWO_PARTY_TRANSCRIPT[0]?.text);
});

test("S10 no longer documents an AUTO_SUGGESTED vs mapping-required contradiction", () => {
  const scenario = getLabScenario("S10");
  assert.match(scenario.expectedCurrentUi, /informational/i);
  assert.match(scenario.knownDefect, /Phase E/i);
  assert.equal(scenario.mapping, "AUTO_SUGGESTED_COMPLETE");
  assert.equal(scenario.ai, "COMPLETED");
});

test("parseLabScenarioIds defaults to S10 and rejects unknowns", () => {
  assert.deepEqual(parseLabScenarioIds(undefined), ["S10"]);
  assert.deepEqual(parseLabScenarioIds("S10 E02"), ["S10", "E02"]);
  assert.throws(() => parseLabScenarioIds("NOPE"), /Unknown Post-processing Facilitator Lab scenario/);
});

test("formatLabBriefing prints the required operator sections", () => {
  const definition = getLabScenario("S10");
  const briefing = formatLabBriefing({
    definition,
    seeded: {
      sessionId: "sess_lab",
      sessionTitle: "Lab S10",
    },
    domain: {
      sessionStatus: "COMPLETED",
      negotiationState: "FINISHED",
      roomLifecycle: "DEBRIEF_OPEN",
      recordingStatus: "COMPLETED",
      transcriptStatus: "COMPLETED",
      transcriptId: "tx",
      retranscribeCount: 0,
      speakerMappingStatus: "AUTO_SUGGESTED",
      speakerMappingConfirmedAt: null,
      speakerMappingConfirmedBy: null,
      enhancementStatus: "COMPLETED",
      mappingSuggestion: { isApplied: true },
      processingMetadataKeys: ["transcriptEnhancement", "mappingSuggestion"],
      segmentCount: 2,
      mappedSpokenSegmentCount: 2,
      aiStatus: "COMPLETED",
      aiTranscriptId: "tx",
      aiRetranscribeCount: 0,
      aiInputFingerprint: "fp-lab",
      publicationActive: false,
    },
    readiness: {
      transcriptUsable: true,
      enhancementTerminal: true,
      speakerMappingReadyForAnalysis: true,
      aiReadyByCurrentContract: true,
      aiReadyReason: "READY",
      sessionsListMappingStage: "informational",
      materialsRailMappingStage: "informational",
    },
    presentation: {
      note: "Canonical projection supplies AUTO_SUGGESTED as informational.",
    },
  });
  assert.match(briefing, /SCENARIO/);
  assert.match(briefing, /DOMAIN STATE/);
  assert.match(briefing, /READINESS/);
  assert.match(briefing, /CURRENT PRESENTATION/);
  assert.match(briefing, /EXPECTED CURRENT UI/);
  assert.match(briefing, /KNOWN DEFECT \/ EXPECTED FUTURE INVARIANT/);
  assert.match(briefing, /AVAILABLE NEXT ACTIONS/);
  assert.match(briefing, /FIXTURE_CLASS = STATE_FIXTURE/);
});

test("STATE visual transcript is long enough for facilitator inspection", () => {
  assert.ok(LAB_VISUAL_TWO_PARTY_TRANSCRIPT.length >= 15);
  assert.ok(LAB_VISUAL_TWO_PARTY_TRANSCRIPT.length <= 25);
  const labels = new Set(LAB_VISUAL_TWO_PARTY_TRANSCRIPT.map((turn) => turn.speakerLabel));
  assert.deepEqual([...labels].sort(), ["speaker_0", "speaker_1"]);
});

test("lab AI fixture is accepted by the production canonical reader", () => {
  const analysis = buildLabCanonicalAnalysisJson({
    scenarioId: "S10",
    buyer: {
      participantId: "lab-buyer",
      displayName: "Lab Buyer",
      type: "PARTICIPANT",
      roleName: "Buyer",
    },
    seller: {
      participantId: "lab-seller",
      displayName: "Lab Seller",
      type: "PARTICIPANT",
      roleName: "Seller",
    },
    facilitator: {
      participantId: "lab-facilitator",
      displayName: "Lab Facilitator",
      type: "FACILITATOR",
    },
    observer: {
      participantId: "lab-observer",
      displayName: "Lab Observer",
      type: "OBSERVER",
    },
  });
  const parsed = parseCanonicalAnalysisOutput(analysis);
  assert.equal(parsed.success, true);
  assert.equal(analysis.participantPersonalFeedback[0]?.sessionParticipantId, "lab-buyer");
  assert.equal(analysis.participantPersonalFeedback[1]?.sessionParticipantId, "lab-seller");
  assert.equal(analysis.roleObjectivesAnalysis.length, 2);
});

test("LAB-01..LAB-28 are mapped and LAB pipeline IDs do not use AM auto-mapping", () => {
  for (let index = 1; index <= 28; index += 1) {
    const id = `LAB-${String(index).padStart(2, "0")}`;
    const scenario = getLabScenario(id);
    assert.equal(scenario.id, id);
    assert.ok(scenario.evidenceClass);
    assert.equal(isBug02LabScenario(id), true);
    assert.equal(isPipelineLabScenario(id), false);
  }
  assert.match(getLabScenario("E01").knownDefect, /B02-3/);
  assert.match(getLabScenario("S17").knownDefect, /Phase D/);
});

test("LAB27-01 fixture begins RUNNING and publicationEligible, not pre-Continued", () => {
  const scenario = getLabScenario("LAB-27");
  assert.equal(scenario.d1?.executionStatus, "RUNNING");
  assert.equal(scenario.d1?.publicationEligible, true);
  assert.equal(scenario.d1?.terminalQuality, undefined);
  assert.equal(scenario.d1?.cancelReason, undefined);
  assert.equal(scenario.d1?.completedChunks, 2);
  assert.equal(scenario.d1?.totalChunks, 7);
  assert.equal(scenario.mapping, "AUTO_SUGGESTED_COMPLETE");
  const metadata = buildLabEnhancementProcessingMetadata(scenario);
  const enhancement = (metadata.transcriptEnhancement ?? {}) as Record<string, unknown>;
  assert.equal(enhancement.executionStatus, "RUNNING");
  assert.equal(enhancement.publicationEligible, true);
  assert.equal(enhancement.terminalQuality, null);
  assert.equal(enhancement.cancelReason, null);
  assert.notEqual(enhancement.executionStatus, "CANCELLED_FOR_PUBLICATION");
  const progress = enhancement.progress as { completedChunks?: number; totalChunks?: number };
  assert.equal(progress.completedChunks, 2);
  assert.equal(progress.totalChunks, 7);
});

test("LAB27-02 LAB-23 Skip catalog state does not leak into LAB-27", () => {
  const lab23 = getLabScenario("LAB-23");
  const lab27 = getLabScenario("LAB-27");
  assert.notEqual(lab23.d1, lab27.d1);
  assert.notEqual(lab23.id, lab27.id);
  const cancelled23 = {
    ...lab23.d1,
    executionStatus: "CANCELLED_FOR_PUBLICATION" as const,
    publicationEligible: false,
  };
  const leaked = buildLabEnhancementProcessingMetadata({
    enhancement: "RUNNING",
    d1: cancelled23,
  });
  const isolated = buildLabEnhancementProcessingMetadata(lab27);
  const leakedJob = (leaked.transcriptEnhancement ?? {}) as Record<string, unknown>;
  const isolatedJob = (isolated.transcriptEnhancement ?? {}) as Record<string, unknown>;
  assert.equal(leakedJob.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(isolatedJob.executionStatus, "RUNNING");
  assert.equal(isolatedJob.publicationEligible, true);
  assert.match(`lab-${lab23.id.toLowerCase()}-session`, /lab-23/);
  assert.match(`lab-${lab27.id.toLowerCase()}-session`, /lab-27/);
});

test("LAB-23 fixture begins RUNNING and publicationEligible, not pre-Continued", () => {
  const scenario = getLabScenario("LAB-23");
  assert.equal(scenario.d1?.executionStatus, "RUNNING");
  assert.equal(scenario.d1?.publicationEligible, true);
  assert.equal(scenario.d1?.cancelReason, undefined);
  const metadata = buildLabEnhancementProcessingMetadata(scenario);
  const enhancement = (metadata.transcriptEnhancement ?? {}) as Record<string, unknown>;
  assert.equal(enhancement.executionStatus, "RUNNING");
  assert.equal(enhancement.publicationEligible, true);
  assert.equal(enhancement.cancelReason, null);
  assert.notEqual(enhancement.executionStatus, "CANCELLED_FOR_PUBLICATION");
});

test("historical timeout lab metadata does not invent durable chunk counters", () => {
  const metadata = buildLabEnhancementProcessingMetadata({
    enhancement: "SKIPPED",
    d1: { historicalTimeout: true, skipReason: "timeout", publicationEligible: false },
  });
  const enhancement = (metadata.transcriptEnhancement ?? {}) as Record<string, unknown>;
  assert.equal(enhancement.status, "SKIPPED");
  assert.equal(enhancement.skipReason, "timeout");
  assert.equal(enhancement.chunks, undefined);
  assert.equal(enhancement.progress, undefined);
});
