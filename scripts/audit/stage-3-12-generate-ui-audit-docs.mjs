import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const auditDir = path.join(root, "docs", "audits", "stage-3-12-ui-ux-audit");
const artifactDir = path.join(root, "artifacts", "ui-audit");
mkdirSync(auditDir, { recursive: true });
mkdirSync(path.join(artifactDir, "screenshots"), { recursive: true });
mkdirSync(path.join(artifactDir, "metrics"), { recursive: true });
mkdirSync(path.join(artifactDir, "traces"), { recursive: true });

const baseSha = "ae4bbf4ff13d94155652b335866c99ec116d9a34";
const productionSyncEvidence = [
  "Production branch check returned `deploy/yandex-poc`.",
  "Production status was clean.",
  "Production HEAD was already `ae4bbf4ff13d94155652b335866c99ec116d9a34`.",
  "Production remote `origin/deploy/yandex-poc` was `ae4bbf4ff13d94155652b335866c99ec116d9a34`.",
  "Because the server was already at the documentation-only SHA rather than the older expected `45feca7b46b89d08775ab799a4e95f235f9ebe9e`, the remote fast-forward substep was not run.",
].join("\n");

const findings = [
  ["UI-F001", "Dashboard completed work competes with next action", "Dashboard", "S3", "Design weakness", "UIAUD-DASH-020", "Active and completed sessions share similar card weight; completed sessions are included in dashboard source mapping.", "Segment scheduled/current/archive and de-emphasize historical items."],
  ["UI-F002", "Dashboard has no safe reserved lanes for future stats/messages", "Dashboard", "S3", "Future IA requirement", "UIAUD-DASH-020", "Dashboard source has active events, active sessions, completed sessions, hosted events, and one continue item; no reserved density model for progress or messages.", "Define dashboard lanes before adding statistics or messages."],
  ["UI-F003", "List filters are consistent but too footprint-heavy", "Cases/Events/Sessions", "S3", "Design weakness", "UIAUD-FILTER-001 UIAUD-FILTER-002 UIAUD-FILTER-003", "Cases, Events, and Sessions all render full chip groups in `ListFilterBar` with search plus several visible filters.", "Collapse advanced filters behind a compact toolbar with active-filter chips."],
  ["UI-F004", "Lobby management and room entry share one long vertical stack", "Event lobby", "S2", "Observed defect", "UIAUD-LOBBY-050", "Host controls, case library, assignment, participant status, sessions, and room actions are all in the same scroll flow.", "Separate management controls from persistent room-access controls."],
  ["UI-F005", "Critical room-entry controls can fall below unrelated lobby content", "Event lobby", "S2", "Observed defect", "UIAUD-LOBBY-050 UIAUD-LOBBY-MOB-001", "Long participant lists and assignment controls precede or surround session room CTAs.", "Use a sticky/current-room action zone or a compact session board."],
  ["UI-F006", "Different session destinations share identical primary visual treatment", "Lobby/Lists/Room", "S2", "Observed defect", "UIAUD-LOBBY-050 UIAUD-FILTER-002", "`EventSessionRoomButton` renders open room, return to debrief, open materials, and open results as `GradientButtonLink`.", "Introduce a semantic action taxonomy separating progression, navigation, materials, and completion."],
  ["UI-F007", "Participant status text repeats role, name, status, and assignment", "Event lobby", "S3", "Design weakness", "UIAUD-LOBBY-050", "Lobby participant strings combine system role, slot, display name, case role, and location.", "Create a reusable persona/role row with concise text plus accessible state badges."],
  ["UI-F008", "Event assignment UI does not scale gracefully to 50-100 people", "Event lobby", "S2", "Scalability risk", "UIAUD-LOBBY-050", "Assignment controls are select/list based and remain inline with room setup.", "Move assignment into a roster/room-management workspace or drawer."],
  ["UI-F009", "Mobile/narrow lobby relies on long document scroll for management", "Event lobby", "S3", "Observed defect", "UIAUD-LOBBY-MOB-001", "Mobile evidence keeps management, participants, room controls, and status in one page flow.", "Preserve critical actions at top and collapse advanced management sections."],
  ["UI-F010", "Archive/history has excessive visual weight", "Dashboard", "S3", "Design weakness", "UIAUD-DASH-020", "Completed sessions are mapped into dashboard alongside active work and use the same card language.", "Use compact archive rows or collapsible history."],
  ["UI-F011", "Current room layout is two-slot, not an eight-negotiator gallery", "Negotiation room", "S2", "Scalability defect", "UIAUD-SCALE-008", "`resolveRosterVisualRoles` resolves only `participant_a` and `participant_b`; overflow assigned negotiators become `unknown`.", "Design a stable 2-8 negotiator grid before implementation."],
  ["UI-F012", "Observer row can grow and compete with the negotiation stage", "Negotiation room", "S2", "Scalability risk", "UIAUD-SCALE-008", "`VoximplantVideoLayout` renders observer tiles in a wrapping row above the main participant stage.", "Use a dedicated scrollable observer roster that does not shrink the negotiator stage."],
  ["UI-F013", "Observer prioritization lacks a complete stable product state", "Negotiation room", "S3", "Missing product decision", "UIAUD-SCALE-008", "Media status stores camera/mic by participant in `AppSetting`; audio activity exists, but observer active-speaker prioritization is not exposed as a stable roster field.", "Define priority inputs and anti-jump rules before sorting observers."],
  ["UI-F014", "Same case content is rendered by several components with different hierarchy", "Preparation/Debrief/Materials", "S3", "Design weakness", "UIAUD-DEBRIEF-001 UIAUD-MATERIALS-001", "`RoleBriefingCard`, `RoomSidebar`, materials views, observer materials, and join pages each render case context/role details differently.", "Create a shared case-content presentation contract after audit."],
  ["UI-F015", "Debrief, materials, and recording states are visually close to navigation states", "Debrief/Materials", "S3", "Observed defect", "UIAUD-DEBRIEF-001 UIAUD-MATERIALS-001", "Return to lobby, open materials, debrief, recording finalizing, and leave controls appear near each other with limited semantic separation.", "Distinguish review/materials destinations from active room entry and leave actions."],
  ["UI-F016", "Right sidebar has independent scroll but competes with video width", "Negotiation room", "S3", "Design weakness", "UIAUD-SCALE-008", "`SharedRoomShell` fixes right panel width at `28rem`/`32rem` and hides it below large breakpoint.", "Keep one panel with tabs or collapsible sections; preserve stable video area."],
  ["UI-F017", "Role/name/case-role labels create high textual noise", "Roles and labels", "S3", "Design weakness", "UIAUD-LOBBY-050 UIAUD-SCALE-008", "The same person can be represented by system role, slot, display name, case role, location, camera, mic, and assignment text.", "Adopt one role/persona format with accessible badges and optional details."],
  ["UI-F018", "Desired-role selector is too prominent after selection", "Event lobby", "S4", "Design weakness", "UIAUD-LOBBY-050", "Desired role is rendered as a full control even after the interaction becomes infrequent.", "Use a compact persona/status control with discoverable change action."],
  ["UI-F019", "Visual language depends on local glass/card styles rather than documented tokens", "Brand/visual system", "S3", "Design weakness", "UIAUD-DASH-020 UIAUD-LOBBY-050", "Reusable tokens exist (`btn-gradient`, `btn-secondary`, GlassCard), but component-level spacing, cards, badges, and gradients vary by surface.", "Document restrained tokens for action hierarchy, surfaces, spacing, and status."],
  ["UI-F020", "Accessibility coverage is structural, not automated WCAG-scanned", "Accessibility", "S3", "Missing test coverage", "UIAUD-A11Y-001", "`@axe-core/playwright` is not installed; current audit uses structural checks for names, target size, focus sample, headings, landmarks, overflow, and clipping.", "Add an a11y dependency in a separate decision and keep structural checks."],
];

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(headers, rows) {
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvEscape(row[header] ?? "")).join(",")).join("\n")}\n`;
}

const scenarioRows = [
  ["UIAUD-DASH-001","dashboard","participant","participant","LOBBY_OPEN","OPEN",0,0,0,"n/a","n/a","none","none","none","ru","1440x900","chromium","empty","Create or join next item","yes","planned","No zero-data screenshot captured in focused run","NOT_RUN",""],
  ["UIAUD-DASH-002","dashboard","participant","participant","LOBBY_OPEN","OPEN",1,2,0,"mixed","mixed","assigned","none","none","ru","1440x900","chromium","low","Open lobby or room","yes","planned","Pairwise only","NOT_RUN",""],
  ["UIAUD-DASH-020","dashboard","owner","event-owner","mixed","mixed",6,8,20,"mixed","mixed","mixed","mixed","mixed","ru","1440x900","chromium","20 mixed items","Continue next negotiation","yes","yes","Captured in focused audit run","OBSERVED","UI-F001 UI-F002 UI-F010"],
  ["UIAUD-DASH-050","dashboard","owner","event-owner","mixed","mixed",10,8,50,"mixed","mixed","mixed","mixed","mixed","en","1440x900","chromium","50 mixed items","Continue next negotiation","yes","planned","Documented as extension of 20-item run","PARTIAL","UI-F001 UI-F010"],
  ["UIAUD-FILTER-001","events-list","list-filtering","event-owner","mixed","n/a",6,0,50,"n/a","n/a","mixed","n/a","n/a","ru","1440x900","chromium","dense","Open active event","yes","yes","Captured","OBSERVED","UI-F003"],
  ["UIAUD-FILTER-002","sessions-list","list-filtering","facilitator","mixed","mixed",6,8,20,"mixed","mixed","mixed","mixed","mixed","ru","1440x900","chromium","dense","Open room or materials","yes","yes","Captured","OBSERVED","UI-F003 UI-F006"],
  ["UIAUD-FILTER-003","cases-list","list-filtering","facilitator","n/a","n/a",0,0,0,"n/a","n/a","n/a","n/a","n/a","ru","1440x900","chromium","dense","View case","yes","yes","Captured","OBSERVED","UI-F003"],
  ["UIAUD-LOBBY-001","event-lobby","participant","participant","LOBBY_OPEN","OPEN",1,2,0,"mixed","mixed","assigned","none","none","ru","1440x900","chromium","low","Enter assigned room","yes","planned","Pairwise only","NOT_RUN",""],
  ["UIAUD-LOBBY-008","event-lobby","owner","event-owner","LOBBY_OPEN","mixed",8,8,8,"mixed","mixed","mixed","mixed","none","ru","1440x900","chromium","medium","Create or enter session","yes","planned","Covered by 50-person stress run","PARTIAL","UI-F004 UI-F005"],
  ["UIAUD-LOBBY-050","event-lobby","owner","event-owner","LOBBY_OPEN","mixed",4,8,42,"mixed","mixed","mixed","mixed","mixed","ru","1440x900","chromium","50 people","Enter current room","yes","yes","Captured","OBSERVED","UI-F004 UI-F005 UI-F006 UI-F007 UI-F008"],
  ["UIAUD-LOBBY-100","event-lobby","owner","event-owner","LOBBY_OPEN","mixed",12,8,92,"mixed","mixed","mixed","mixed","mixed","ru","1440x900","chromium","100 people","Enter current room","yes","planned","Not captured; fixture supports seeding without 100 browsers","NOT_RUN","UI-F008"],
  ["UIAUD-LOBBY-MOB-001","event-lobby","owner","event-owner","LOBBY_OPEN","mixed",4,8,42,"mixed","mixed","mixed","mixed","mixed","ru","390x844","chromium","50 people mobile","Enter current room","yes","yes","Captured","OBSERVED","UI-F004 UI-F005 UI-F009"],
  ["UIAUD-SCALE-002","negotiation-room","participant","participant","LOBBY_OPEN","OPEN",1,2,0,"mixed","mixed","assigned","none","none","en","1440x900","chromium","2 negotiators","Start preparation","yes","planned","Baseline source-supported","NOT_RUN",""],
  ["UIAUD-SCALE-003","negotiation-room","participant","participant","LOBBY_OPEN","OPEN",1,3,0,"mixed","mixed","assigned","none","none","en","1440x900","chromium","3 negotiators","Start preparation","yes","source","Source shows two-slot limit","PARTIAL","UI-F011"],
  ["UIAUD-SCALE-004","negotiation-room","participant","participant","LOBBY_OPEN","OPEN",1,4,4,"mixed","mixed","assigned","none","none","en","1440x900","chromium","4 negotiators","Start preparation","yes","source","Source shows two-slot limit","PARTIAL","UI-F011 UI-F012"],
  ["UIAUD-SCALE-005","negotiation-room","participant","participant","LOBBY_OPEN","OPEN",1,5,8,"mixed","mixed","assigned","none","none","en","1440x900","chromium","5 negotiators","Start preparation","yes","source","Source shows two-slot limit","PARTIAL","UI-F011 UI-F012"],
  ["UIAUD-SCALE-006","negotiation-room","participant","participant","LOBBY_OPEN","OPEN",1,6,12,"mixed","mixed","assigned","none","none","en","1440x900","chromium","6 negotiators","Start preparation","yes","source","Source shows two-slot limit","PARTIAL","UI-F011 UI-F012"],
  ["UIAUD-SCALE-007","negotiation-room","participant","participant","LOBBY_OPEN","OPEN",1,7,20,"mixed","mixed","assigned","none","none","en","1440x900","chromium","7 negotiators","Start preparation","yes","source","Source shows two-slot limit","PARTIAL","UI-F011 UI-F012"],
  ["UIAUD-SCALE-008","negotiation-room","facilitator","facilitator","LOBBY_OPEN","OPEN",1,8,20,"mixed","mixed","assigned","none","none","en","1440x900","chromium","8 negotiators 20 observers","Manage room","yes","yes","Captured plus source audit","OBSERVED","UI-F011 UI-F012 UI-F013 UI-F016"],
  ["UIAUD-OBS-000","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,2,0,"n/a","n/a","observer","none","none","en","1440x900","chromium","0 observers","Observe room","yes","planned","Pairwise only","NOT_RUN",""],
  ["UIAUD-OBS-001","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,2,1,"mixed","mixed","observer","none","none","en","1440x900","chromium","1 observer","Observe room","yes","planned","Pairwise only","NOT_RUN",""],
  ["UIAUD-OBS-004","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,4,4,"mixed","mixed","observer","none","none","en","1440x900","chromium","4 observers","Observe room","yes","planned","Covered by debrief/materials run","PARTIAL","UI-F012"],
  ["UIAUD-OBS-008","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,4,8,"mixed","mixed","observer","none","none","en","1440x900","chromium","8 observers","Observe room","yes","planned","Pairwise only","NOT_RUN","UI-F012"],
  ["UIAUD-OBS-012","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,6,12,"mixed","mixed","observer","none","none","en","1440x900","chromium","12 observers","Observe room","yes","source","Source row wraps","PARTIAL","UI-F012 UI-F013"],
  ["UIAUD-OBS-030","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,8,30,"mixed","mixed","observer","none","none","en","1440x900","chromium","30 observers","Observe room","yes","planned","No 30-browser launch; deterministic state only","PARTIAL","UI-F012 UI-F013"],
  ["UIAUD-OBS-050","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,8,50,"mixed","mixed","observer","none","none","en","1440x900","chromium","50 observers","Observe room","yes","planned","No 50-browser launch; deterministic state only","PARTIAL","UI-F012 UI-F013"],
  ["UIAUD-OBS-100","negotiation-room","observer","observer","LOBBY_OPEN","OPEN",1,8,100,"mixed","mixed","observer","none","none","en","1440x900","chromium","100 observers","Observe room","yes","planned","No 100-browser launch; deterministic state only","PARTIAL","UI-F012 UI-F013"],
  ["UIAUD-DEBRIEF-001","debrief","facilitator","facilitator","SESSION_CREATED","DEBRIEF_OPEN",1,2,4,"off","off","assigned","processing","processing","en","1440x900","chromium","medium","Review debrief","yes","yes","Captured","OBSERVED","UI-F014 UI-F015"],
  ["UIAUD-MATERIALS-001","materials","facilitator","facilitator","SESSION_CREATED","CLOSED",1,2,4,"off","off","assigned","completed","completed","en","1440x900","chromium","medium","Open materials","yes","yes","Captured","OBSERVED","UI-F015"],
  ["UIAUD-A11Y-001","all","keyboard-a11y","mixed","mixed","mixed",4,8,20,"mixed","mixed","mixed","mixed","mixed","ru/en","100-200% zoom","chromium","mixed","Reach primary action","no","structural","No axe dependency installed","PARTIAL","UI-F020"],
];

const scenarioHeaders = [
  "scenarioId","surface","journey","role","eventLifecycle","sessionLifecycle","sessionCount","negotiatorCount","observerCount","cameraState","microphoneState","assignmentState","materialsState","recordingStopState","language","viewport","browser","dataDensity","expectedPrimaryAction","screenshotExpected","automated","limitations","result","findingIds",
];
const scenarioObjects = scenarioRows.map((row) => Object.fromEntries(scenarioHeaders.map((header, index) => [header, row[index]])));

const hypothesisRows = [
  ["POH-001","dashboard","Dashboard overloaded by historical Events and Sessions","CONFIRMED","UI-F001 UI-F010","UI-F001 UI-F010","Segment current/scheduled/archive; collapse archive","High"],
  ["POH-002","dashboard","Future separation of scheduled items, archive, statistics and messages","CONFIRMED","UI-F002","UI-F002","Reserve dashboard lanes before adding stats/messages","High"],
  ["POH-003","lists","Oversized and confusing filters","PARTIALLY_CONFIRMED","Filters are consistent but consume large vertical/visual footprint","UI-F003","Compact toolbar plus active chips","High"],
  ["POH-004","room","Room scaling for 2–8 negotiators","CONFIRMED","Two-slot layout source cannot represent 3–8 negotiators safely","UI-F011","Design stable 2–8 grid model","High"],
  ["POH-005","room","Unlimited observer scaling","CONFIRMED","Observer row wraps and can compete with stage","UI-F012","Dedicated scrollable observer roster","High"],
  ["POH-006","room","Observer prioritization","BLOCKED_BY_MISSING_STATE","Camera/mic state exists; active priority requires additional product/runtime state","UI-F013","Define priority inputs and anti-jump policy","Medium"],
  ["POH-007","room","Right-side independent scrolling","PARTIALLY_CONFIRMED","Right panel scroll exists, but fixed width competes with video area","UI-F016","Tabbed/collapsible panel with stable stage","High"],
  ["POH-008","lobby","Duplicated lobby room-entry buttons","PARTIALLY_CONFIRMED","Duplicate visual treatment is confirmed; exact duplicate destinations depend on role/state","UI-F004 UI-F006","Single current-room action area","High"],
  ["POH-009","lobby","Room-entry controls disappearing below long content","CONFIRMED","Long people/sessions stack pushes controls into page scroll","UI-F005","Sticky session action strip or board","High"],
  ["POH-010","actions","Oversized button typography","PARTIALLY_CONFIRMED","Typography is not universally oversized; label length and primary weight cause more risk","UI-F006 UI-F018","Shorter labels plus semantic variants","Medium"],
  ["POH-011","actions","Room/material/lobby actions looking identical","CONFIRMED","Primary gradient used across contradictory destinations","UI-F006 UI-F015","Semantic action taxonomy","High"],
  ["POH-012","roles","Overloaded participant status text","CONFIRMED","Role/name/location/case-role repeated in lobby and room","UI-F007 UI-F017","Persona row pattern","High"],
  ["POH-013","lobby","Confusing Event management area","CONFIRMED","Case library, assignment, session creation, room entry share one stack","UI-F004 UI-F008","Separate setup, roster, and room access","High"],
  ["POH-014","lobby","Participant assignment at scale","CONFIRMED","Select/list assignment does not scale to 50-100 people","UI-F008","Roster assignment workspace","High"],
  ["POH-015","lobby","Possible combined roster and assignment interface","CONFIRMED","Evidence supports a roster model, but not necessarily a full board rewrite first","UI-F008","Moderate roster/drawer option","Medium"],
  ["POH-016","case content","Inconsistent Case description between preparation and debrief","CONFIRMED","Multiple components render same source content with different hierarchy","UI-F014","Shared case content contract","High"],
  ["POH-017","lobby","Oversized desired-role selector","PARTIALLY_CONFIRMED","Interaction is important pre-selection but over-weighted afterwards","UI-F018","Compact persona/status control","Medium"],
  ["POH-018","branding","Need restrained visual branding","CONFIRMED","Current language is coherent but locally varied and card-heavy","UI-F019","Document tokens; avoid redesign","Medium"],
  ["POH-019","roles","Excessive role/name/case-role text","CONFIRMED","Repeated labels increase scan cost","UI-F017","Consistent persona/role format","High"],
  ["POH-020","roles","Possible role icons with accessible text equivalents","PARTIALLY_CONFIRMED","Icons can reduce noise but must not be sole meaning; binoculars-like observer icon has comprehension risk","UI-F017 UI-F020","Text badge, tooltip, and aria-label","Medium"],
].map(([hypothesisId, area, originalObservation, auditStatus, evidence, findingIds, recommendedDirection, confidence]) => ({
  hypothesisId, area, originalObservation, auditStatus, evidence, findingIds, recommendedDirection, confidence,
}));

const actionRows = [
  ["join room","dashboard/events/sessions/lobby/materials","AccountDashboardView, SessionsListView, EventSessionRoomButton, SharedRoomShell","Open room / Join video room / Открыть","none","primary/gradient or list primary","cyan gradient or cyan chip","progression","Multiple entry points and variants"],
  ["return to lobby","room/debrief","SharedRoomShell, SessionClosedOverlay","Back to lobby / Вернуться","none","secondary or gradient in overlay","slate or gradient","navigation","Overlay variant can compete with materials"],
  ["return to debrief","lobby/session action","EventSessionRoomButton","Return to debrief","none","gradient","primary gradient","review destination","Same as open room"],
  ["open materials","dashboard/sessions/lobby/room/debrief","AccountDashboardView, SessionsListView, EventSessionRoomButton, SharedRoomShell","Open materials / Session materials","none","secondary/list or gradient","mixed","materials/history","Same as active room in lobby resolution"],
  ["create Session","event lobby","EventHostControlsPanel","Create session / Создать ещё одну сессию","none","gradient","primary gradient","creation","Label should become Create session"],
  ["edit Event","events list","EventsListView","Edit","none","secondary list","slate","management","OK"],
  ["finish Session","room","FacilitatorRoomControls","Finish","none","primary/control","varies","lifecycle progression","Needs warning semantics"],
  ["complete Event","events list/lobby","EventsListView, EventCompletionDangerZone","Complete","none","dangerOutline/danger","rose","destructive/completion","Mostly clear but competes in dense action group"],
  ["leave","room/debrief","VoximplantLeaveButton, SessionClosedOverlay","Leave","none","secondary","slate","exit","Can appear near materials/lobby actions"],
  ["manage participants","lobby/room sidebar","EventHostControlsPanel, SessionRoleManagementPanel","Participant roles / assign","none","forms/selects","neutral","management","Scale risk"],
  ["select desired role","event lobby","EventLobbyView","Play / Observe / Facilitate","none","full-size control","neutral/primary","preference","Too prominent after selection"],
  ["assign user","event lobby/room sidebar","EventHostControlsPanel, SessionRoleManagementPanel","Role select","none","select control","native","management","Needs roster pattern at scale"],
  ["unassign user","event lobby/room sidebar","EventHostControlsPanel, SessionRoleManagementPanel","Clear / unassign","none","select/control","native","management","State feedback must remain visible"],
  ["recording controls","room","RecordingIndicator, Voximplant recording controls","Recording / stop","status icon/text","status/control","mixed","recording lifecycle","Server-side stop semantics must not change"],
  ["retry/review failed processing","materials","RecordingTranscriptionSection, SessionMaterialsDashboard","Retry / Analyze / Review","none","secondary/primary","mixed","post-processing","Needs distinct failure state"],
].map(([action,page,component,visibleLabel,icon,buttonVariant,computedTreatment,classification,risk]) => ({
  action,page,component,visibleLabel,icon,buttonVariant,computedTreatment,classification,risk,
}));

const backlogRows = [
  ["W1-001","UI-F006 UI-F015","Define semantic action taxonomy and apply to lobby/session/material CTAs","Wave 1","M","High","Medium","EventSessionRoomButton, list action buttons, SharedRoomShell"],
  ["W1-002","UI-F004 UI-F005","Add one persistent current-room action area in lobby","Wave 1","M","High","Medium","EventLobbyView, EventHostControlsPanel"],
  ["W1-003","UI-F007 UI-F017","Introduce compact persona/role display rules","Wave 1","M","High","Low","EventLobbyView, room roster labels"],
  ["W1-004","UI-F018","Compress desired-role selector after selection","Wave 1","S","Medium","Low","EventLobbyView"],
  ["W1-005","UI-F010","De-emphasize archive/history on dashboard","Wave 1","S","Medium","Low","AccountDashboardView"],
  ["W2-001","UI-F003","Replace full filter panels with compact toolbar/disclosure","Wave 2","M","High","Medium","ListFilterBar, Cases/Events/Sessions views"],
  ["W2-002","UI-F008","Create scalable roster/assignment management surface","Wave 2","L","High","Medium","EventHostControlsPanel"],
  ["W2-003","UI-F011 UI-F012 UI-F016","Design stable 2-8 negotiator grid and observer side roster","Wave 2","L","High","High","VoximplantVideoLayout, SharedRoomShell"],
  ["W2-004","UI-F014","Create shared case-content presentation component","Wave 2","M","Medium","Medium","RoleBriefingCard, RoomSidebar, materials views"],
  ["W3-001","UI-F002","Add dashboard progress/stat/message lanes only after IA is reserved","Wave 3","L","Medium","Medium","Dashboard"],
  ["W3-002","UI-F013","Define active observer priority model and backend state","Wave 3","XL","Medium","High","media status, audio activity, room roster"],
  ["W3-003","UI-F008 UI-F012","Virtualize observer/people rosters for 100+ people","Wave 3","L","Medium","Medium","Lobby roster, room observer roster"],
].map(([id, findingIds, title, wave, effort, value, regressionRisk, affectedComponents]) => ({
  id, findingIds, title, wave, effort, value, regressionRisk, affectedComponents,
}));

const scorecard = [
  "Dashboard: 3/5. Next action exists, but archive/history competes with active work.",
  "Lists and filters: 3/5. Consistent implementation, high footprint.",
  "Event lobby: 2/5. Management, roster, and room entry are crowded together.",
  "Negotiation room: 2/5. Current source model supports two named negotiator slots, not 2-8.",
  "Debrief: 3/5. State is reachable, but review/material/navigation semantics are close together.",
  "Role clarity: 3/5. Complete information exists, but repeated text slows scanning.",
  "Action hierarchy: 2/5. Materially different destinations share primary treatment.",
  "Scale: 2/5. Many observers/people expose scroll and stage competition risks.",
  "Accessibility: 3/5. Focus and labels are present in many controls; structural automated coverage is incomplete.",
  "Brand consistency: 3/5. Recognizable dark/glass language exists, but tokens are not documented enough.",
].join("\n");

function findingMarkdown() {
  return findings.map(([id, title, surface, severity, type, scenarios, evidence, direction]) => `### ${id} — ${title}
- Surface: ${surface}
- Affected roles: mixed by scenario; see scenario IDs.
- Affected states: see scenario matrix.
- Severity: ${severity}
- Frequency: ${type === "Scalability risk" ? "Scale-dependent" : "Common on affected surface"}
- Evidence: ${evidence}
- Scenario IDs: ${scenarios}
- Screenshot references: \`artifacts/ui-audit/screenshots/\` where captured by scenario ID.
- Source components: see \`01-current-ui-architecture.md\`.
- Root cause: ${type}
- User impact: Slower scanning, hidden or ambiguous next action, or unusable scale state.
- Operational impact: Higher facilitation burden and support risk during live trainings.
- Accessibility impact: Higher cognitive load; some findings also affect keyboard/reflow semantics.
- Recommended direction: ${direction}
- Alternative options: minimal correction, moderate component restructuring, or future IA model are compared in \`14-recommendation-options.md\`.
- Architecture risk: preserve Stage 3.10 lifecycle/provider semantics; avoid provider rewrites.
- Estimated effort: ${severity === "S2" ? "M-L" : "S-M"}
- Confidence: ${type === "Missing product decision" ? "Medium" : "High"}
- Acceptance criteria: evidence scenario no longer reproduces the issue; no lifecycle, recording, presence, reconnect, or provider contract changes.
`).join("\n");
}

const files = {
  "00-executive-summary.md": `# Stage 3.12A UI/UX Audit Executive Summary

Base branch: \`origin/deploy/yandex-poc\`
Base SHA: \`${baseSha}\`
Audit branch: \`audit/stage-3-12-ui-ux-audit\`
Audit worktree: \`C:\\Projects\\Negotiations AI\\negotiations-web-ui-ux-audit\`

## Five Most Important Problems
1. The negotiation room source model is still a two-slot participant layout, so it does not safely scale to 3-8 negotiators.
2. Event lobby management, assignment, participant status, and room-entry actions share one crowded vertical flow.
3. Room, debrief, materials, and results actions can look like the same primary action.
4. Observer scaling uses a wrapping visual row and lacks a stable independent roster model.
5. Dashboard and list pages are functional but too dense for future stats, messages, archive, and high-volume history.

## Hypothesis Results
Confirmed: dashboard archive overload, future dashboard separation, 2-8 negotiator scaling gap, observer scaling gap, room-entry visibility, action semantic conflict, overloaded participant status text, event management confusion, assignment at scale, case-content inconsistency, restrained branding need, role/name text overload.

Partially confirmed: filters are consistent but too large; right-side panel scroll exists but competes with video width; duplicate lobby CTAs depend on role/state; button typography risk is more about length/weight than font size alone; desired-role selector is important before selection but too prominent afterward; role icons are useful only with accessible text.

Not confirmed: no supplied hypothesis was fully rejected by current evidence.

Blocked by missing state: active observer prioritization needs a product/runtime state definition before implementation.

## Direct Answers
Does the UI scale to eight negotiators? No. Source evidence in \`lib/voximplant/room-layout-model.ts\` resolves only participant A and B; extra assigned negotiators become unknown.

Does it scale to many observers? Not safely. Observers may be seeded without 100 browser contexts, but current layout places observer tiles in a wrapping row above the stage.

Critical controls that become hard to find: lobby room-entry buttons, return-to-debrief/materials actions, create-session controls in long management panels, and mobile lobby room access.

Conflicting visual semantics: open room, return to debrief, open materials, and open results all pass through the same primary gradient path in \`EventSessionRoomButton\`.

Duplicated functionality: room access appears from dashboard, event lobby, session list, materials, and room header; case content appears in join/materials/sidebar/debrief components with different hierarchy.

Safe without architecture changes: action taxonomy, duplicate CTA reduction, compact persona rows, compact desired role control, archive de-emphasis, filter disclosure, and label cleanup.

Requires backend/domain decision: observer prioritization, 2-8 negotiator layout contract, active-speaker/camera priority policy, and high-volume roster virtualization thresholds.

Wave 1 should implement semantic actions, visible room access, compact persona/status rows, desired-role compaction, archive de-emphasis, and minor labels.

Must not change: \`OPEN → DEBRIEF_OPEN → CLOSED\`, durable room leases, presence/reconnect/leave/heartbeat, server-side Voximplant recording stop, transcription/AI processing, legacy occupancy/reconciliation, provider architecture.

Missing validation: complete visual review of every pairwise viewport/language combination, full 100-observer runtime screenshot, and automated axe/WCAG scan because \`@axe-core/playwright\` is not installed.

## Scorecard
${scorecard}
`,
  "01-current-ui-architecture.md": `# Current UI Architecture

Dashboard route: \`app/(app)/dashboard/page.tsx\` maps event/session overview data into \`AccountDashboardView\`.

List routes use \`CasesListView\`, \`EventsListView\`, and \`SessionsListView\`. They share \`ListFilterBar\`, \`ListFilterGroup\`, \`ListFilterChip\`, \`ListFilterInput\`, and \`ListFilterResetButton\`.

Lobby route: \`app/events/[id]/lobby/page.tsx\` renders \`EventLobbyView\`, which owns polling, desired role preference, event state, room/session actions, lobby presence, and host controls. \`EventHostControlsPanel\` owns case selection, assignment draft, session creation, and session cards.

Room route: \`app/room/[sessionId]/page.tsx\` renders the Voximplant room through \`VoximplantNegotiationRoomPage\`, \`SharedRoomShell\`, \`VoximplantVideoLayout\`, \`FacilitatorRoomControls\`, \`RoomSidebar\`, \`DebriefPanel\`, and recording controls.

Important source evidence:
- \`EventSessionRoomButton\` renders all resolved session actions as \`GradientButtonLink\`.
- \`resolveEventSessionPrimaryAction\` distinguishes open room, return to debrief, open materials, and open results in data but not presentation.
- \`resolveRosterVisualRoles\` supports facilitator, observer, participant A, participant B, and unknown; it does not model 3-8 negotiator slots.
- \`VoximplantVideoLayout\` renders observers in \`vox-observer-row\` and participant A/B/facilitator in a fixed desktop grid.
- \`SharedRoomShell\` fixes the right sidebar at \`28rem\` or \`32rem\` and hides it under the large breakpoint.
- Camera/mic media state is stored in \`AppSetting\` documents by \`lib/voximplant/media-status-store.ts\`.
- Audio activity exists in \`SessionParticipantAudioActivity\`, but observer active-priority state is not exposed as a stable roster contract.
`,
  "02-user-journeys.md": `# User Journeys

Participant journey: dashboard to event lobby to desired role to assignment to preparation/room/debrief/materials works in broad route terms, but the next action may be visually ambiguous when lobby and materials actions share primary styling. Evidence: UI-F004, UI-F005, UI-F006, UI-F015.

Observer journey: dashboard/lobby/session selection/observation/debrief/materials is supported, but observer scaling is weak because observers appear in a wrapping row and prioritization prerequisites are not fully defined. Evidence: UI-F012, UI-F013.

Facilitator journey: dashboard/lobby/status review/assignment/session controls/finish/debrief/materials is functionally present. The high-risk points are assignment at scale, recording/debrief/materials action hierarchy, and right panel competition with the video area. Evidence: UI-F008, UI-F015, UI-F016.

Event owner journey: dashboard/lobby/create/manage sessions/monitor/complete/results is present. It needs separated management and room-access modes before high-volume events. Evidence: UI-F004, UI-F005, UI-F008.

Click count observations from captured flows:
- Dashboard to active room: one primary action when active session is first in the overview data.
- Dashboard to completed materials: one action if no active event/session is more relevant.
- Event lobby to room/debrief/materials: one action once visible, but visibility degrades with long rosters and management panels.
- Sessions list to event lobby, room, materials, or manage: one click each, but multiple compact CTAs appear in the same row.
`,
  "05-dashboard-findings.md": `# Dashboard Findings

${findingMarkdown().split("### UI-F003")[0]}
`,
  "06-filter-findings.md": `# Filter Findings

${findings.filter((f) => ["UI-F003"].includes(f[0])).map((f) => `## ${f[0]} ${f[1]}\n${f[6]}\n\nRecommendation: ${f[7]}\n`).join("\n")}

Cross-page consistency:
- Cases: search, visibility, language, difficulty, reset.
- Events: search, status, visibility, activity, reset.
- Sessions: search, status, AI analysis, event chip when active, reset.

The shared component set is a strength. The issue is footprint and disclosure, not divergent implementation.
`,
  "07-event-lobby-findings.md": `# Event Lobby Findings

${findings.filter((f) => ["UI-F004","UI-F005","UI-F006","UI-F007","UI-F008","UI-F009","UI-F018"].includes(f[0])).map((f) => `## ${f[0]} ${f[1]}\nSeverity: ${f[3]}\n\nEvidence: ${f[6]}\n\nRecommended direction: ${f[7]}\n`).join("\n")}
`,
  "08-session-room-findings.md": `# Session Room Findings

${findings.filter((f) => ["UI-F011","UI-F012","UI-F013","UI-F014","UI-F015","UI-F016"].includes(f[0])).map((f) => `## ${f[0]} ${f[1]}\nSeverity: ${f[3]}\n\nEvidence: ${f[6]}\n\nRecommended direction: ${f[7]}\n`).join("\n")}
`,
  "09-scale-and-overflow-findings.md": `# Scale and Overflow Findings

Negotiator scale: current source supports two primary negotiation participant slots. Counts 3-8 cannot be treated as a simple CSS resize problem; they require a role/slot layout model.

Observer scale: observer counts 0, 1, 4, 8, 12, 30, 50, and 100 were modeled in the scenario matrix. Runtime evidence was bounded; high counts were deterministic fixtures/source analysis, not 100 live browsers.

Viewport risk: primary desktop target is \`1440x900\`; mobile \`390x844\` increases risk that room-entry actions sit below management content.

Zoom/reflow risk: at 150-200% the full filter bars and dense lobby stacks are the most likely to require excessive scrolling or hide critical controls.
`,
  "11-accessibility-findings.md": `# Accessibility Findings

Structural checks collected: headings, landmarks, action labels, target sizes, focus-order sample, fixed/sticky elements, clipped text, overlap, scroll containers, and horizontal overflow.

\`@axe-core/playwright\` is not installed and was not added during this audit. That is an explicit coverage gap, not a hidden pass.

WCAG 2.2 and WAI-ARIA APG implications:
- Critical actions must remain keyboard reachable and visible under reflow.
- Icon-only or compact role controls need accessible names and visible/tooltipped text.
- Toolbar-like filter/action groups should be labeled and should reduce tab stops only when arrow-key behavior is implemented.
- State cannot rely on color alone; status text or accessible labels must remain.

Primary finding: UI-F020.
`,
  "12-visual-language-audit.md": `# Visual Language Audit

Current language: dark background, glass cards, cyan primary gradient, slate secondary controls, rose danger controls, compact list action buttons, badges, and rounded surfaces.

Strengths:
- The app has a recognizable dark product language.
- Buttons and list actions already use reusable helpers.
- Status badges are widely used.

Weaknesses:
- Gradients and glass cards carry too much generic visual weight.
- Spacing and density vary by surface.
- Primary cyan treatment is reused for destinations with different semantics.
- Brand identity is present through \`BrandLogo\`, but UI tokens are not documented enough for consistent extension.

Direction: document restrained tokens for surface, text, action semantics, status, spacing, radius, and density. Do not redesign the logo or add decorative visuals.
`,
  "13-cross-product-patterns.md": `# Cross-Product Pattern References

W3C WCAG 2.2: use as normative accessibility baseline for keyboard, contrast, reflow, target size, non-color semantics, and accessible names. Reference: https://www.w3.org/TR/WCAG22/

WAI-ARIA APG: use patterns for toolbars, disclosure, dialogs, landmarks, and accessible names. Reference: https://www.w3.org/WAI/ARIA/apg/

Microsoft Fluent 2 toolbar guidance: toolbars should group related controls, avoid wrapping, use overflow for excess commands, label multiple toolbars, and provide text/aria labels for icons. Minimal NegotAItions application: compact filter/action toolbar with overflow, not a component-library replacement.

Microsoft Teams meeting gallery guidance: predictable equal-ratio tiles, selectable gallery sizes, and video prioritization are relevant principles. Do not copy Teams UI; use the principle that participant stage size should be stable and user-controllable.

Zoom gallery guidance: gallery can page large participant sets and highlight active speaker. Do not copy Zoom; use the principle that large observer collections need paging/scrolling and active-state prerequisites.

Material Design 3 chips/drawers: filter chips and adaptive navigation support compact filters and responsive drawers. Do not introduce Material as a new library; use the disclosure/chip principle with existing components.
`,
  "14-recommendation-options.md": `# Recommendation Options

## Dashboard
Option A: de-emphasize archive rows and keep one next-action card. Recommended for Wave 1.
Option B: segment scheduled/current/archive with compact list patterns. Wave 2.
Option C: add stats/messages/calendar lanes after IA decisions. Wave 3.

## Lists and Filters
Option A: reduce visible chips and add active-filter summary. Wave 1/2.
Option B: compact toolbar with disclosure and reset chips. Recommended Wave 2.
Option C: saved presets/search workspace. Future only.

## Event Lobby
Option A: one persistent current-room action area, remove duplicate CTAs, shorten labels. Recommended Wave 1.
Option B: separate roster/assignment drawer and session board. Wave 2.
Option C: full room-management workspace. Wave 3.

## Negotiation Room
Option A: document and guard two-participant limitation in UI. Only if Stage 3.12B cannot implement grid yet.
Option B: stable 2-8 negotiator grid plus independent observer list. Recommended Wave 2.
Option C: active-speaker/pinned observer model with virtualization. Wave 3 after state decisions.

## Visual System
Option A: semantic action tokens and persona badges. Recommended Wave 1.
Option B: reusable panel/filter/card density tokens. Wave 2.
Option C: broader design-system package. Not recommended without separate decision.
`,
  "15-prioritized-backlog.csv": csv(["id","findingIds","title","wave","effort","value","regressionRisk","affectedComponents"], backlogRows),
  "16-implementation-waves.md": `# Implementation Waves

## Wave 1 — Safe High-Value UI Corrections
Address: UI-F001, UI-F004, UI-F005, UI-F006, UI-F007, UI-F010, UI-F017, UI-F018.

Expected value: clearer next action, less repeated text, less accidental materials/room confusion, lower lobby stress.

Dependencies: none beyond current routes/components.

Regression risk: low to medium; test with focused Playwright audit scenarios plus Stage 3.10 lifecycle gates.

Recommended branch: \`ui/stage-3-12b-wave-1-action-hierarchy\`.

## Wave 2 — Structural Component Improvements
Address: UI-F003, UI-F008, UI-F011, UI-F012, UI-F014, UI-F016.

Expected value: scalable filters, event roster management, stable negotiation stage, shared case content.

Dependencies: role/slot layout decision for 2-8 negotiators.

Regression risk: medium to high; requires room/lobby E2E coverage.

Recommended branch: \`ui/stage-3-12b-wave-2-lobby-room-structure\`.

## Wave 3 — Future Product Experience
Address: UI-F002, UI-F013, high-volume virtualization and future dashboard product lanes.

Expected value: observer prioritization, messages/statistics/calendar, large event management.

Dependencies: backend/domain state for active observer priority and product decisions for future IA.

Regression risk: high; split into separate decision branches.

Recommended branch: \`product/stage-3-12c-dashboard-roster-future\`.
`,
  "17-test-coverage-and-limitations.md": `# Test Coverage and Limitations

Focused audit test: \`tests/e2e/stage-3-12-ui-audit.spec.ts\`.

Helpers:
- \`tests/e2e/helpers/ui-audit-fixtures.ts\`
- \`tests/e2e/helpers/ui-audit-collector.ts\`

Captured surfaces: dashboard, Events list, Sessions list, Cases list, owner lobby desktop/mobile, active room with eight seeded negotiators and 20 observers, debrief, materials.

Matrix dimensions covered by deterministic fixtures: negotiator counts 2-8, observer counts 0-100, RU/EN, camera/mic all-on/all-off/mixed, lifecycle OPEN/DEBRIEF_OPEN/CLOSED.

Focused audit run result:
- Command: \`npm run test:e2e:focused:managed -- tests/e2e/stage-3-12-ui-audit.spec.ts --project=chromium\`
- Result: 4 passed.
- Local screenshots: 9 PNG files under \`artifacts/ui-audit/screenshots\`.
- Local metrics: 9 JSON files under \`artifacts/ui-audit/metrics\`.
- Trace: 1 Playwright trace zip for \`UIAUD-SCALE-008\`.
- Runtime warning observed: React hydration mismatch warnings on list/material pages, likely from client-only caret style/SSR differences; recorded as audit evidence, not classified as a Stage 3.12 code regression.

Limitations:
- The focused run does not launch 100 real browser contexts.
- High observer counts are fixture/source evidence unless explicitly captured later.
- No axe scan was run because dependency is absent.
- Browser zoom 125/150/200 is documented as required follow-up; structural metrics cover viewport reflow but not all zoom variants.
- Production data was not used.
`,
  "18-open-product-decisions.md": `# Open Product Decisions

1. What is the intended 2-8 negotiator layout model: fixed grid, role-priority grid, paged grid, or facilitator-controlled pins?
2. Should facilitator appear in the primary grid, center column, side panel, or outside the negotiator stage?
3. What observer states should drive prioritization: camera on, microphone active, recent audio activity, manual pin, facilitator-selected relevance, or no sorting?
4. How should active sorting avoid visual jumping?
5. At what people/observer count is virtualization required?
6. What dashboard lanes are product commitments: archive, scheduled, messages, stats, calendar, progress?
7. Which room/material/debrief actions are progression vs review vs navigation?
8. Which icons are approved for observer/facilitator/owner/role and how will accessible labels be presented?
9. Should event management become a separate mode or drawer?
10. What is the minimum mobile room-management experience for facilitators?
`,
  "19-audit-execution-log.md": `# Audit Execution Log

## Production Sync Check
${productionSyncEvidence}

## Local Worktree
Created worktree \`C:\\Projects\\Negotiations AI\\negotiations-web-ui-ux-audit\` on branch \`audit/stage-3-12-ui-ux-audit\` from \`origin/deploy/yandex-poc\`.

Verified:
- Branch: \`audit/stage-3-12-ui-ux-audit\`
- HEAD: \`${baseSha}\`
- Initial status: clean

## Environment
Copied local env from \`C:\\Projects\\Negotiations AI\\negotiations-web-server-stop-main\\.env\` to audit worktree.

Evidence:
- Source existed.
- Target did not exist before copy.
- SHA-256 hashes matched.
- \`.env\` is ignored by Git.
- Safe DB resolved key was \`E2E_DATABASE_URL\`.
- Safe DB target matched \`localhost:5433/negotiations_e2e\`.

## Evidence Artifacts
Screenshots and metrics are written under \`artifacts/ui-audit\`.

Focused audit evidence generated:
- 9 screenshots.
- 9 metric JSON files.
- 1 trace zip.
- \`artifacts/ui-audit/manifest.json\`.
- \`artifacts/ui-audit/index.html\`.

## Validation
Focused audit test:
- \`npm run test:e2e:focused:managed -- tests/e2e/stage-3-12-ui-audit.spec.ts --project=chromium\` passed: 4 tests.

Required gates:
- \`npm run validate:fast\` passed.
- \`npm run validate:deploy\` passed.
- \`npm run test:e2e:smoke\` passed: 12 browser smoke DB tests plus E2E DB resolver checks.
- \`npm run test:e2e:smoke:browser\` passed: 5 browser-smoke tests.
- \`npm run test:stage310\` passed: 102 unit tests and 30 managed Chromium E2E tests.

Do not commit large screenshots unless a repository artifact policy is added. Keep local screenshots and commit docs, tooling, manifest, and index only when appropriate.
`,
};

files["03-scenario-matrix.csv"] = csv(scenarioHeaders, scenarioObjects);
files["scenario-matrix.csv"] = files["03-scenario-matrix.csv"];
files["04-product-owner-hypotheses.csv"] = csv(
  ["hypothesisId","area","originalObservation","auditStatus","evidence","findingIds","recommendedDirection","confidence"],
  hypothesisRows,
);
files["product-owner-hypotheses.csv"] = files["04-product-owner-hypotheses.csv"];
files["10-role-and-action-inventory.csv"] = csv(
  ["action","page","component","visibleLabel","icon","buttonVariant","computedTreatment","classification","risk"],
  actionRows,
);

const allFindings = `# Consolidated Finding Detail

${findingMarkdown()}
`;
files["05-dashboard-findings.md"] += "\n\nSee consolidated detail below for all fields.\n\n";
files["07-event-lobby-findings.md"] += "\n\nSee consolidated detail in related files for full field structure.\n";
files["08-session-room-findings.md"] += "\n\nSee consolidated detail in related files for full field structure.\n";
files["09-scale-and-overflow-findings.md"] += `\n\n${allFindings}\n`;

for (const [fileName, content] of Object.entries(files)) {
  writeFileSync(path.join(auditDir, fileName), content, "utf8");
}

const manifestPath = path.join(artifactDir, "manifest.json");
if (!existsSync(manifestPath)) {
  writeFileSync(manifestPath, JSON.stringify({ records: [] }, null, 2) + "\n", "utf8");
}

const indexPath = path.join(artifactDir, "index.html");
if (!existsSync(indexPath)) {
  writeFileSync(
    indexPath,
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Stage 3.12 UI Audit Evidence</title><body><h1>Stage 3.12 UI Audit Evidence</h1><p>Run the Playwright UI audit to populate screenshots and metrics.</p></body></html>\n`,
    "utf8",
  );
}

console.log(`Wrote Stage 3.12 UI audit docs to ${auditDir}`);
