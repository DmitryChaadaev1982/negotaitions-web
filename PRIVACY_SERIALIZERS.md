# Privacy Serializers — NegotAItions Phase 5

## Overview

This document describes the privacy classification of case/session data, the serializer functions created in Phase 5, and the privacy decisions made for observer transcript access and AI shared reports.

---

## Privacy Classification

### Public Data

Safe to expose to all authenticated viewers (participants, observers, facilitators, hosts, admins):

| Field | Source |
|-------|--------|
| Case title | `NegotiationCase.title` |
| Business context | `NegotiationCase.businessContext` / `Session.snapshotBusinessContext` |
| Public instructions | `NegotiationCase.publicInstructions` / `Session.snapshotPublicInstructions` |
| Role names | `CaseRole.name` / `SessionRole.name` |
| Case language | `NegotiationCase.caseLanguage` |
| Difficulty | `NegotiationCase.difficulty` |
| Target skills | `NegotiationCase.targetSkills` |
| Preparation/negotiation duration | `defaultPreparationDurationSeconds`, `defaultDurationSeconds` |
| Session title, room label | `Session.title`, `Session.roomLabel` |
| Participant display names | `SessionParticipant.displayName` |
| Participant types (PARTICIPANT/OBSERVER/FACILITATOR) | `SessionParticipant.type` |

### Private/Hidden Data

Must be scoped by role — must NOT be exposed to unauthorized viewers:

| Field | Notes |
|-------|-------|
| `privateInstructions` | Core private role briefing — participant sees own only |
| `objectives` | Role objectives — participant sees own only |
| `constraints` | Role constraints — participant sees own only |
| `hiddenInfo` | Hidden role info — participant sees own only |
| `fallbackPosition` | Fallback/BATNA — participant sees own only |
| `hostToken` | Event host token — never sent to participants/observers |
| `participantToken` | Event participant token — only to self |
| `joinToken` | Session participant token — only to self |
| Facilitator-only AI analysis | Full `analysisJson` — facilitator/host/admin only |
| `roleObjectivesAnalysis` | Per-role objectives analysis in AI output — stripped from shared reports |
| `rawPrompt` | Raw AI prompt — stripped from shared reports |
| `analysisContext` | Raw AI context (includes all role briefings) — stripped from shared reports |
| `facilitatorNotes` | Facilitator notes — stripped from shared reports |

---

## Role Rules

### PARTICIPANT
- Sees: own private role briefing (full `privateInstructions`, `objectives`, `constraints`, `hiddenInfo`, `fallbackPosition`)
- Sees: public session context, public participant roster (names + role names)
- Does NOT see: other participants' private role data
- Does NOT see: facilitator-only notes
- Does NOT see: full AI analysis (only sanitized shared version when published)
- Does NOT see: own notes of other participants

### OBSERVER
- Sees: public session context
- Sees: public participant roster (names + role names)
- Does NOT see: any participant private role briefings
- Does NOT see: hidden objectives, fallback positions, BATNA
- Does NOT see: facilitator-only data
- **Transcript**: Observer sees transcript ONLY if facilitator has published the shared AI debrief (`AiAnalysis.visibility === "SHARED_WITH_SESSION"`). This is the safer MVP decision — see [Observer Transcript Decision](#observer-transcript-decision).

### FACILITATOR / HOST
- Sees: all assigned participant role briefings (needed to run the session)
- Sees: full AI analysis including `overallScore`, error messages, share controls
- Sees: speaker mapping metadata and speaker mapping controls
- Does NOT expose raw tokens to other participants

### ADMIN
- Can access private data for support/debugging
- Admin views must display warning labels:
  - **EN**: Admin view — contains private role data.
  - **RU**: Административный режим — содержит скрытые данные ролей.

---

## Serializers Created

All serializers are in `lib/privacy/serializers.ts`.

### `toPublicCaseView(negotiationCase)`
- Returns: case title, language, difficulty, business context, public instructions, target skills, durations, role names/IDs
- Excludes: all private role fields (`privateInstructions`, `objectives`, etc.)
- Used for: case library, event lobby, public case summaries

### `toEventLobbyCaseView(negotiationCase)` = `toPublicCaseView`
- Same as public case view; no private role instructions at any access level

### `scopeAssignedParticipantsForParticipant(allParticipants, currentParticipantId)`
- Own role: full private briefing
- Other roles: zeroed-out `PrivateRoleBriefing` (only `name` set)
- Used for: `/join/[joinToken]` SSR props, account materials data

### `scopeAssignedParticipantsForObserver(allParticipants)`
- All roles: zeroed-out `PrivateRoleBriefing` (only `name` set)
- Used for: observer join page, account observer materials

### `scopeAssignedParticipantsForFacilitator(allParticipants)`
- All roles: full private briefing (facilitator needs all for session management)
- Used for: facilitator join page, facilitator account materials

### `sanitizeSharedAiReport(fullAnalysis)`
- Removes: `roleObjectivesAnalysis`, `rawPrompt`, `analysisContext`, `facilitatorNotes`
- Preserves: summary, scores, strengths, improvement areas, tactics, questions analysis, `participantPersonalFeedback` (filtered per-participant at delivery)
- Used for: `AiAnalysis.sharedAnalysisJson` (stored at share time)

### `filterPersonalFeedbackForParticipant(analysis, { participantId, displayName })`
- Filters `participantPersonalFeedback` to only the entry matching the participant
- Prefers `sessionParticipantId` match; falls back to `participantName` for legacy AI output
- Used for: materials/status API delivery

### `toAdminCaseView(negotiationCase)`
- Returns: full case object + `_adminView: true` marker
- Must only be used in admin-authenticated server contexts
- UI must display admin warning label

### `canViewFullAiAnalysis(opts)`
- Returns true for: facilitator, event host owner, admin

### `canViewSharedAiAnalysis(opts)`
- Returns true when: `AiAnalysis.visibility === "SHARED_WITH_SESSION"`

---

## Hidden Fields Blocked

The following fields are explicitly blocked from shared/participant-facing API responses:

| Field | Blocked in |
|-------|-----------|
| `roleObjectivesAnalysis` | `sanitizeAnalysisForParticipants()` in share route |
| `rawPrompt` | `sanitizeSharedAiReport()` |
| `analysisContext` | `sanitizeSharedAiReport()` |
| `facilitatorNotes` | `sanitizeSharedAiReport()` |
| `privateInstructions` (other participant) | `scopeAssignedParticipants*()` |
| `objectives` (other participant) | `scopeAssignedParticipants*()` |
| `constraints` (other participant) | `scopeAssignedParticipants*()` |
| `hiddenInfo` (other participant) | `scopeAssignedParticipants*()` |
| `fallbackPosition` (other participant) | `scopeAssignedParticipants*()` |
| `joinToken` (in HTML for account users) | Room page account mode |
| `visibility`, `sharedBy`, `overallScore`, `errorMessage` (AI) | materials/status (participant/observer) |

---

## Guest Token Exceptions

The following token flows are preserved for guest (unauthenticated) users:

| Token | Where | Notes |
|-------|-------|-------|
| `joinToken` | `/join/[joinToken]` URL | Primary guest access — unchanged |
| `joinToken` | `/room/[sessionId]?joinToken=...` URL | Guest room access — unchanged |
| `hostToken` | `/events/[id]/lobby?hostToken=...` | Event host lobby — unchanged |
| `participantToken` | `/events/[id]/lobby?participantToken=...` | Event participant lobby — unchanged |
| `joinToken` | `eventSessions[].joinToken` in join page | Own sessions only (current participant's token) |

---

## Observer Transcript Decision

**Decision**: Observer sees transcript ONLY if the facilitator has published a shared AI debrief (`AiAnalysis.visibility === "SHARED_WITH_SESSION"`).

**Rationale**: The transcript may contain private discussion that was meant to be confidential. Exposing it to observers before the facilitator reviews and publishes the debrief could leak sensitive negotiation strategy. The safer MVP approach restricts observer transcript access to after the facilitator explicitly shares the analysis.

**Implementation**: `canViewTranscript` in `materials/status/route.ts` checks `AiAnalysis.visibility` for observer participants.

**Future consideration**: If product requirements clearly require observer full transcript access (e.g., for observer-training purposes), this can be explicitly enabled with a product decision and documented here.

---

## AI Shared Report Sanitization Rules

When a facilitator shares the AI analysis (`POST /api/sessions/[sessionId]/ai-analysis/share`):

1. The full analysis is sanitized using `sanitizeAnalysisForParticipants()` which calls `sanitizeSharedAiReport()`
2. The sanitized version is stored in `AiAnalysis.sharedAnalysisJson`
3. On delivery via `materials/status`, participants/observers receive `sharedAnalysisJson` (never `analysisJson`)
4. `participantPersonalFeedback` is retained in the shared version but filtered per-participant at delivery time
5. Filtering prefers `sessionParticipantId` match for accuracy; falls back to `displayName` for legacy AI output without IDs

**Limitation**: Legacy AI output that does not include `sessionParticipantId` in `participantPersonalFeedback` relies on `displayName` matching. If two participants have the same display name, one might see the other's feedback. This is documented as a known limitation; the fix is to update AI output format to include `sessionParticipantId`.

---

## ROOM-1 Token Removal

For **account users** (logged in via httpOnly cookie):
- `/room/[sessionId]` does NOT expose `joinToken` in HTML, `__NEXT_DATA__`, or React props
- `VideoRoomPage` receives `participantId` (non-secret DB UUID) + `authMode: "account"`
- All room APIs (`/api/livekit/token`, `/api/livekit/sidebar`, `/api/sessions/[sessionId]/control-state`, etc.) accept EITHER `joinToken` (guest) OR `participantId + cookie` (account)
- Cookie auth validates: `user.id === SessionParticipant.userId` OR user is admin/event host

For **guest users** (no account):
- `joinToken` flow unchanged
- `/room/[sessionId]?joinToken=...` still works as before

---

## Event State getDemoFacilitator Fix

`buildEventState()` in `lib/event-state.ts` now:
- Uses `event.hostUserId` as the case library facilitator for real account users
- Falls back to demo facilitator ONLY for legacy/guest events without a `hostUserId`

---

## Remaining Known Limitations

1. **Legacy AI output** without `sessionParticipantId` in `participantPersonalFeedback` uses displayName matching — risk of collision if two participants have same name.
2. **Debrief panel** in account mode: `SessionPostProcessingPanel` still uses `joinToken` prop internally; for account mode it is currently hidden. Full account-mode debrief panel support is a future Phase 6 item.
3. **Observer full transcript** restriction: observers are now blocked from seeing transcripts until shared debrief is published. This may affect observer-training use cases that relied on full transcript access.
4. **Admin private view labels** in UI: the admin warning label (`admin.privateRoleDataWarning`) is defined in the i18n key system but not yet applied to specific admin UI pages (admin session detail, admin case detail). This should be added in Phase 6 UI review.
5. **Prisma schema unchanged**: No schema changes were required for Phase 5. The `participantId` field in AI output for `participantPersonalFeedback` does not exist in the schema — this is a future AI output format improvement.
