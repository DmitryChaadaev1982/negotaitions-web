# Stage 2 Final Baseline Correction Audit

## Scope and guardrails

- Scope: Stage 2 correction only (Event Lobby identity/lease behavior + observer AI sharing behavior + baseline readiness).
- Stage 3 is not started.
- No Prisma schema/migrations changes in this correction.
- No Voximplant recording webhook route changes.
- No Voximplant scenario/rule changes.
- No recording dispatch contract changes.
- No Yandex SpeechKit/Yandex AI/DeepSeek generation internals changes.

## 1) Current Event Lobby participant identity model

- Domain participant identity in payload:
  - `EventStateParticipant.id` = `EventParticipant.id` (DB row identity).
  - `EventParticipant.userId` is optional account identity binding.
  - `displayName`, `isHost`, `preference`, `lastSeenAt`, assignment links.
- Provider/media identity in Vox lobby:
  - `VideoProviderIdentity.providerUsername` -> Vox `sdkUsername` in `voximplant-access`.
  - This identity is transport-level and independent from lobby participant card identity.
- Connection lease identity:
  - Lease key: `(eventId, userId)` in `lib/event-lobby-connection-lease.ts`.
  - Active lease value: `{ connectionId, version }`.
- Online/offline representation:
  - Lobby participant cards use `ConnectionStatusBadge(lastSeenAt)` from event state.
  - Lease status is currently not represented as a participant-list property.

## 2) Why same user can appear twice in lobby participant list

Root cause is in state shaping, not only in lease claiming:

- `buildEventState` currently maps *all* `EventParticipant` rows directly to lobby cards.
- When historical/legacy duplicate `EventParticipant` rows exist for same `(eventId, userId)`, both rows are rendered.
- Because row identity is used directly (`participant.id`), stale/older duplicate rows are shown as separate participants.
- Lease correctly blocks stale tab mutations (`409 STALE_CONNECTION`) but does not deduplicate participant rows in state payload.

## 3) Duplicate source diagnosis

- Duplicate `EventParticipant` rows: **possible and currently impactful**.
  - App logic attempts duplicate prevention (`findFirst` + serializable transaction), but there is no guaranteed DB unique constraint on `(eventId, userId)` in current schema.
  - Existing historical duplicate rows can still exist and are not normalized at read time.
- Connection lease records: **not a direct source of duplicate cards**.
  - Lease store is in-memory per `(eventId, userId)` and does not create participant rows.
- Provider endpoints (Vox/LiveKit): **not a source of duplicate participant cards**.
  - Provider endpoints handle media identity only.
- UI mapping/rendering: **contributes to symptom**.
  - `EventLobbyView` renders `state.participants` one-to-one with no domain dedupe.
- Stale polling state: **secondary symptom only**.
  - Stale tab still polls and can remain visually active in media area until unmounted.

## 4) Current lobby lease takeover behavior

- Newest-wins enforcement exists in:
  - `GET /api/events/[id]/state` (optional `claimLease=1`)
  - `POST /api/events/[id]/voximplant-access` (optional `claimLease=true`)
  - `POST /api/events/[id]/livekit-token` (optional `claimLease=true`)
- Stale tab action blocking exists in:
  - `PATCH/POST /api/events/[id]/host`
  - `PATCH /api/events/[id]/participant`
  - `GET /api/events/[id]/state`
  - `POST /api/events/[id]/voximplant-access`
  - `POST /api/events/[id]/livekit-token`
- Gap: stale tab visual behavior in lobby:
  - Stale state is detected and banner shown.
  - But lobby media area can remain mounted/active, so stale tab may still look online.
  - Preference/host controls are not explicitly disabled client-side on stale state (server rejects, but UX is weak).

## 5) Required deduplication key and rendering model

- Required domain dedupe key:
  - Primary: `(eventId, userId)` for account-bound participants (`userId != null`).
  - Fallback for token/guest rows (`userId == null`): `EventParticipant.id`.
- Rendering model:
  - Exactly one participant card per dedupe key.
  - Connection/lease is status of that card, not separate card identity.
  - Reconnect/takeover updates participant state for same domain identity.

## 6) Current AI analysis/materials sharing flow

- Facilitator share action source:
  - `components/session-post-processing-panel.tsx`
  - `components/session-materials-dashboard.tsx`
  - Calls `POST /api/sessions/[sessionId]/ai-analysis/share` with explicit consent flag.
- API route:
  - `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`
  - Loads full `aiAnalysis.analysisJson`, sanitizes with `sanitizeSharedAiAnalysisForParticipant`, stores in `sharedAnalysisJson`, sets `visibility=SHARED_WITH_SESSION`.
- Read/display route:
  - `GET /api/sessions/[sessionId]/materials/status`
  - Facilitator: reads full `analysisJson`.
  - Participant/observer when shared: reads `sharedAnalysisJson`.
  - Participant: additional filter by participant identity via `filterPersonalFeedbackForParticipant(...)`.
  - Observer: explicit deletion of `participantPersonalFeedback` before response.

## 7) Current observer analysis result state

- Current code path is mostly correct for privacy target:
  - Before share: observer gets placeholder/no analysis.
  - After share: observer receives sanitized shared analysis without participant personal feedback.
- Remaining risk:
  - Role-based projection logic is distributed inline in `materials/status` route, not centralized into explicit role projection helpers.
  - This makes future regression easier if new fields are added.

## 8) Safe fields/sections for observers

Observer-safe:

- Shared/general analysis sections (summary, aggregate scores, strengths/improvement themes, general tactics/debrief themes).
- Shared executive summary.

Observer-unsafe (must not leak):

- `participantPersonalFeedback`
- participant-targeted next steps/recommendations
- any private role/briefing/objective/fallback content
- facilitator-only notes or internal prompt/context/debug data

## 9) Minimal fix plan

1. Lobby identity dedupe at read layer:
   - Dedupe participants in `buildEventState` by domain identity key:
     - `(eventId,userId)` for account rows;
     - `eventParticipant.id` for unbound rows.
   - Keep one authoritative representative row per identity.
   - Ensure `currentParticipant` in state resolves to canonical row.

2. Deterministic participant resolution for account users:
   - Replace ambiguous `findFirst` participant selection with deterministic most-recent/most-authoritative selection in event access + participant ensure helper.
   - Avoid phantom duplicate rendering from stale row selection.

3. Stale-tab UX hardening in lobby:
   - On stale state, unmount/disable lobby media + mutation controls.
   - Show localized takeover message via existing i18n key path.
   - Keep retry/return actions available, block host/participant actions.

4. Centralize analysis projection helpers:
   - Add explicit helpers in analysis/privacy layer:
     - facilitator -> full analysis
     - participant -> shared + own personal feedback only
     - observer -> shared general analysis only (no personal feedback)
   - Use helpers from `materials/status` route.

5. Tests:
   - Add/extend tests for lobby duplicate prevention + stale takeover blocking.
   - Add/extend tests for observer/participant/facilitator analysis projection and leakage prevention.

## 10) Stage 2 checkpoint readiness after these fixes

- After implementing items above and passing lint/build/prisma/playwright suites, Stage 2 can be considered baseline-ready pending requested manual multi-user smoke checks.
