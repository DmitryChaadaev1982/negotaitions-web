# Stage 3.13E Authoritative Requirement Manifest

## Authority and use

This is the authoritative, implementation-independent requirement manifest for
Stage 3.13E. The approved requirement packet supplied for this Stage is the
product authority. Current architecture documents may confirm or refine a
requirement; historical stage reports, existing tests, and implementation
claims are supporting evidence only and cannot add, weaken, or replace a
requirement.

Conflict recorded: `docs/architecture/04-session-event-flow.md` calls the
preparation-ready state `PREPARATION` (lines 3-9), while the approved packet
names the user-facing state `ROOM_READY / before Preparation`. The packet is
the authority for this Stage; verification must establish the required
pre-Preparation behavior regardless of internal enum naming.

Supersession recorded — `User design clarification — 2026-08-15`:
S313E-AIPUB-002, S313E-AIPUB-006, S313E-AIPUB-007, S313E-AIPUB-011, and
S313E-AIPUB-012 encoded active presence at Publish and “absent at Publish /
late join gets no grant until a later Publish”. Those rows remain as history
and must be judged SUPERSEDED / REPLACED_BY S313E-AIPUB-015–021, not
re-implemented and not treated as still-pending work. Observer-safe grant
projection (S313E-AIPUB-003–005, S313E-AIPUB-014) is not superseded.

Each row is one independently judged requirement. “Source” refers to the
approved packet section unless an architecture document is named. Evidence
types are limited to CODE, DOM, SCREENSHOT, BEHAVIOR, TEST, API, DB, and
MIGRATION. Runtime surface is `—` when no user-facing surface is required.

## Evidence profiles

Every atomic requirement below has the required and supporting evidence profile
listed here. Required evidence is the minimum proof needed for PASS; supporting
evidence assists investigation but cannot substitute for missing required
evidence. `DOM or SCREENSHOT` means either an inspected DOM assertion or a
real screenshot from the required local runtime surface. `BEHAVIOR + DOM/API`
means an observed interaction plus an observed DOM state or API result.

| Requirement IDs | Required evidence for PASS | Supporting evidence |
| --- | --- | --- |
| S313E-DASH-001–002 | CODE + API or DB | TEST |
| S313E-DASH-003–004 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-005 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-DASH-006–010 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-011–013 | SCREENSHOT | CODE, DOM |
| S313E-DASH-014–015 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-016–017 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-018 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-019 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-020 | CODE + API/TEST | DOM, SCREENSHOT |
| S313E-DASH-021–023 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-DASH-024–026 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-027 | DOM or SCREENSHOT | CODE, TEST |
| S313E-DASH-028–030 | DOM or SCREENSHOT | CODE, TEST |
| S313E-LOBBY-001–003 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-LIFE-001–003 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-LIFE-004–005 | DOM or SCREENSHOT | CODE, TEST |
| S313E-LIFE-006–017 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-LIFE-018 | SCREENSHOT + CODE | DOM, TEST |
| S313E-LIFE-019–020 | BEHAVIOR + DOM or SCREENSHOT | CODE, TEST |
| S313E-NOTES-001–005 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-AIPUB-001–013 | CODE + TEST/API/DB | DOM, SCREENSHOT |
| S313E-AIPUB-014 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-AIPUB-015–017, 019–021 | CODE + TEST/API/DB | DOM, SCREENSHOT |
| S313E-AIPUB-018 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-AIPRIV-001–011 | CODE + TEST/API/DB | DOM, SCREENSHOT |
| S313E-READY-001,003,009–011 | CODE + TEST/API/DB | DOM, SCREENSHOT |
| S313E-READY-002,004–008 | BEHAVIOR + DOM/API | CODE, TEST |
| S313E-DB-001 | CODE + MIGRATION + TEST/DB | API |
| S313E-DB-002 | MIGRATION + DB | CODE, TEST |
| S313E-DB-003–004 | CODE + MIGRATION + TEST/DB | API |

Runtime-required profiles are intentionally not weakened if local tooling,
authentication, or fixtures cannot supply the observation. In that situation
the status is UNVERIFIABLE unless evidence proves the requirement absent or
contradicted.

| ID | Requirement | Source / rationale | Verification type(s) | Relevant runtime surface | Acceptance criterion |
| --- | --- | --- | --- | --- | --- |
| S313E-DASH-001 | Creating an Event without an explicit date/time assigns the current date/time. | A1; persisted Event scheduling semantics. | CODE, API, DB, TEST | Event creation | Created Event has a persisted current `scheduledAt`. |
| S313E-DASH-002 | Normal persisted Events do not rely on `scheduledAt = NULL`. | A1 | CODE, DB, TEST | Event persistence | Normal creation/update paths persist scheduling semantics, not null as the default state. |
| S313E-DASH-003 | Dashboard renders an Event as the parent of its Sessions. | A2; 04-session-event-flow hierarchy. | CODE, DOM, SCREENSHOT, BEHAVIOR | Dashboard / Archive | Event children are visually nested below the owning Event. |
| S313E-DASH-004 | Dashboard displays standalone Sessions separately from Events. | A2 | CODE, DOM, SCREENSHOT, BEHAVIOR | Dashboard / Archive | Sessions without `eventId` are in a distinct standalone group. |
| S313E-DASH-005 | Completing an Event moves it and its associated Sessions to Archive. | A2 | CODE, API, DOM, BEHAVIOR, TEST | Dashboard / Archive | Completed Event hierarchy appears in Archive and not active/current lanes. |
| S313E-DASH-006 | Dashboard/card visual language uses canonical entity pictogram assets. | A3; 04-session-event-flow pictogram semantics. | CODE, DOM, SCREENSHOT | Dashboard cards | Rendered object identity comes from `public/icons/objects/{light,dark}`. |
| S313E-DASH-007 | Entity pictograms use the same master assets consistently, not ad-hoc per-surface icons. | A3 | CODE, DOM, SCREENSHOT | Dashboard/cards | Event, room/session, and case identities resolve through the canonical asset family. |
| S313E-DASH-008 | Cases page header shows a large Case pictogram. | A4 | CODE, DOM, SCREENSHOT | Cases | Header visibly contains the large canonical Case entity pictogram. |
| S313E-DASH-009 | Events/Meetings page header shows a large Event pictogram. | A4 | CODE, DOM, SCREENSHOT | Events/Meetings | Header visibly contains the large canonical Event entity pictogram. |
| S313E-DASH-010 | Sessions page header shows a large Session pictogram. | A4 | CODE, DOM, SCREENSHOT | Sessions | Header visibly contains the large canonical Room/Session entity pictogram. |
| S313E-DASH-011 | Current/continue card shares the redesigned Event/Session card structural visual system. | A5 | DOM, SCREENSHOT, BEHAVIOR | Dashboard current card | Card structure, typography, and layout align with the redesigned object cards. |
| S313E-DASH-012 | Current/continue card has a distinct accent/color. | A5 | DOM, SCREENSHOT | Dashboard current card | The current object is visibly differentiated without a different card system. |
| S313E-DASH-013 | `Open lobby` is a clear primary blue action consistent with `Open session`. | A6 | DOM, SCREENSHOT | Dashboard/Event card | `Open lobby` has primary-action emphasis rather than low-emphasis grey treatment. |
| S313E-LOBBY-001 | Lobby does not infer device failure from bootstrap/token/generic uninitialized-provider state. | B1 | CODE, BEHAVIOR, TEST | Event lobby | Those states alone do not emit a camera/microphone failure warning. |
| S313E-LOBBY-002 | Lobby warning is emitted only for a provider/browser-recognized device/media problem. | B2 | CODE, BEHAVIOR, TEST | Event lobby | Permission denial, unavailable device, acquisition failure, or equivalent callback failure is required. |
| S313E-LOBBY-003 | Normal connected camera/microphone state has no persistent unavailable-device warning/header. | B3 | DOM, SCREENSHOT, BEHAVIOR | Event lobby | A healthy local media state renders without the warning. |
| S313E-LIFE-001 | A room-ready state exists before Preparation starts and permits participants to join. | C1; 04-session-event-flow control contract. | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room | Before Preparation, room admission works and Preparation has not begun. |
| S313E-LIFE-002 | Facilitator manually starts Preparation only after room readiness activities. | C1 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room controls | No automatic transition bypasses the facilitator’s explicit start. |
| S313E-LIFE-003 | Preparation timer is not running in room-ready/pre-Preparation state. | C2 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room | Timer remains stopped until `START_PREPARATION`. |
| S313E-LIFE-004 | Normal room-ready/preparation UX does not expose `Start negotiation`. | C3 | CODE, DOM, SCREENSHOT, BEHAVIOR | Negotiation room controls | The action is absent/disabled as a normal action before Preparation completes. |
| S313E-LIFE-005 | Normal UX does not expose `SKIP_PREPARATION`. | C4 | CODE, DOM, SCREENSHOT, TEST | Negotiation room controls | No normal control dispatches or labels `SKIP_PREPARATION`. |
| S313E-LIFE-006 | Effective preparation skipping uses start then canonical completion transitions. | C4 | CODE, API, BEHAVIOR, TEST | Negotiation room controls | The client produces `START_PREPARATION` followed by `STOP_PREPARATION`, not a parallel skip transition. |
| S313E-LIFE-007 | Preparation can be paused. | C5 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room controls | Facilitator can invoke canonical preparation pause. |
| S313E-LIFE-008 | Preparation can be resumed. | C5 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room controls | Facilitator can invoke canonical preparation resume. |
| S313E-LIFE-009 | Preparation can be completed early through Finish preparation/equivalent. | C5 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room controls | Facilitator can open and confirm the early-completion control. |
| S313E-LIFE-010 | Negotiation can be paused. | C6 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room controls | Facilitator can invoke canonical negotiation pause. |
| S313E-LIFE-011 | Negotiation can be resumed. | C6 | CODE, API, DOM, BEHAVIOR, TEST | Negotiation room controls | Facilitator can invoke canonical negotiation resume. |
| S313E-LIFE-012 | Opening early-finish confirmation does not change a running timer. | C7 | CODE, DOM, BEHAVIOR, TEST | Preparation/Negotiation confirmation | Running phase continues while dialog is open. |
| S313E-LIFE-013 | Opening early-finish confirmation preserves an already paused timer. | C7 | CODE, DOM, BEHAVIOR, TEST | Preparation/Negotiation confirmation | Paused phase remains paused while dialog is open. |
| S313E-LIFE-014 | Cancelling early-finish confirmation performs no lifecycle action. | C7 | CODE, DOM, BEHAVIOR, TEST | Preparation/Negotiation confirmation | Cancel sends no control transition. |
| S313E-LIFE-015 | Confirming preparation early finish invokes canonical `STOP_PREPARATION` only. | C7 | CODE, API, BEHAVIOR, TEST | Preparation confirmation | Confirmation dispatches the existing action, not a new lifecycle path. |
| S313E-LIFE-016 | Confirming negotiation early finish invokes canonical `FINISH` only. | C7 | CODE, API, BEHAVIOR, TEST | Negotiation confirmation | Confirmation dispatches the existing action, not a new lifecycle path. |
| S313E-LIFE-017 | Early-finish destructive submission cannot be duplicated while pending. | C8 | CODE, DOM, BEHAVIOR, TEST | Confirmation dialog | Repeated submit input results in at most one action while submitting. |
| S313E-LIFE-018 | Destructive styling is confined to confirmation/destructive action without backend-flow redesign. | C9 | CODE, DOM, SCREENSHOT | Confirmation dialog | Visual destructive treatment is present and canonical server flow remains unchanged. |
| S313E-LIFE-019 | Negotiation expiry exposes a clear finish-crossing state. | C10 | CODE, DOM, SCREENSHOT, BEHAVIOR, TEST | Negotiation room | `Time expired`/equivalent is obvious on expiry. |
| S313E-LIFE-020 | Finish-crossing state remains visible approximately 2–3 seconds before Debrief. | C10 | CODE, DOM, BEHAVIOR, TEST | Negotiation room | Debrief does not replace the finish-crossing state immediately. |
| S313E-LIFE-021 | A valid OBSERVER may make their first Session room-shell entry while the Session is `DEBRIEF_OPEN`. The existing Event Lobby "Доступно для наблюдения" / "Available to observe" block lists that Session with status `Дебриф` / `Debrief` and CTA `Присоединиться к разбору` / `Join debrief`. Direct `/room/[sessionId]` uses the same lifecycle authorization. Room entry remains possible after Unshare; an active publication still materializes the current Observer grant through historical-entry claim after that first entry. This is not public access. | User acceptance clarification — 2026-08-15 | CODE, API, DOM, BEHAVIOR, TEST | Event Lobby / room | Unentered authorized Observer sees the Debrief Session in the existing observe block, can enter from Lobby or the direct room path, lands in Debrief UI, and receives an Observer-safe report only when a current publication is active. |
| S313E-NOTES-001 | Materials offers Back to session for every non-CLOSED room state. | D1; 04-session-event-flow return eligibility. | CODE, API, DOM, BEHAVIOR, TEST | Materials | Active and `DEBRIEF_OPEN` sessions show a working return action. |
| S313E-NOTES-002 | Successful save promotes saved draft B to the clean baseline. | D2 | CODE, BEHAVIOR, TEST | Materials Notes | Saved A → edit B → save leaves B clean. |
| S313E-NOTES-003 | A successful in-flight save of B does not overwrite later local edit C. | D2 | CODE, BEHAVIOR, TEST | Materials Notes | C remains visible and dirty relative to saved B. |
| S313E-NOTES-004 | Failed save preserves previous baseline, local draft, and dirty state. | D2 | CODE, BEHAVIOR, TEST | Materials Notes | Failure does not falsely mark draft saved or lose edits. |
| S313E-NOTES-005 | Controlled draft/baseline semantics apply to Materials Notes. | D3 | CODE, DOM, BEHAVIOR, TEST | Materials Notes | The Materials surface, not merely another Notes UI, meets S313E-NOTES-002–004. |
| S313E-AIPUB-001 | Analysis completion does not automatically authorize participant/observer publication. | E1 | CODE, API, DB, TEST | Materials / debrief | Completed analysis alone grants no viewer report access. |
| S313E-AIPUB-002 | SUPERSEDED by S313E-AIPUB-015–021 (`User design clarification — 2026-08-15`). Original: Publish derives durable role-specific authorization from canonical active room presence. | E2; superseded 2026-08-15 | CODE, API, DB, TEST | Publish API | Historical record only. Do not re-implement active-at-Publish recipient selection. |
| S313E-AIPUB-003 | Eligible Participant receives participant-safe analysis and only own personal feedback. | E3 | CODE, API, DB, TEST | Materials/debrief | Projection contains only the bound participant’s feedback. |
| S313E-AIPUB-004 | Eligible Observer receives reduced observer-safe projection. | E4 | CODE, API, DB, TEST | Materials/debrief | Projection is observer-specific. Grant + OBSERVER projection remains required; session-wide share is not sufficient. |
| S313E-AIPUB-005 | Observer projection excludes participant-private, personal, and facilitator-private content. | E4 | CODE, API, TEST | Materials/debrief | All listed private content is absent server-side. |
| S313E-AIPUB-006 | SUPERSEDED by S313E-AIPUB-015–018 (`User design clarification — 2026-08-15`). Original: a user absent at Publish gets no grant and joining later alone grants no report access. | E5; superseded 2026-08-15 | CODE, API, DB, BEHAVIOR, TEST | Publish/materials | Historical record only. Historical room entry now authorizes even when absent at Publish; first room entry during an active publication creates a grant. |
| S313E-AIPUB-007 | SUPERSEDED by S313E-AIPUB-017–020 (`User design clarification — 2026-08-15`). Original: late joining before a later Publish may make a user eligible for that later Publish. | E6; superseded 2026-08-15 | CODE, API, DB, TEST | Publish API | Historical record only. Republish still includes historical entrants; first entry during an active publication no longer waits for Republish. |
| S313E-AIPUB-008 | Republish in one active epoch expands grants monotonically. | E7 | CODE, API, DB, TEST | Publish API | Existing grants persist and newly historically eligible users can be added. |
| S313E-AIPUB-009 | Leave/rejoin does not erase an existing valid grant. | E8 | CODE, API, DB, TEST | Materials/debrief | Rejoined recipient retains prior authorization. |
| S313E-AIPUB-010 | Unshare revokes current publication grants as an authorization boundary. | E9 | CODE, API, DB, TEST | Unshare/materials | Revoked grants no longer authorize delivery. |
| S313E-AIPUB-011 | SUPERSEDED by S313E-AIPUB-019–020 (`User design clarification — 2026-08-15`). Original: Publish after Unshare starts a new epoch and grants only newly eligible recipients; old absent recipients are not resurrected. | E10; superseded 2026-08-15 | CODE, API, DB, TEST | Publish API | Historical record only. Old-epoch grants stay revoked; a new epoch grants all historical room entrants eligible by that time, including previously absent attendees. |
| S313E-AIPUB-012 | SUPERSEDED by S313E-AIPUB-016–017 (`User design clarification — 2026-08-15`). Original: Publish with zero eligible recipients is valid and creates no future authorization; later join alone has no access. | E11; superseded 2026-08-15 | CODE, API, DB, TEST | Publish API | Historical record only. Zero-recipient Publish remains valid. Later actual room entry while the snapshot is active does create a grant; lobby-only membership still does not. |
| S313E-AIPUB-013 | Legacy shared payload does not become reconstructed durable recipient grants. | E12 | CODE, DB, MIGRATION, TEST | Migration/materials | Participants/Observers require explicit republish. |
| S313E-AIPUB-014 | When publication authorization is revoked by Unshare, an already-open authorized Participant/Observer client stops displaying the revoked report within the normal application reconciliation interval without navigation, page reload, or Lobby exit/re-entry. Server-side revocation alone is insufficient. | User acceptance clarification / manual acceptance — 2026-08-14 | CODE, API, DOM, BEHAVIOR, TEST | Materials/debrief recipient UI | After canonical Unshare, the mounted recipient UI removes the report and shows the unpublished/unavailable state without the recipient navigating. |
| S313E-AIPUB-015 | A Participant or Observer who has successfully entered the authorized Session room surface at least once is eligible for published post-session material even when absent at Publish. Confirmed Vox/media connection is not additionally required. | User design clarification — 2026-08-15; room-shell-entry clarification — 2026-08-15 | CODE, API, DB, TEST | Publish API / materials | Historical `SessionRoomConnection` from canonical room-shell claim plus current Participant/Observer membership produces a grant; active presence at Publish is not required. |
| S313E-AIPUB-016 | Session/Event membership, Event Lobby presence, invitation, join-token, unauthorized room URL access, or Event-lobby provider credentials without a successful authorized Session room-shell entry are insufficient for a publication grant. | User design clarification — 2026-08-15; room-shell-entry clarification — 2026-08-15 | CODE, API, DB, TEST | Publish API / materials | A lobby-only SessionParticipant receives no grant on Publish. Event Lobby Vox connection does not qualify. |
| S313E-AIPUB-017 | A Participant or Observer who first completes authorized Session room-shell entry while an unrevoked publication exists receives a durable grant for the current epoch without a manual Republish. Confirmed live media is not an extra gate. | User design clarification — 2026-08-15; room-shell-entry clarification — 2026-08-15 | CODE, API, DB, TEST | Room entry / materials | Canonical `claimSessionRoomConnectionLease` materializes the current grant server-side. |
| S313E-AIPUB-018 | An Observer who first enters during `DEBRIEF_OPEN` after Publish immediately receives the current Observer-safe published report through ordinary client reconciliation. Private participant feedback remains absent. | User design clarification — 2026-08-15 | CODE, API, DOM, BEHAVIOR, TEST | Room debrief sidebar | Observer-safe report appears on the live debrief surface without Republish; `participantPersonalFeedback` is not delivered. |
| S313E-AIPUB-019 | Room entry after Unshare does not resurrect a revoked publication or its grants. | User design clarification — 2026-08-15 | CODE, API, DB, TEST | Room entry / materials | No grant is created when there is no active publication. |
| S313E-AIPUB-020 | A later Publish/new epoch recomputes recipients from historical room-entry truth and includes all viewers who have actually entered by that time. | User design clarification — 2026-08-15 | CODE, API, DB, TEST | Publish API | New-epoch grants are not copied from the previous recipient list or from who is online at Republish. |
| S313E-AIPUB-021 | Canonical current-room-presence helpers and tests remain; they are no longer the AI publication authorization rule. | User design clarification — 2026-08-15 | CODE, TEST | Presence / Publish | `activeHumanSessionConnectionWhere` / logical presence behavior is preserved and unused as Publish recipient selection. |
| S313E-AIPRIV-001 | Personal-feedback authorization identity is stable `SessionParticipant` identity. | F1 | CODE, API, DB, TEST | Analysis completion | Display name is not the access identity. |
| S313E-AIPRIV-002 | Provider and persisted personal feedback bind `sessionParticipantId`. | F2 | CODE, API, DB, TEST | Analysis pipeline | Schema/persistence carries the stable ID. |
| S313E-AIPRIV-003 | Display-name canonicalization may display names but does not authorize. | F3 | CODE, API, TEST | Analysis delivery | Name value cannot determine authorization. |
| S313E-AIPRIV-004 | Retained legacy name fallback requires current negotiating-participant membership. | F4 | CODE, DB, TEST | Analysis completion | Only currently valid membership is eligible. |
| S313E-AIPRIV-005 | Legacy name fallback succeeds only for exactly one normalized match. | F4 | CODE, TEST | Analysis completion | One and only one match is accepted. |
| S313E-AIPRIV-006 | Legacy duplicate, unknown, or ambiguous names fail closed. | F4 | CODE, TEST | Analysis completion | No feedback is delivered/persisted for these cases. |
| S313E-AIPRIV-007 | Completion-time personal-feedback validation uses current canonical membership. | F5 | CODE, DB, TEST | Analysis completion | Validation re-reads current roster before persistence. |
| S313E-AIPRIV-008 | Final membership validation and persistence are atomic relative to membership/role mutations. | F6 | CODE, DB, TEST | Analysis completion | Transaction serialization prevents a stale roster result. |
| S313E-AIPRIV-009 | Relevant multi-row participant locking uses deterministic `id ASC` order. | F7 | CODE, DB, TEST | Analysis/role mutation transactions | Locks/writes order affected rows by primary key ascending. |
| S313E-AIPRIV-010 | Publication refuses analysis stale against current transcript generation. | F8 | CODE, API, DB, TEST | Publish API | Stale report is not publishable/current. |
| S313E-AIPRIV-011 | Analysis runs preserve run-token/CAS fencing so stale/losing run cannot complete canonical run. | F9 | CODE, DB, TEST | Analysis operation | Only current token/CAS owner persists completion. |
| S313E-READY-001 | Materials processing readiness is separate from viewer publication authorization. | G1 | CODE, API, TEST | Materials status | Readiness and report permission are independent fields/decisions. |
| S313E-READY-002 | Participant/Observer can see completed processing without unpublished report content. | G2 | CODE, API, DOM, TEST | Materials/debrief | Status is visible but report remains absent without a grant. |
| S313E-READY-003 | Viewer-specific valid grant, not global publication state, controls report visibility. | G3 | CODE, API, DB, TEST | Materials status/delivery | Global state cannot substitute for recipient authorization. |
| S313E-READY-004 | No grant with pending/running AI processing continues polling. | G4 | CODE, API, BEHAVIOR, TEST | Materials polling | Polling remains active. |
| S313E-READY-005 | No grant with fresh completed publishable report continues polling for later Publish. | G5 | CODE, API, BEHAVIOR, TEST | Materials polling | Polling remains active. |
| S313E-READY-006 | Fresh usable completed report overrides historical upstream failure for polling. | G6 | CODE, API, BEHAVIOR, TEST | Materials polling | Polling continues when later Publish remains meaningful. |
| S313E-READY-007 | Terminal AI FAILED with no usable current completed report stops polling. | G7 | CODE, API, BEHAVIOR, TEST | Materials polling | Polling terminates. |
| S313E-READY-008 | Required upstream terminal failure with no usable current report stops polling by canonical readiness. | G8 | CODE, API, BEHAVIOR, TEST | Materials polling | Polling terminates. |
| S313E-READY-009 | FAILED remains explicit through readiness calculation. | G9 | CODE, API, TEST | Materials status | Failure is not collapsed to null/absent prematurely. |
| S313E-READY-010 | Stale completed report is not usable/current/publishable for readiness. | G10 | CODE, API, DB, TEST | Materials status | Stale analysis cannot meet usable-report condition. |
| S313E-READY-011 | Polling never exposes report contents. | G11 | CODE, API, DOM, TEST | Materials polling | Poll result/status cannot leak analysis content. |
| S313E-DB-001 | Durable publication persistence is normalized in Prisma/PostgreSQL with publication/grant model. | H1; 10-data-storage-and-retention. | CODE, DB, MIGRATION, TEST | — | Publication and recipient grants are separate normalized persistence. |
| S313E-DB-002 | Wave C migration directory is exactly `prisma/migrations/20260814161500_add_ai_analysis_publication_grants/`. | H2 | MIGRATION, DB | — | Intended migration exists at the approved path. |
| S313E-DB-003 | Production migration overlay/allowlist admits only intended Wave C migration and rejects unintended pending migrations. | H3 | CODE, MIGRATION, TEST | Deployment migration tooling | Allowlist behavior is explicit and bounded. |
| S313E-DB-004 | No historical grant backfill invents unknown historical recipient presence. | H4 | CODE, DB, MIGRATION, TEST | Migration | Migration creates no speculative recipient grant. |
| S313E-DASH-014 | Current dashboard section label is `Активные` in Russian. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard | Russian active section heading is exactly `Активные`; it is not `Предстоящие и активные`. |
| S313E-DASH-015 | Current dashboard section label is `Active` in English. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard | English active section heading is exactly `Active`; it is not `Upcoming and active`. |
| S313E-DASH-016 | Dashboard does not render a user-facing `Управляемые встречи` / `Managed meetings` section. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard | Neither localized heading is rendered as a dashboard grouping. |
| S313E-DASH-017 | Management/ownership alone does not duplicate a meeting or Session across dashboard groupings. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard | Each object appears in one lifecycle/state section; management is not a grouping axis. |
| S313E-DASH-018 | Remaining dashboard Event and Session cards display their owner. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard cards | Every displayed Event/Session card exposes its owner identity. |
| S313E-DASH-019 | A current-user-owned card explicitly displays `Владелец: Вы` / `Owner: You` and visually accents that self-state. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard cards | Self-owned cards have both explicit localized self text and visible accent treatment. |
| S313E-DASH-020 | Owner display and self-accent do not independently alter access authorization. | User acceptance clarification — 2026-08-14 | CODE, API, TEST | Dashboard/access authorization | Ownership presentation does not grant or remove room/Event access. |
| S313E-DASH-021 | A parent Event with a relevant active nested Session is classified Active for the current user. | User acceptance clarification — 2026-08-14 | BEHAVIOR, DOM, API | Dashboard | Relevant active nested Session lifecycle overrides a future Event schedule for parent classification. |
| S313E-DASH-022 | An Active parent Event displays its nested Sessions in the Active section. | User acceptance clarification — 2026-08-14 | BEHAVIOR, DOM, API | Dashboard | The Event→Session hierarchy is rendered together under Active. |
| S313E-DASH-023 | An Event classified Active by a relevant nested Session is not also displayed in Future. | User acceptance clarification — 2026-08-14 | BEHAVIOR, DOM, API | Dashboard | The Event appears at most once across Active and Future. |
| S313E-DASH-024 | Parent Event card top-level action is `Открыть лобби` / `Open lobby` and targets its Event lobby. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard Event card | Parent action label and href navigate to the Event lobby. |
| S313E-DASH-025 | Nested Session card provides the action to enter/open its specific Session room. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard nested Session card | Session action targets that Session’s room. |
| S313E-DASH-026 | Parent Event card does not expose `Continue session` or another duplicate Session-room entry action when nested Session provides it. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Dashboard Event card | Event level has no duplicate room-entry action. |
| S313E-DASH-027 | Dense Cases table/list rows do not render entity pictograms; the compact row layout keeps management/action controls visible without horizontal scrolling at the normal supported desktop viewport. The large Case pictogram remains only in the Cases page header. | User acceptance clarification — 2026-08-14; overimplementation correction | DOM, SCREENSHOT | Cases table | Header pictogram remains; table body has no Case row pictogram; action controls are in the visible viewport without horizontal overflow. |
| S313E-DASH-028 | Case create and Case edit interfaces show the large canonical Case pictogram in the top page/header/hero area. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Case create/edit | `/cases/new` and `/cases/[id]/edit` headers visibly contain the large Case pictogram. Pictograms are not inserted into form fields or dense table rows. |
| S313E-DASH-029 | Event create and Event edit interfaces show the large canonical Event pictogram in the top page/header/hero area. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Event create/edit | Event create/edit headers visibly contain the large Event pictogram. Pictograms are not inserted into form fields or dense table rows. |
| S313E-DASH-030 | Session create and Session edit/detail interfaces show the large canonical Session/Room pictogram in the top page/header/hero area. | User acceptance clarification — 2026-08-14 | DOM, SCREENSHOT | Session create/edit | Session create and Session edit/detail headers visibly contain the large Room/Session pictogram. Pictograms are not inserted into form fields or dense table rows. |

## Executable evidence register

The collector reports candidate checks as supporting evidence until they have
been executed. An executed deterministic check may satisfy a required TEST,
API, DB, BEHAVIOR, or DOM class only when its assertions directly cover the
acceptance criterion; a test filename or source inspection never does.

| Requirement IDs | Existing automated evidence candidate | Runtime/manual evidence still required |
| --- | --- | --- |
| S313E-DASH-003–005, 011–013 | `tests/e2e/current-product-workflow.spec.ts`, `lib/dashboard-activity-selection.test.ts` | Dashboard fixtures and rendered DOM/computed-style or screenshot evidence. |
| S313E-DASH-008–010 | `lib/object-pictogram-component.test.ts` and `lib/object-pictograms.test.ts` cover primitive assets only, not page headers. | Authenticated Cases, Events, and Sessions page DOM/screenshot. |
| S313E-DASH-027–030 | `tests/e2e/stage-3-13e-dashboard-acceptance.spec.ts` | Executed Cases overflow/row-pictogram check and create/edit header pictogram DOM. |
| S313E-LOBBY-001–003 | Previous mock-only healthy-media PASS is invalidated. `tests/e2e/stage-3-13e-dashboard-acceptance.spec.ts` must exercise the production lobby device-warning reconciliation path (healthy streams after a stale/recoverable media signal). | Executed healthy-media browser state with warning absence; acquisition-failure path still shows the warning. |
| S313E-LIFE-001–020 | `tests/e2e/stage-3-13e-standalone-remediation.spec.ts`, `lib/facilitator-early-finish-ui.test.ts`, and timer presentation tests are candidates. | Executed room lifecycle interaction and rendered timing/confirmation state. |
| S313E-LIFE-021 | `lib/session-room-access.test.ts`; `tests/e2e/late-observer-debrief-entry.spec.ts`; Event Lobby observe-block DOM. | Manual acceptance 2026-08-15: late-Observer first DEBRIEF_OPEN entry from Event Lobby; status `Дебриф`/`Debrief`; CTA `Присоединиться к разбору`/`Join debrief`; Observer-safe report after entry when Published. |
| S313E-AIPUB-015–017, 019–021 | `lib/ai-publication.test.ts`; `tests/e2e/debrief-ai-sharing.spec.ts` TEST A/B/C/E/F/G/H | Executed grant DB/API assertions plus manual acceptance 2026-08-15 of historical Participant/Observer, lobby-only exclusion, late entry, Unshare, and Republish. Historical entrant = authorized room-shell entry (`SessionRoomConnection` claim), not confirmed live media. |
| S313E-NOTES-001–005 | `lib/participant-notes-state.test.ts` and Stage 3.13E E2E remediation scenarios are candidates. | Executed Materials Notes draft/save/failure interactions. |
| S313E-AIPUB-001–013, S313E-AIPRIV-001–011, S313E-READY-001–011 | `tests/e2e/debrief-ai-sharing.spec.ts`, publication/visibility/readiness unit and transaction tests are candidates. Observer report-body evidence is the room debrief sidebar (`debrief-panel` → `ai-report`), not `/sessions/[id]/materials` as the primary live path. API `canView` alone is insufficient. | Execute Observer body-render on the room debrief surface plus Lobby exit/re-entry. |
| S313E-AIPUB-014 | `tests/e2e/debrief-ai-sharing.spec.ts` live Unshare recipient UI check on the mounted room debrief panel. | Mounted Participant/Observer `debrief-panel` DOM after canonical Unshare, no navigation. Manual acceptance 2026-08-15: report disappears without navigation. |
| S313E-AIPUB-018 | `tests/e2e/debrief-ai-sharing.spec.ts` TEST D on room debrief sidebar after first Observer entry in `DEBRIEF_OPEN`. | Observer-safe report body on `debrief-panel` without Republish; no private participant feedback. Manual acceptance 2026-08-15. |
| S313E-DASH-014–026 | `tests/e2e/stage-3-13e-dashboard-acceptance.spec.ts` | Remaining visual dashboard checks as executed. |

## Subsequent remediation acceptance plan

This is a plan only; it does not create or execute product tests. Prefer one
new focused Playwright spec,
`tests/e2e/stage-3-13e-dashboard-acceptance.spec.ts`, using
`tests/e2e/helpers/db.ts` (`createActiveUser`, `createE2eCase`,
`createE2eEvent`, `createUserSessionCookie`, `forceSessionRunningForE2e`,
`query`, and `cleanupE2eData`) with the isolated local configuration in
`playwright.local.config.ts`.

| Requirement ID | Cheapest reliable evidence | Proposed check / fixture | Screenshot necessary |
| --- | --- | --- | --- |
| S313E-DASH-008 | DOM + computed dimensions | Authenticated Case owner opens `/cases`; assert header pictogram canonical `img` source and large rendered dimensions. | No |
| S313E-DASH-009 | DOM + computed dimensions | Authenticated Event owner opens `/events`; assert header Event pictogram source and dimensions. | No |
| S313E-DASH-010 | DOM + computed dimensions | Authenticated Session owner opens `/sessions`; assert header Room pictogram source and dimensions. | No |
| S313E-DASH-011 | DOM + computed style | Seed current Session and comparison card; assert shared semantic card structure/classes, computed `borderColor`/`backgroundColor`/`boxShadow`, and `data-action-kind="PRIMARY_PROGRESS"`. | Only if DOM/style cannot establish parity |
| S313E-DASH-012 | DOM + computed style | Same fixture; assert current card accent differs from ordinary card through computed color/border/background token. | Only if style tokens are not exposed |
| S313E-DASH-013 | DOM + computed style | Seed lobby-ready Event; assert `Open lobby` semantic action and primary-blue computed style. | No |
| S313E-LOBBY-003 | Executed browser behavior + DOM | Healthy getUserMedia plus the production device-warning reconciliation used after local streams exist. A mock that only clears the warning inside the fault-simulation branch is not sufficient. Documented gap: Playwright cannot attach a live Voximplant camera; the check uses the closest provider/browser media path that invokes the same reconciliation helper. | No |
| S313E-DASH-027 | DOM + viewport geometry | Authenticated Cases page at 1280×720; header pictogram present; table body has no Case pictogram images; action controls remain inside the viewport; no unintended table horizontal overflow. | No |
| S313E-DASH-028 | DOM + computed dimensions | Authenticated `/cases/new` and `/cases/[id]/edit`; header Case pictogram. | No |
| S313E-DASH-029 | DOM + computed dimensions | Authenticated Event create and Event edit; header Event pictogram. | No |
| S313E-DASH-030 | DOM + computed dimensions | Authenticated `/sessions/new` and Session detail/edit; header Room pictogram. | No |
| S313E-DASH-014 | DOM + locale fixture | RU authenticated dashboard fixture; assert exact `Активные` heading. | No |
| S313E-DASH-015 | DOM + locale fixture | EN authenticated dashboard fixture; assert exact `Active` heading. | No |
| S313E-DASH-016 | DOM | Both locale fixtures assert Managed meetings localized headings are absent. | No |
| S313E-DASH-017 | DOM | Seed user-managed active/future/archive records; assert each card ID occurs once in state grouping. | No |
| S313E-DASH-018 | DOM | Seed Event and standalone Session with another owner; assert neutral owner display on cards. `phase-6-11a-global-visibility-ownership.spec.ts` is the closest existing ownership candidate. | No |
| S313E-DASH-019 | DOM + computed style | Seed current-user-owned Event/Session; assert localized `Owner: You`/`Владелец: Вы` and self-accent computed style. | Only if accent cannot be asserted from style |
| S313E-DASH-021 | Executed behavior + DOM | Seed future Event with current-user-relevant running nested Session; assert parent is under Active. | No |
| S313E-DASH-022 | Executed behavior + DOM | Same fixture; assert nested Session is rendered below the Active parent. | No |
| S313E-DASH-023 | DOM | Same fixture; assert parent Event ID absent from Future. | No |
| S313E-DASH-024 | DOM | Active Event fixture; assert parent action text and Event-lobby href. | No |
| S313E-DASH-025 | DOM | Same fixture; assert nested card has the Session-room href. | No |
| S313E-DASH-026 | DOM | Same fixture; assert Event card has no `Continue session`/Session-room action. | No |

**Manifest count: 106 requirements (80 original packet requirements + 18 user acceptance clarifications — 2026-08-14 + 7 user design clarifications — 2026-08-15 + 1 late-Observer Debrief entry clarification — 2026-08-15).** Five original AIPUB rows (002, 006, 007, 011, 012) remain in the table as superseded history and are judged SUPERSEDED / REPLACED_BY S313E-AIPUB-015–021.

## Transcript authorization — resolved, no change required

`TRANSCRIPT_AUTHORIZATION_CHANGE_REQUIRED=NO`

The user accepted current transcript behavior on 2026-08-15. Runtime transcript
authorization is unchanged in this pass. Observer transcript continues to follow
a valid publication grant. Participant transcript remains membership-based.
There is no open follow-up to align transcript eligibility with historical
room-entry grants.
