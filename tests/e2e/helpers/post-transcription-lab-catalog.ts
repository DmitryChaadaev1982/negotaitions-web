export const POST_TRANSCRIPTION_LAB_SCENARIO_IDS = [
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
  "AM02",
  "AM03",
  "AM04",
  "AM04B",
  "AM05",
  "AM06",
  "AM07",
  "AM07A",
  "AM07B",
  "AM07C",
  "AM07D",
  "AM07E",
  "AM08",
  "AM09",
  "AM10",
  "AM11",
  "AM12",
  "AM13",
  "AM14",
] as const;

export type PostTranscriptionLabScenarioId =
  (typeof POST_TRANSCRIPTION_LAB_SCENARIO_IDS)[number];

export type LabEnhancementFixture =
  | "none"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type LabMappingFixture =
  | "REQUIRED"
  | "NEEDS_REVIEW"
  | "AUTO_SUGGESTED_COMPLETE"
  | "AUTO_SUGGESTED_INCOMPLETE"
  | "CONFIRMED";

export type LabAiFixture =
  | "none"
  | "QUEUED"
  | "ANALYZING"
  | "COMPLETED"
  | "PUBLISHED";

export type LabFixtureClass = "STATE_FIXTURE" | "PIPELINE_FIXTURE";

export type PostTranscriptionLabScenarioDefinition = {
  id: PostTranscriptionLabScenarioId;
  title: string;
  fixtureClass?: LabFixtureClass;
  enhancement: LabEnhancementFixture;
  mapping: LabMappingFixture;
  ai: LabAiFixture;
  expectedCurrentUi: string;
  knownDefect: string;
  expectedFutureInvariant: string;
  availableNextActions: string[];
};

const SCENARIOS: Record<
  PostTranscriptionLabScenarioId,
  PostTranscriptionLabScenarioDefinition
> = {
  S02: {
    id: "S02",
    title: "Mapping REQUIRED / incomplete, AI not started",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Five-card rail, materials, and /sessions all treat mapping as action_required. AI start is blocked.",
    knownDefect: "None after Phase C canonical projection.",
    expectedFutureInvariant:
      "One canonical structural completeness invariant keeps REQUIRED / incomplete mapping action_required and AI-blocked everywhere.",
    availableNextActions: [
      "Open materials and confirm AI is not offered as runnable",
      "Open /sessions and confirm mapping required",
    ],
  },
  S03: {
    id: "S03",
    title: "AUTO_SUGGESTED complete, AI not started",
    enhancement: "COMPLETED",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "Complete AUTO_SUGGESTED is informational/advisory on the five-card rail, detailed rows, /sessions, and dashboard. AI can start. Mapping is not an unresolved blocker.",
    knownDefect: "None after Phase E Start AI → CONFIRMED.",
    expectedFutureInvariant:
      "Complete AUTO_SUGGESTED is informational/advisory everywhere. Start AI persists CONFIRMED.",
    availableNextActions: [
      "Inspect the five-card rail vs /sessions mapping badge",
      "Start AI to persist CONFIRMED",
    ],
  },
  S10: {
    id: "S10",
    title: "AUTO_SUGGESTED complete + AI COMPLETED",
    enhancement: "COMPLETED",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "COMPLETED",
    expectedCurrentUi:
      "AI is the completed stage. Historical STATE_FIXTURE may still store AUTO_SUGGESTED as informational, but the confirm-later banner is hidden after AI exists. No surface shows mapping required.",
    knownDefect: "None after Phase E advisory hide after AI admission.",
    expectedFutureInvariant:
      "Newly completed AI persists CONFIRMED. Historical AUTO_SUGGESTED + completed AI does not show unresolved confirm work.",
    availableNextActions: [
      "Compare materials five-card rail with /sessions mapping badge",
      "Open dashboard pipeline text if the session is visible there",
    ],
  },
  S11: {
    id: "S11",
    title: "CONFIRMED mapping, AI not started",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "none",
    expectedCurrentUi:
      "Materials and /sessions agree mapping is confirmed. AI can start.",
    knownDefect: "None for confirmation presentation; later phases must not revert CONFIRMED to AUTO_SUGGESTED.",
    expectedFutureInvariant:
      "Complete human save and successful AI admission both persist CONFIRMED without reversal.",
    availableNextActions: ["Confirm confirmed badge on /sessions", "Start AI later if needed"],
  },
  S17: {
    id: "S17",
    title: "AI COMPLETE — current-before-fix transcript edit state",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "COMPLETED",
    expectedCurrentUi:
      "AI remains the current completed stage. A later manual transcript edit currently does not rewind AI.",
    knownDefect:
      "AI freshness uses only transcriptId + retranscribeCount, so lexical edits keep AI looking current.",
    expectedFutureInvariant:
      "Material transcript edit makes current AI NOT_STARTED and old AI non-current.",
    availableNextActions: [
      "After CONTINUE D, edit transcript text through the real materials UI",
    ],
  },
  S18: {
    id: "S18",
    title: "AI COMPLETE — current-before-fix mapping edit state",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "COMPLETED",
    expectedCurrentUi:
      "AI remains the current completed stage. A later mapping edit currently does not rewind AI.",
    knownDefect: "Mapping changes are not part of current AI freshness.",
    expectedFutureInvariant:
      "Material mapping change makes current AI NOT_STARTED.",
    availableNextActions: [
      "After CONTINUE D, change mapping through the real materials UI",
    ],
  },
  E01: {
    id: "E01",
    title: "Enhancement RUNNING + mapping REQUIRED",
    enhancement: "RUNNING",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Enhancement is in progress. Mapping required. Current AI readiness ignores enhancement and still blocks only on mapping.",
    knownDefect:
      "AI readiness ignores enhancement RUNNING. Transcript edits are still allowed during enhancement.",
    expectedFutureInvariant:
      "Enhancement RUNNING blocks AI and colliding transcript/material saves.",
    availableNextActions: ["View transcript", "Confirm enhancement card is running"],
  },
  E02: {
    id: "E02",
    title: "Enhancement RUNNING + AUTO_SUGGESTED complete",
    enhancement: "RUNNING",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "While enhancement is RUNNING inside the configured timeout window, the running state is visible, transcript remains readable, material edit is blocked, and AI is not offered as runnable. After timeout the lock clears automatically without a facilitator decision.",
    knownDefect: "None after the short enhancement timeout gate.",
    expectedFutureInvariant:
      "Enhancement RUNNING inside TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS: transcript readable, material edit blocked, AI not offered. Terminal or timeout unlocks workflow.",
    availableNextActions: [
      "Confirm enhancement RUNNING on the five-card rail",
      "Confirm transcript remains readable",
      "Confirm Save/AI controls are unavailable while enhancement is RUNNING",
    ],
  },
  E03: {
    id: "E03",
    title: "Enhancement FAILED + AUTO_SUGGESTED complete",
    enhancement: "FAILED",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "Transcript remains usable. Enhancement FAILED shows retry plus continue-with-current-transcript. Starting AI is the continue path. Mapping stays informational.",
    knownDefect: "None after Phase C continue-current-transcript presentation.",
    expectedFutureInvariant:
      "FAILED/PARTIAL/SKIPPED remain terminal and allow intentional continue-with-current-transcript without a new acknowledgement column.",
    availableNextActions: ["Inspect retry vs continue presentation"],
  },
  E05: {
    id: "E05",
    title: "Enhancement COMPLETED + AUTO_SUGGESTED complete",
    enhancement: "COMPLETED",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "Enhancement COMPLETED. Enhanced lexical text and mapped participant names stay coherent. Transcript editing is unlocked. Mapping is informational. AI start follows existing readiness.",
    knownDefect: "None after Phase C projection. Start AI persists CONFIRMED.",
    expectedFutureInvariant:
      "After successful enhancement, names + enhanced lexical text remain coherent and material edit unlocks.",
    availableNextActions: [
      "Confirm enhancement COMPLETED",
      "Confirm mapped names + enhanced lexical text",
      "Confirm Save/edit is available again",
      "Confirm facilitator notes remain editable",
    ],
  },
  E06: {
    id: "E06",
    title: "Edit attempt while enhancement RUNNING",
    enhancement: "RUNNING",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "While enhancement is RUNNING inside the configured timeout window, transcript/material save is unavailable. Facilitator/observer notes stay editable. After timeout the save lock clears automatically.",
    knownDefect: "None after the short enhancement timeout gate.",
    expectedFutureInvariant:
      "Client and server reject colliding transcript/material saves while enhancement is RUNNING inside the timeout window.",
    availableNextActions: [
      "Confirm transcript save is blocked while enhancement is RUNNING",
      "Confirm facilitator/observer notes are not frozen by this lock",
    ],
  },
  E07: {
    id: "E07",
    title: "Edit buffer opened while enhancement can change state",
    enhancement: "RUNNING",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "Transcript stays readable and view-only while enhancement is RUNNING inside the timeout window.",
    knownDefect: "None after the short enhancement timeout gate.",
    expectedFutureInvariant:
      "Editor stays view-only until enhancement is terminal or times out; then names + lexical text remain coherent.",
    availableNextActions: ["Open transcript view and leave the editor idle"],
  },
  I01: {
    id: "I01",
    title: "Material change after current AI",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "COMPLETED",
    expectedCurrentUi: "AI is the current completed stage.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Accepted material transcript/mapping save rewinds current AI to NOT_STARTED; historical AiAnalysis row remains.",
    availableNextActions: [
      "I01-A: inspect current AI before edit",
      "I01-B: inspect rewind after the real diarized-text save",
    ],
  },
  I02: {
    id: "I02",
    title: "Material change before AI",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "none",
    expectedCurrentUi: "No current AI. Material edits remain ordinary saves.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Material edit before AI does not invent historical invalidation; later analysis uses the new fingerprint.",
    availableNextActions: ["Save a transcript text edit"],
  },
  I03: {
    id: "I03",
    title: "Material change after publish",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "PUBLISHED",
    expectedCurrentUi: "AI is current and published.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Accepted material save warns, revokes publication, and rewinds AI to NOT_STARTED.",
    availableNextActions: [
      "I03-A: inspect published/current AI before edit",
      "I03-B: inspect the material-change warning without confirming it",
      "I03-C: inspect revoke and AI rewind after the Lab confirms",
    ],
  },
  I04: {
    id: "I04",
    title: "Stale recipient access",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "PUBLISHED",
    expectedCurrentUi:
      "Publication grant exists, but stored fingerprint does not match current material input.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Participant and observer recipient access fails closed.",
    availableNextActions: ["Inspect recipient materials/status"],
  },
  I05: {
    id: "I05",
    title: "Historical NULL fingerprint",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "COMPLETED",
    expectedCurrentUi:
      "Historical AiAnalysis.inputFingerprint is NULL; legacy transcriptId + retranscribeCount currentness remains.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Do not force migration or regeneration. Matching transcript identity stays current.",
    availableNextActions: ["Inspect materials currentness"],
  },
  N01: {
    id: "N01",
    title: "AI COMPLETE — negotiation-participant notes controlled mutation",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "COMPLETED",
    expectedCurrentUi:
      "Participant preparation notes exist. Post-negotiation UI should not offer a new participant-note editor.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "A controlled material participant-note difference changes fingerprint/currentness.",
    availableNextActions: [
      "Do not add a post-negotiation participant editing control",
      "Use the controlled test mutation after CONTINUE D",
    ],
  },
  N02: {
    id: "N02",
    title: "AI PUBLISHED — negotiation-participant notes controlled mutation",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "PUBLISHED",
    expectedCurrentUi: "AI is published. Participant preparation notes remain locked in normal UI.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Material participant-note change invalidates current AI and active publication.",
    availableNextActions: ["Use the controlled test mutation after CONTINUE D"],
  },
  N03: {
    id: "N03",
    title: "AI COMPLETE — facilitator notes change",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "PUBLISHED",
    expectedCurrentUi:
      "Facilitator notes remain editable on materials under existing debrief permissions.",
    knownDefect:
      "None intended: facilitator notes must remain a negative control for AI currentness.",
    expectedFutureInvariant:
      "Facilitator note A→B does not change fingerprint, AI currentness, or publication.",
    availableNextActions: ["Edit facilitator notes on materials"],
  },
  N04: {
    id: "N04",
    title: "AI PUBLISHED — observer notes change",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "PUBLISHED",
    expectedCurrentUi:
      "Observer notes remain editable under existing debrief permissions. Publication stays active.",
    knownDefect:
      "None intended: observer notes must remain a negative control.",
    expectedFutureInvariant:
      "Observer note A→B does not change fingerprint, AI currentness, or publication.",
    availableNextActions: ["Login as observer later or inspect observer notes path"],
  },
  N05: {
    id: "N05",
    title: "Post-negotiation notes permissions",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "COMPLETED",
    expectedCurrentUi:
      "Finished session: participant own preparation notes remain visible and read-only; facilitator/observer see all participant preparation notes read-only and can still edit their own notes. AI publication is not required.",
    knownDefect: "None after restoring the post-FINISHED lock and role-aware read projection.",
    expectedFutureInvariant:
      "Participant post-negotiation notes stay visible and locked. Other participants cannot receive those notes. Facilitator/observer notes stay usable.",
    availableNextActions: [
      "Inspect N05-PARTICIPANT / N05-FACILITATOR / N05-OBSERVER materials",
      "Save facilitator and observer own notes",
    ],
  },
  NM01: {
    id: "NM01",
    title: "Non-material field control — SessionRole.privateInstructions",
    enhancement: "COMPLETED",
    mapping: "CONFIRMED",
    ai: "PUBLISHED",
    expectedCurrentUi: "AI is current and published.",
    knownDefect: "None after Phase D implementation.",
    expectedFutureInvariant:
      "Changing SessionRole.privateInstructions (loaded but not prompted) leaves fingerprint, AI currentness, and publication unchanged.",
    availableNextActions: ["Apply the controlled non-material field mutation"],
  },
  F05: {
    id: "F05",
    title: "Canonical transcription vs old-route competing-writer fixture",
    enhancement: "COMPLETED",
    mapping: "AUTO_SUGGESTED_COMPLETE",
    ai: "none",
    expectedCurrentUi:
      "Normal materials UI uses canonical /materials/transcribe. The old /transcribe-recording URL remains reachable but is not a silent fallback.",
    knownDefect:
      "None after Phase F. /transcribe-recording is a CANONICAL_ADAPTER and shares the Session claim.",
    expectedFutureInvariant:
      "Old route remains a compatibility adapter, not a silent fallback. Normal UI still does not use it.",
    availableNextActions: [
      "Confirm materials does not auto-call /transcribe-recording",
      "Later prove a concurrent old-route request cannot overwrite this generation",
    ],
  },
  AM01: {
    id: "AM01",
    title: "Strong remote 2x2 pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "After the real algorithm: AUTO_SUGGESTED complete mapping, confirmation timestamps still null.",
    knownDefect: "None for the strong remote path; later presentation should treat this as advisory.",
    expectedFutureInvariant:
      "Algorithm remains AUTO_SUGGESTED. Start AI later persists CONFIRMED. Algorithm itself must not write CONFIRMED.",
    availableNextActions: ["Inspect materials rail after real auto-mapping"],
  },
  AM02: {
    id: "AM02",
    title: "Local mic fallback pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Remote telemetry absent; real fallback selects local Vox/mic and auto-applies if unambiguous.",
    knownDefect: "None intended; this is the real remote→local→review fallback, not /transcribe-recording.",
    expectedFutureInvariant: "Local fallback still produces structurally complete AUTO_SUGGESTED.",
    availableNextActions: ["Confirm selected source is VOXIMPLANT_MIC_ACTIVITY"],
  },
  AM03: {
    id: "AM03",
    title: "Low margin / ambiguous pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "No unsafe AUTO_SUGGESTED. Review/required state. AI blocked.",
    knownDefect: "None if review is required; unsafe auto-apply would be a defect.",
    expectedFutureInvariant: "Ambiguous telemetry remains action_required and AI-blocked.",
    availableNextActions: ["Inspect review copy on materials"],
  },
  AM04: {
    id: "AM04",
    title: "Many-to-one safety pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Collapsed/many-to-one mapping is not auto-applied.",
    knownDefect:
      "Current solver rejects this at source selection (no_reliable_telemetry_source) because a usable source must already be 1:1, rather than applying and then storing many_to_one_*.",
    expectedFutureInvariant: "One-to-one/many-to-one safety still prevents unsafe auto-apply.",
    availableNextActions: ["Inspect review state"],
  },
  AM04B: {
    id: "AM04B",
    title: "Many-to-one decision-core coverage",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "AM04 input stays unapplied. Decision core independently rejects a constructed many-to-one mapping.",
    knownDefect:
      "AM04 is stopped at source selection. AM04B covers evaluateMappingSafety + decideAutoMappingApplication, which AM04 never reaches.",
    expectedFutureInvariant:
      "Many-to-one remains unsafe at the apply decision even if source selection later changes.",
    availableNextActions: ["Keep AM04B green before any mapping-safety cleanup"],
  },
  AM05: {
    id: "AM05",
    title: "One unresolved speaker pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Structurally incomplete. AI blocked.",
    knownDefect: "None if AI stays blocked.",
    expectedFutureInvariant: "Canonical completeness blocks AI while a spoken speaker is unresolved.",
    availableNextActions: ["Inspect incomplete mapping UI"],
  },
  AM06: {
    id: "AM06",
    title: "Strong 3x3 pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Real global assignment maps three speakers to three participants.",
    knownDefect: "None for the strong 3x3 path.",
    expectedFutureInvariant: "Production global assignment remains the source of truth.",
    availableNextActions: ["Inspect three-speaker mapping"],
  },
  AM07: {
    id: "AM07",
    title: "Room presence vs invited candidate pool",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Invitee without room entry is excluded. Auto-mapping AUTO_SUGGESTED for A/B.",
    knownDefect:
      "Approved Stage 3.15A fix: auto and GET now share loadCanonicalSpeakerMappingCandidates.",
    expectedFutureInvariant:
      "Never-entered invitees must not reduce coverage or block a valid 2x2 mapping.",
    availableNextActions: ["Compare invited vs present vs scored candidates"],
  },
  AM07A: {
    id: "AM07A",
    title: "Invited never entered",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Candidates A,B. C excluded. AUTO_SUGGESTED.",
    knownDefect: "None if C is excluded and A/B auto-map.",
    expectedFutureInvariant: "Invitation alone is not candidacy.",
    availableNextActions: ["Inspect candidate set vs invitee"],
  },
  AM07B: {
    id: "AM07B",
    title: "Entered then disconnected",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Disconnected seller remains a historical-presence candidate.",
    knownDefect: "None if B stays a candidate.",
    expectedFutureInvariant: "Do not require current connection.",
    availableNextActions: ["Inspect disconnected seller mapping"],
  },
  AM07C: {
    id: "AM07C",
    title: "No valid room presence",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Never-entered seller is not a speaker-mapping candidate.",
    knownDefect: "None if seller is excluded.",
    expectedFutureInvariant: "No room-entry evidence means no candidacy.",
    availableNextActions: ["Inspect candidate set"],
  },
  AM07D: {
    id: "AM07D",
    title: "Facilitator observer present",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Staff presence does not create negotiation speaker candidates.",
    knownDefect: "None if only buyer/seller are candidates.",
    expectedFutureInvariant: "Preserve PARTICIPANT eligibility.",
    availableNextActions: ["Inspect candidate types"],
  },
  AM07E: {
    id: "AM07E",
    title: "Auto and review candidate parity",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Automatic candidate IDs equal GET /speaker-mapping review IDs.",
    knownDefect: "None if parity holds.",
    expectedFutureInvariant: "One canonical candidate population.",
    availableNextActions: ["Compare auto diagnostics vs GET participants"],
  },
  AM08: {
    id: "AM08",
    title: "Remote / local disagreement pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Current conservative source-selection decides; do not force AUTO_SUGGESTED.",
    knownDefect: "None if disagreement stays review-required.",
    expectedFutureInvariant: "Disagreement without a clear winner remains manual review.",
    availableNextActions: ["Inspect selected source and diagnostics"],
  },
  AM09: {
    id: "AM09",
    title: "Single speaker edge pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "SINGLE_SPEAKER_ONLY / insufficient multi-speaker remains review. No invented second assignment.",
    knownDefect: "None if no second participant is fabricated.",
    expectedFutureInvariant: "Single-speaker representation stays review-required.",
    availableNextActions: ["Inspect single-speaker review UI"],
  },
  AM10: {
    id: "AM10",
    title: "No usable diarization pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi: "Automatic mapping is not fabricated. Manual attribution remains available.",
    knownDefect: "None if mapping is not invented.",
    expectedFutureInvariant: "No-diarization stays a manual path.",
    availableNextActions: ["Inspect transcript without auto mapping"],
  },
  AM11: {
    id: "AM11",
    title: "2x2 global-margin override pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Historical 2x2 global-margin override is actually reached and auto-applies when current production allows it.",
    knownDefect: "Do not delete/consolidate this override before this scenario is green.",
    expectedFutureInvariant: "Override remains reachable with exact local/global diagnostics.",
    availableNextActions: ["Inspect override diagnostics and AUTO_SUGGESTED result"],
  },
  AM12: {
    id: "AM12",
    title: "Confidence boundary sibling pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Below AUTO_MAPPING_HIGH_CONFIDENCE stays review; above can auto-apply when other gates pass.",
    knownDefect: "None if boundary matches production constants.",
    expectedFutureInvariant: "Use production constants, never a fixture-hardcoded 0.6.",
    availableNextActions: ["Compare below/above sibling outcomes"],
  },
  AM13: {
    id: "AM13",
    title: "Margin boundary sibling pipeline",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Below AUTO_MAPPING_MIN_MARGIN stays review unless the real 2x2 override applies; above can auto-apply.",
    knownDefect: "None if boundary matches production constants.",
    expectedFutureInvariant: "Use AUTO_MAPPING_MIN_MARGIN from production.",
    availableNextActions: ["Compare below/above sibling outcomes"],
  },
  AM14: {
    id: "AM14",
    title: "Legacy LIVEKIT activity compatibility",
    fixtureClass: "PIPELINE_FIXTURE",
    enhancement: "COMPLETED",
    mapping: "REQUIRED",
    ai: "none",
    expectedCurrentUi:
      "Historical LIVEKIT_ACTIVE_SPEAKER rows must not crash the current reader. Current solver evaluates remote/local Vox sources only.",
    knownDefect:
      "Current production does not score LIVEKIT_ACTIVE_SPEAKER; this is compatibility-only evidence.",
    expectedFutureInvariant: "Do not change the algorithm to optimize this historical fixture.",
    availableNextActions: ["Confirm no fabricated AUTO_SUGGESTED from LIVEKIT-only rows"],
  },
};

export function isPostTranscriptionLabScenarioId(
  value: string,
): value is PostTranscriptionLabScenarioId {
  return (POST_TRANSCRIPTION_LAB_SCENARIO_IDS as readonly string[]).includes(value);
}

export function getLabScenario(
  id: string,
): PostTranscriptionLabScenarioDefinition {
  const normalized = id.trim().toUpperCase();
  if (!isPostTranscriptionLabScenarioId(normalized)) {
    throw new Error(
      `Unknown Post-processing Facilitator Lab scenario "${id}". Expected one of: ${POST_TRANSCRIPTION_LAB_SCENARIO_IDS.join(", ")}`,
    );
  }
  return {
    ...SCENARIOS[normalized],
    fixtureClass: SCENARIOS[normalized].fixtureClass ?? "STATE_FIXTURE",
  };
}

export function isPipelineLabScenario(id: string): boolean {
  return getLabScenario(id).fixtureClass === "PIPELINE_FIXTURE";
}

export function parseLabScenarioIds(raw: string | undefined): PostTranscriptionLabScenarioId[] {
  const tokens = (raw ?? "")
    .split(/[\s,]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    return ["S10"];
  }
  return tokens.map((token) => getLabScenario(token).id);
}
