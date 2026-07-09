# Stage 3.6 Session Participant and Role Assignment UI Audit

## 1. Executive summary
- Current state: participant/role assignment exists in multiple surfaces with partially overlapping logic: standalone session detail (`AddParticipantForm` + `SessionRoleManagementPanel`), room sidebar compact role panel, and event lobby draft assignment panel.
- Main inconsistencies:
  - Standalone session detail uses two role controls (add form role selector + separate role management panel) with different state lifecycles.
  - Room/facilitator role UI is conceptually same component as standalone management, but rendered through different data source/refresh model.
  - Event lobby uses a separate assignment model and visual language (role-per-select + observer checkbox list).
  - Join-by-link and account room entry can produce different defaults (invited participant vs auto-created observer).
- Risk level: **medium-high** for UX confusion and role integrity under concurrent edits (UI-level duplicate prevention is inconsistent; DB-level uniqueness constraint is absent).
- Recommended direction: adopt one canonical slot-first assignment model for negotiation roles, with participant-first roster and explicit facilitator/observer handling reused across standalone, room, and event contexts.

## 2. Current workflows

### 2.1 Standalone session creation
- Route: `/sessions/new` via `app/(app)/sessions/new/page.tsx` -> `components/new-session-page-client.tsx` -> `components/new-session-form.tsx`.
- Current behavior:
  - Select facilitator/owner (`facilitatorUserId`), session metadata, visibility, invitees.
  - **No role assignment UI during creation**.
  - Creates `Session` + `SessionRole` snapshots + one `FACILITATOR` `SessionParticipant` in `createSession` (`app/actions/sessions.ts`).
- Result: role assignment starts only after session is created.

### 2.2 Standalone session management
- Route: `/sessions/[id]` via `app/(app)/sessions/[id]/page.tsx` -> `components/session-detail-view.tsx`.
- Workflow A (participant add):
  - `components/add-participant-form.tsx` lets facilitator add user/email and choose type (`PARTICIPANT`/`OBSERVER`).
  - For `PARTICIPANT`, role is optional (`assignRoleLater`) and filtered by `assignedRoleIds` snapshot passed from server.
  - Action: `addAccountParticipant` in `app/actions/sessions.ts`.
- Workflow B (role management):
  - Separate `components/session-role-management-panel.tsx` rendered below add form in PREPARATION only.
  - Uses local `draft` state and submits batch to `assignParticipantRole` server action.
- Current issue pattern:
  - User can pick role in add form, then sees same participant in second role panel.
  - Second panel may show stale/unexpected role values because it owns independent local draft state and does not reset from prop changes.

### 2.3 Direct session join by link
- Route: `/join/[joinToken]` (`app/join/[joinToken]/page.tsx`) now performs account binding and redirects to `/sessions/[id]/materials`.
- Join flow behavior:
  - Binds `SessionParticipant.userId` (and linked `EventParticipant.userId` when present) if unclaimed.
  - Redirects to account materials route.
- If participant has no assigned negotiation role:
  - `lib/account-session-materials.ts` sets `hasAssignedRole=false` for `PARTICIPANT` without `sessionRoleId`.
  - Materials/notes become locked (`notesVariant: "locked"`), waiting message shown.

### 2.4 Facilitator room role management
- Route: `/room/[sessionId]` (`app/room/[sessionId]/page.tsx`) -> `components/shared-room-shell.tsx` (RoomSidebar).
- Facilitator sees compact `SessionRoleManagementPanel` in sidebar during `PREPARATION`.
- Data source:
  - Sidebar roster/roles come from `lib/room-sidebar.ts` (via `/api/livekit/sidebar` and account participant resolution).
- Assignment mutation:
  - Same server action as standalone panel: `assignParticipantRole`.

### 2.5 Event lobby/session role management
- Route: `/events/[id]/lobby` (`app/events/[id]/lobby/page.tsx`) -> `components/event-lobby-view.tsx` -> `components/event-host-controls-panel.tsx`.
- Host session setup includes:
  - facilitator select (`facilitatorEventParticipantId`)
  - per-case-role participant selects (`roleAssignments`)
  - observer checkbox list (`observerEventParticipantIds`)
- Create session call:
  - `POST /api/events/[id]/host` -> `createSessionFromEvent` (`lib/create-event-session.ts`).
- Event creation/edit (`/events/new`, `/events/[id]/edit`) does not assign case negotiation roles; only facilitator/owner/invitees.

### 2.6 Observer/facilitator flows
- Facilitator:
  - Stored at session level (`Session.facilitatorId`) and participant level (`SessionParticipant.type=FACILITATOR`).
  - Event-level facilitator ownership stored in `TrainingEvent.facilitatorUserId`, session setup chooses facilitator event participant for each created session.
- Observers:
  - Explicit type (`ParticipantType.OBSERVER`) in DB, not inferred-only.
  - Many observers allowed (no cardinality limit in schema).
  - Non-facilitator account entering room without existing row defaults to observer (`ensureAccountRoomParticipant`).

## 3. Current components and routes

| screen | route | component | APIs/actions used | current behavior | issues |
|---|---|---|---|---|---|
| Standalone session creation | `/sessions/new` | `new-session-form.tsx` | `createSession` action | Creates session, facilitator participant, invitees | No role assignment at creation; later screen differs |
| Standalone session management (add) | `/sessions/[id]` | `add-participant-form.tsx` | `addAccountParticipant` action | Add participant/observer + optional role | Duplicates role assignment surface with role panel |
| Standalone session management (roles) | `/sessions/[id]` | `session-role-management-panel.tsx` | `assignParticipantRole` action | Batch reassign/unassign/observer conversion | Local draft can desync; no inline duplicate-role disabling |
| Facilitator room sidebar | `/room/[sessionId]` | `shared-room-shell.tsx` (RoomSidebar) + `session-role-management-panel.tsx` compact | `/api/livekit/sidebar`, `assignParticipantRole` | Compact role management in PREPARATION | Visual divergence from full page; separate data-refresh path |
| Event session setup in lobby | `/events/[id]/lobby` | `event-host-controls-panel.tsx` | `PATCH/POST /api/events/[id]/host` -> `createSessionFromEvent` | Assign facilitator + role slots + observers before creating session | Separate UX paradigm from standalone; weak UI duplicate prevention |
| Event join preference | `/events/[id]/join` | `account-event-join-view.tsx` | `joinTrainingEvent` action | User sets preference only | No direct role-slot workflow; assignment happens elsewhere |
| Direct join-by-link binding | `/join/[joinToken]` | `app/join/[joinToken]/page.tsx` | DB bind then redirect | Claims/binds token to account and redirects to materials | If role missing, user lands in locked/waiting state |
| Legacy Vox sidebar | n/a (deprecated) | `voximplant-room-sidebar.tsx` | none (deprecated) | Kept for transition | Marked unused/deprecated; should be cleaned later |
| Legacy token materials view | n/a in active account flow | `join-page-view.tsx` + `session-materials-dashboard.tsx` | legacy joinToken flow UI | Not in active account materials route | Potential confusion during future changes |

## 4. Data model and API review

- Participant model:
  - `SessionParticipant`: `type`, optional `sessionRoleId`, optional `userId`, optional `eventParticipantId`.
  - `EventParticipant`: preference and assignment linkage fields (`assignedSessionId`, `assignedSessionParticipantId`).
- Facilitator model:
  - Session owner/facilitator is `Session.facilitatorId`.
  - Canonical facilitator participant resolved by `lib/session-facilitator.ts` (`resolveSessionParticipantType` can demote non-canonical facilitator rows to observer).
  - Event owner/facilitator are `TrainingEvent.hostUserId` and `TrainingEvent.facilitatorUserId`; per-session facilitator selected by `facilitatorEventParticipantId`.
- Observer model:
  - Observer is explicit `ParticipantType.OBSERVER`.
  - Also behaviorally inferred in some flows as "non-facilitator auto room entrant".
- Role assignment model:
  - Standalone: `SessionParticipant.sessionRoleId` for `PARTICIPANT`.
  - Event setup: draft `roleAssignments` keyed by case role -> event participant, transformed into session participants with `sessionRoleId`.
- Uniqueness validation:
  - Standalone add/reassign: enforced in application logic (`addAccountParticipant`, `assignParticipantRole`).
  - Event setup: enforced in `createSessionFromEvent` (`duplicateRoleAssignment`, facilitator-player conflicts).
- Gaps:
  - No DB unique constraint guaranteeing one `SessionParticipant` per `sessionRoleId`.
  - Race window exists for concurrent role updates despite server checks.
  - Multiple UI pathways do not share one canonical in-memory state.

## 5. UI problems

- Duplicate controls:
  - Standalone detail page has role choice in add form and second role management panel.
- Unsynchronized selected role:
  - `SessionRoleManagementPanel` keeps local draft initialized once from props; it does not reconcile when participant-role props change.
- Inconsistent visual language:
  - Full standalone panel vs compact room panel vs event lobby assignment block all differ.
- Poor scaling for many participants:
  - Standalone participants table is long and dense; event observer assignment uses checkbox list without grouping/search in role setup context.
- Event vs standalone divergence:
  - Event uses slot assignment during session creation; standalone uses participant-add then optional reassignment.
- Observer behavior clarity:
  - Observer may be explicit type, or resulting default in account room entry; user-facing rule is not consistently communicated.

## 6. Target product rules

- Role uniqueness:
  - Negotiation case roles are exclusive slots (0..1 participant each).
  - One participant can occupy at most one negotiation role.
- Participant/observer/facilitator rules:
  - Facilitator is separate from negotiation participant role.
  - Observers are many and not role-slot competitors.
- All roles assigned behavior:
  - Once all negotiation role slots are occupied, new joiners/additions should default observer unless facilitator explicitly reassigns/moves slot.
- Many participants behavior:
  - Participant-first roster with compact, sortable/filterable status + role + facilitator marker.
- Direct join behavior:
  - Joining should never auto-steal occupied role slots.
  - Free slots can be assigned explicitly by facilitator.

## 7. Target unified UI proposal

- Full page layout (`/sessions/[id]`, event host setup equivalent):
  - Slot-first assignment section (fixed case role slots -> participant dropdown).
  - Participant-first roster section (all invited/joined, role/observer/facilitator markers).
  - Single canonical assignment state rendered across all blocks.
- Compact room layout:
  - Same assignment semantics, compact rendering only.
  - Reuse same state + validation logic.
- Event lobby adaptation:
  - Keep event context, but reuse same slot/roster patterns and helper logic.
- Add participant behavior:
  - Add only person/type intent; optional role assignment writes into same canonical slot state.
  - No secondary unsynced role panel behavior.
- Role slot assignment behavior:
  - Assigned role disabled/removed in other dropdowns.
  - Explicit move/unassign interaction when switching occupied slot.

## 8. Minimal implementation plan

### Phase 1
- Fix duplicated role selection in standalone session management:
  - Keep add form + role panel conceptually, but drive both from one canonical assignment state in UI.
- Make role assignment state canonical:
  - Sync `SessionRoleManagementPanel` draft with incoming participant props when source changes.
  - Ensure role selected in add flow appears immediately and consistently in role panel + participants table.
- Prevent duplicate role choices in UI:
  - Disable/hide occupied roles in each participant selector (with explicit move flow hint).

### Phase 2
- Extract shared role assignment component (slot-first + participant roster composition).
- Reuse in standalone detail and room sidebar.

### Phase 3
- Apply same component/pattern to event lobby host setup.

### Phase 4
- Remove deprecated/legacy role/participant components and stale pathways.

## 9. Files to change later

- Standalone session management UI:
  - `components/session-detail-view.tsx`
  - `components/add-participant-form.tsx`
  - `components/session-role-management-panel.tsx`
  - `components/participants-table.tsx`
- Room/facilitator compact assignment:
  - `components/shared-room-shell.tsx`
  - `lib/room-sidebar.ts`
  - `lib/room-sidebar-types.ts`
- Event lobby/session setup:
  - `components/event-host-controls-panel.tsx`
  - `components/event-lobby-view.tsx`
  - `lib/event-assignment.ts`
  - `lib/event-state.ts`
- Validation/actions/APIs:
  - `app/actions/sessions.ts`
  - `app/api/events/[id]/host/route.ts`
  - `lib/create-event-session.ts`
  - `lib/validations/session.ts`
  - `lib/validations/event.ts`
- Legacy cleanup candidates:
  - `components/voximplant-room-sidebar.tsx` (deprecated)
  - `components/join-page-view.tsx` (legacy path not in active account flow)
- Tests to add/update:
  - `tests/e2e/phase-6-11b-session-role-assignment.spec.ts`
  - event lobby E2E covering duplicate role prevention and observer defaults
  - room/sidebar parity tests for assignment visibility

## 10. Test plan

- Standalone creation:
  - Create session and verify no accidental role-slot conflicts.
- Add participant with role:
  - Selected role visible consistently in add area, role panel, roster.
- Add participant without role:
  - Participant marked unassigned/observer according to rule; notes lock behavior for unassigned participant verified.
- Duplicate role prevention:
  - UI blocks selecting already occupied role unless explicit move path is used.
  - Backend still rejects duplicate role race.
- All roles assigned -> new participant observer:
  - UI message shown: roles filled, newcomers observer by default.
- Join by link with open role:
  - Facilitator can assign free slot explicitly; no auto-claim.
- Join by link with no role:
  - User enters as observer/unassigned participant per model; no role theft.
- Room compact role management:
  - Same assignments visible and editable consistently with full page.
- Event lobby role assignment:
  - Same slot semantics and duplicate prevention behavior.
- Many participants:
  - Usability with large roster (scroll, status visibility, assignment clarity).
- Facilitator isolation:
  - Facilitator is never counted/treated as negotiation role participant.

## 11. Implementation prompt for next step

Use this prompt for **Phase 1 only**:

> You are working in `negotiations-web` on branch `feature/stage-3-6-phase-1-role-ui-canonical-state`.
>
> Goal (Phase 1 only): fix standalone session management role UX inconsistencies without DB/schema/API contract changes.
>
> Scope:
> - Route: `/sessions/[id]`
> - Components: `session-detail-view.tsx`, `add-participant-form.tsx`, `session-role-management-panel.tsx`, `participants-table.tsx`
> - Keep existing actions/APIs (`addAccountParticipant`, `assignParticipantRole`) unless tiny compatibility tweaks are required.
>
> Must implement:
> 1. Canonical role assignment state for page-level standalone management:
>    - Ensure role selected during participant add is reflected immediately and consistently in role management panel and participant list.
>    - Eliminate stale draft mismatch in `SessionRoleManagementPanel` when participants/roles props update.
> 2. Remove duplicate-role confusion:
>    - In role selectors, occupied roles must be disabled/hidden for other participants.
>    - Preserve explicit reassignment path (unassign/move) with clear UX.
> 3. Keep UI surface count unchanged for Phase 1:
>    - Do not add/remove major UI sections.
>    - Do not refactor event lobby or room shell in this phase.
>
> Constraints:
> - No runtime API behavior changes beyond UI consistency requirements.
> - No DB schema changes.
> - No component extraction yet (that is Phase 2).
>
> Validation:
> - Verify standalone `/sessions/[id]` flow for:
>   - add participant with role
>   - add participant without role
>   - role panel sync after add
>   - duplicate role prevention in UI
> - Update/add focused E2E tests around these scenarios.

