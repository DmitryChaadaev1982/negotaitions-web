import assert from "node:assert/strict";
import test from "node:test";

import { buildLabCanonicalAnalysisJson } from "./post-transcription-lab-analysis";
import { formatLabBriefing } from "./post-transcription-lab-briefing";
import {
  getLabScenario,
  parseLabScenarioIds,
  POST_TRANSCRIPTION_LAB_SCENARIO_IDS,
} from "./post-transcription-lab-catalog";
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
  assert.equal(POST_TRANSCRIPTION_LAB_SCENARIO_IDS.length, 44);
  assert.equal(getLabScenario("AM04B").id, "AM04B");
  assert.equal(getLabScenario("AM01").fixtureClass, "PIPELINE_FIXTURE");
  assert.equal(getLabScenario("S10").fixtureClass, "STATE_FIXTURE");
});

test("E05 is the terminal enhancement visual proof", () => {
  const scenario = getLabScenario("E05");
  assert.equal(scenario.enhancement, "COMPLETED");
  assert.equal(scenario.mapping, "AUTO_SUGGESTED_COMPLETE");
  const enhanced = applyLabCompletedEnhancementToTurns(LAB_VISUAL_TWO_PARTY_TRANSCRIPT);
  assert.equal(enhanced[0]?.text.includes(LAB_ENHANCED_LEXICAL_MARKER), true);
  assert.notEqual(enhanced[0]?.text, LAB_VISUAL_TWO_PARTY_TRANSCRIPT[0]?.text);
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
