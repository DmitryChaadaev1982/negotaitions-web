# AUTH_ACCESS_AUDIT.md

**Project:** NegotAItions — negotiation training platform  
**Scope:** Read-only access-model audit before MVP auth, admin approval, account rejoin, and personal dashboard  
**Codebase root:** `negotiations-web/`  
**Date:** 2025-06-25

---

## 1. Executive summary

NegotAItions currently has **no real authentication**. Access is split between:

1. **Opaque capability tokens** (`hostToken`, `participantToken`, `joinToken`) passed in URLs, form bodies, or query strings.
2. **Implicit “demo facilitator” identity** via `getDemoFacilitator()` (`demo@example.com`) for all authenticated-app routes under `(app)/` — but this is **not** tied to HTTP sessions, cookies, or login.
3. **Guest-compatible flows** for event join, lobby, session room, and session materials — anyone with a token or public join code can participate.
4. **localStorage recovery** (`negotaitions.recovery.v1`) for rejoin across browser restarts (12h default TTL).

**Admin/diagnostics:** `/admin` and `/api/admin/*` call `getDemoFacilitator()` but perform **no request authentication**. Any visitor can load diagnostics if the seeded demo user exists.

**Major risks before deployment:**

| Risk | Severity |
|------|----------|
| No login/session; facilitator pages are world-readable | Critical |
| `hostToken` / `participantToken` exposed in dashboard & events list HTML | Critical |
| Private role briefings serialized to all `joinToken` holders (SSR props) | Critical |
| `cancelTrainingEvent` server action has **no** token/auth check | Critical |
| Facilitator APIs (`/api/sessions/*/notes`, `presence`, `display-status`) callable without auth | High |
| Events list returns **all** events globally (not owner-scoped) | High |
| Token leakage = full session/materials access | High |
| Duplicate `EventParticipant` on re-join without stored token | Medium |
| `User.passwordHash` exists in schema but is unused | Medium |

There is **no** `middleware.ts`. There is **no** `UserSession` model. `SessionParticipant.userId` exists but is never set; `EventParticipant` has no `userId` field.

---

## 2. Current access tokens

Tokens are generated with `nanoid(21)` via `lib/join-token.ts` → `lib/event-tokens.ts`.

### hostToken

| Aspect | Detail |
|--------|--------|
| **Generated** | `app/actions/events.ts` → `createTrainingEvent()` |
| **Stored** | `TrainingEvent.hostToken` (DB, unique); URL query `?hostToken=`; `localStorage` recovery; SSR props on dashboard/events list |
| **Routes/APIs accepting it** | `GET /api/events/[id]/state`; `PATCH/POST /api/events/[id]/host`; `POST /api/events/[id]/complete`; `POST /api/events/[id]/heartbeat`; `POST /api/events/[id]/presence/*`; `POST /api/events/[id]/livekit-token` (with `participantToken`); `POST /api/rejoin/validate` (EVENT_LOBBY); lobby page query param |
| **Permissions** | Event host: select case, edit assignment draft, create sessions, complete event, see all lobby participants, see others' `joinToken`s in event state, open facilitator session detail `/sessions/[id]` |
| **Exposure** | **Too much** — returned in `getTrainingEventsForList()` to dashboard and `/events` without any caller auth |
| **Risks** | Bearer secret in URLs (logs, referrers, browser history); host can impersonate full event control |
| **Migration** | Bind to `TrainingEvent.hostUserId`; keep short-lived guest `hostToken` only during transition; never embed in list UIs for logged-in users |

**Files:** `lib/event-auth.ts` (`resolveEventAccess`), `lib/event-state.ts`, `app/actions/events.ts`, `lib/event-overview-stats.ts`

### participantToken

| Aspect | Detail |
|--------|--------|
| **Generated** | Host participant on event create; new participants on `joinTrainingEvent()` |
| **Stored** | `EventParticipant.participantToken` (DB); URL `?participantToken=`; `localStorage` |
| **Routes/APIs** | Same event APIs as above (without host-only mutations); `PATCH /api/events/[id]/participant`; rejoin validate |
| **Permissions** | Lobby access, preference updates, own assignment visibility; own `joinToken` in event state (not others') |
| **Identifies EventParticipant?** | **Yes** — `resolveEventAccess` looks up `eventId + participantToken` |
| **Risks** | Re-joining without token creates duplicate participant; token in URL |
| **Migration** | Add `EventParticipant.userId`; dedupe on `(eventId, userId)`; guest token optional fallback |

**Files:** `lib/event-auth.ts`, `app/actions/events.ts`, `lib/rejoin/validate.ts`

### joinToken

| Aspect | Detail |
|--------|--------|
| **Generated** | Per `SessionParticipant` in `lib/create-event-session.ts` and standalone session creation in `app/actions/sessions.ts` |
| **Stored** | `SessionParticipant.joinToken` (DB); `/join/[joinToken]` path; `/room/[sessionId]?joinToken=`; `localStorage` |
| **Routes/APIs** | All session participant APIs (control, materials, transcript, recording, LiveKit, presence, notes with token, etc.) |
| **Permissions** | Scoped to one `SessionParticipant` row; facilitator type unlocks control & post-processing |
| **Identifies SessionParticipant?** | **Yes** — `getSessionParticipantByJoinToken(joinToken, sessionId?)` |
| **Risks** | Full materials/transcript access for any holder; observers get full transcript via materials API |
| **Migration** | Bind `SessionParticipant.userId`; server-side session cookie + joinToken for guests |

**Files:** `lib/session-participant-auth.ts`, `lib/config.ts` (URL builders)

---

## 3. Current route access matrix

| Route/API | Access today | Token used | Data returned | Mutations | Risk | Recommended future rule |
|-----------|--------------|------------|---------------|-----------|------|-------------------------|
| `/` | Public | — | Redirect | — | Low | Public |
| `/dashboard` | Implicit demo facilitator | — | Demo facilitator case/session counts; **all events with hostToken** | — | Critical | Auth + `hostUserId` / participant filter |
| `/cases` | Implicit demo facilitator | — | Demo facilitator's cases (public fields) | — | High | Auth + owner filter |
| `/cases/[id]` | Implicit demo facilitator | — | **Full case + all private role fields** | — | High | Auth + owner; serializer |
| `/cases/new`, `/cases/[id]/edit` | Implicit demo facilitator | — | Forms | Create/update case | High | Auth + approved user |
| `/events` | **Public** | — | **All events + hostToken + hostParticipantToken** | Create via `/events/new` | Critical | Auth; own events only |
| `/events/new` | **Public** | — | Form | `createTrainingEvent` | High | Auth; set `hostUserId` |
| `/events/[id]/join` | Public | — | Event title | `joinTrainingEvent` | Medium | Public join OK; bind user if logged in |
| `/events/join/[publicJoinCode]` | Public | — | Redirect | — | Low | Keep public code → join |
| `/events/[id]/lobby` | Token | hostToken / participantToken | Client fetches event state | Via APIs | Medium | Token **or** logged-in event access |
| `/sessions` | Implicit demo facilitator | — | Demo facilitator sessions + join tokens in list | — | High | Auth + ownership |
| `/sessions/[id]` | Implicit demo facilitator | — | **All roles private data, all join URLs** | Facilitator actions | Critical | Auth host/facilitator/admin |
| `/sessions/new` | Implicit demo facilitator | — | Form | Create session | High | Auth |
| `/join/[joinToken]` | **Token in path** | joinToken | **Private roles (SSR), transcript, recording** | Notes via API | Critical | Token **or** user session; role-scoped SSR |
| `/room/[sessionId]` | Token query | joinToken | LiveKit room | Control APIs | Medium | Same as join |
| `/rejoin` | Public + localStorage | recovery tokens | Validates server-side | — | Medium | Server rejoin by user session |
| `/admin` | **Unprotected** (demo user check only) | — | Diagnostics UI | — | Critical | `isAdmin(user)` only |
| `GET /api/events/[id]/state` | Token | host/participant | Full event state; host sees case library | — | Medium | + user binding |
| `PATCH /api/events/[id]/host` | hostToken | hostToken | Updated state | Case/draft/session create | Medium | hostUserId or hostToken |
| `PATCH /api/events/[id]/participant` | participantToken | participantToken | Updated state | Preference | Low | + userId |
| `POST /api/events/[id]/complete` | hostToken | hostToken | Completion result | Completes event | Medium | hostUserId or hostToken |
| `POST /api/events/[id]/heartbeat` | Token | host/participant | ok | Presence | Low | + user |
| `POST /api/events/[id]/livekit-token` | Token | host/participant | LiveKit JWT | — | Medium | + user |
| `GET /api/events/overview` | **Auth (ACTIVE user or admin)** | — | User-scoped event stats (admin sees all) | — | ~~High~~ **Fixed** | ✅ `apiRequireActiveUser` + `getEventOverviewStatsForUser(user)` |
| `POST /api/sessions/[id]/control` | joinToken (facilitator) | joinToken | Control state | Negotiation control | Low | Keep + user |
| `GET /api/sessions/[id]/control-state` | joinToken | joinToken | Control state | Auto-finish side effects | Medium | Keep + user |
| `GET /api/sessions/[id]/materials/status` | joinToken | joinToken | Recording, **full transcript**, AI (filtered) | — | High | Role-based transcript/AI |
| `POST .../materials/transcribe` | joinToken (facilitator) | joinToken | Job status | Start transcription | Low | Facilitator only |
| `POST .../materials/retranscribe` | joinToken (facilitator) | joinToken | — | Re-transcribe | Low | Facilitator only |
| `GET/POST .../speaker-mapping` | joinToken (POST: facilitator) | joinToken | Mapping data | Edit mapping | Medium | GET: facilitator; participants read-only safe view |
| `POST .../analyze` | joinToken (facilitator) | joinToken | Analysis | Run AI | Low | Facilitator |
| `POST .../ai-analysis/share` | joinToken (facilitator) | joinToken | — | Share sanitized AI | Low | Facilitator |
| `POST .../ai-analysis/unshare` | joinToken (facilitator) | joinToken | — | Unshare | Low | Facilitator |
| `GET .../recording` | joinToken (facilitator) | joinToken | Full recording+transcript | — | Medium | Facilitator |
| `POST .../transcript` | joinToken (facilitator) | joinToken | — | Manual transcript | Low | Facilitator |
| `POST /api/livekit/token` | joinToken | joinToken | LiveKit JWT | — | Medium | Keep |
| `GET /api/livekit/sidebar` | joinToken | joinToken | **Role briefings for facilitator** | — | High | Server-filter by participant type |
| `GET .../notes` | **Unprotected** (demo facilitator) | — | All participant notes | — | Critical | Auth facilitator |
| `GET .../participants/[id]/notes` | joinToken **or unprotected** | joinToken optional | Notes | — | Critical | Require token or auth |
| `GET .../presence` | **Unprotected** | — | Presence | — | High | Auth |
| `GET .../display-status` | **Unprotected** | — | Status | — | Medium | Auth |
| `GET /api/sessions/overview` | **Auth (ACTIVE user or admin)** | — | User-scoped session stats (admin sees all) | — | ~~High~~ **Fixed** | ✅ `apiRequireActiveUser` + `getSessionOverviewStatsForUser(user)` |
| `GET /api/admin/health` | **Unprotected** | — | Config flags, **ExternalServiceEvents**, usage | — | Critical | Admin only |
| `GET /api/admin/*` | **Unprotected** | — | Health checks | — | Critical | Admin only |
| Server actions `cases.ts` | Implicit demo facilitator | — | — | CRUD cases | High | Auth |
| Server actions `events.ts` | **Mostly public** | hostToken for complete | — | Create/join/cancel/complete | Critical | Auth + tokens |
| Server actions `sessions.ts` | Implicit demo facilitator | — | — | CRUD sessions | High | Auth |

**Note:** There is no `/api/cases/*` — cases use server actions in `app/actions/cases.ts`.

---

## 4. Current user/participant identity model

### displayName

- Collected at event join (`joinTrainingEvent`) and copied to `SessionParticipant.displayName` on session creation.
- No uniqueness constraint per event.
- Used for AI personal-feedback filtering (`participantName === displayName`) — fragile if names collide.

### EventParticipant creation

- **Host:** created with event in `createTrainingEvent`.
- **Guest:** `joinTrainingEvent` creates new row with new `participantToken` unless existing token matches.
- **No `userId`** on `EventParticipant`.

### SessionParticipant creation

- Created in `createSessionFromEvent` with `eventParticipantId` link, `joinToken`, optional `userId` (always null today).
- Standalone sessions via `app/actions/sessions.ts` also create participants with tokens.

### Duplicate person in one Event

- **Yes.** Clearing localStorage and re-joining with same display name creates a **new** `EventParticipant`.
- No dedupe on email or displayName.

### Identity across browser/device

- **Does not survive** without token. `participantToken` / `joinToken` in localStorage only on same browser.
- `userId` on `SessionParticipant` exists in schema but is never set.

### localStorage keys

| Key | Content |
|-----|---------|
| `negotaitions.recovery.v1` | `{ type, eventId?, sessionId?, hostToken?, participantToken?, joinToken?, displayName?, updatedAt }` |

TTL: `NEXT_PUBLIC_RECOVERY_TTL_HOURS` (default 12h). Written by `event-lobby-view`, `video-room-page`, `join-recovery-sync`.

### Rejoin flow

1. `/rejoin` reads localStorage → `POST /api/rejoin/validate` → server validates tokens.
2. Routes to: active room, materials, or lobby.
3. Completed events reject lobby rejoin; finished sessions route to materials.

### Where `userId` should be added later

- `TrainingEvent.hostUserId`
- `EventParticipant.userId` (nullable for guests)
- `SessionParticipant.userId` (copy from event participant on assignment)
- New `User` / `UserSession` for login

### Risks

- Duplicate EventParticipant / SessionParticipant
- Lost access after clearing storage
- Token leakage → full materials access
- Session results ownership unclear (tied to tokens, not users)

---

## 5. Current role and permission model

### Host / organizer

- Identified by `hostToken === TrainingEvent.hostToken` in `resolveEventAccess`.
- Host `EventParticipant` row (`isHost: true`) also has `participantToken`.
- Can complete event, create sessions, see all join links in event state.

### Facilitator

- **Session-scoped:** `SessionParticipant.type === FACILITATOR`.
- Chosen at event session creation from `facilitatorEventParticipantId`.
- Rights checked server-side on control, transcription, AI, speaker mapping APIs via `joinToken` + type.
- **Account-level** `User.role === FACILITATOR` only affects demo case ownership — not session facilitator rights.

### Participant

- `SessionParticipant.type === PARTICIPANT` with `sessionRoleId`.
- Sees own private briefing (UI); server currently sends all briefings in SSR props (see §6).
- Can view transcript/recording via materials API (`canViewTranscript = true`).

### Observer

- `SessionParticipant.type === OBSERVER`.
- UI hides private briefings; **server still loads full briefing data** on join page and materials API returns full transcript.
- Notes panel available (observer variant).

### Admin diagnostics

- `getDemoFacilitator()` — not admin; just ensures seed user exists.
- **No access control.**

### Facilitator rights checks

- Server-side on session APIs via `joinToken`.
- Event lobby session creation: `hostToken` only.

### Observer privacy server-side

- **Partially enforced** for AI (shared vs facilitator-only).
- **Not enforced** for private role SSR props or transcript visibility to observers.

### UI-only hiding

- `join-page-view.tsx`: facilitator briefings UI-only for facilitator.
- `room-sidebar.ts`: `facilitatorBriefings` only populated for facilitator type — **good** for API.
- Join page SSR: **bad** — all `assignedParticipants` with full `sessionRoleBriefingSelect` loaded regardless of viewer type.

---

## 6. Hidden/private case data exposure audit

### Field classification

**Public:** title, businessContext, publicInstructions, targetSkills, language, difficulty, durations, public role names (via `toPublicCaseSummary`).

**Hidden/private:** `CaseRole.privateInstructions`, `objectives`, `constraints`, `hiddenInfo`, `fallbackPosition`; same fields on `SessionRole` snapshots; facilitator notes; full `analysisJson`; `roleObjectivesAnalysis` in AI output.

### Exposure by surface

| Surface | Full case? | Private roles to client? | Participant | Observer | Notes |
|---------|------------|--------------------------|-------------|----------|-------|
| `/cases` list | No | No | N/A (demo only) | N/A | Public list fields |
| `/cases/[id]` | **Yes** | **All roles** | Anyone hitting route | Same | Demo facilitator filter only |
| Event lobby `availableCases` | No | No | Host only | No | `toPublicCaseSummary` |
| Event lobby `selectedCase` | No | No | Host | No | Public summary |
| `/join/[joinToken]` SSR | Snapshots | **All assigned roles in props** | Own role in UI | Hidden in UI, **in HTML** | Critical |
| `/api/livekit/sidebar` | Snapshots | Facilitator only in `facilitatorBriefings` | Own `caseRole` | No briefings | Good |
| `/sessions/[id]` | Snapshots | **All session roles** | Demo facilitator | Same | Facilitator admin view |
| AI `buildSessionAnalysisContext` | — | **All roles** (server-only for OpenAI) | N/A | N/A | OK server-side |
| AI shared via `share` route | — | `roleObjectivesAnalysis` stripped | Shared JSON | Shared JSON | Partial sanitization |
| Case library modal | No | No | Host | No | `PublicCaseSummary` |

### Required finding

**Normal logged-in users must not see hidden case data simply because they can access the site.** Today, **any** visitor can open `/cases/[id]` (demo facilitator scope) and **any** `joinToken` holder receives private role payloads in SSR for `/join/[joinToken]`.

### Recommended serializers (not yet implemented)

```typescript
toPublicCaseView(case)           // library, lobby case list
toEventLobbyCaseView(case)       // selected case in lobby (host)
toParticipantSessionView(session, currentSessionParticipant)  // own role only
toObserverSessionView(session)   // public snapshots only
toFacilitatorSessionView(session)  // all roles + notes
toAdminCaseView(case)            // full authoring data, admin only
```

---

## 7. Session Materials, transcript and AI-analysis access

| Capability | Facilitator | Participant | Observer |
|------------|-------------|-------------|----------|
| View recording | Yes (+ signed URL) | Yes | Yes |
| View full transcript | Yes | **Yes** | **Yes** |
| Edit transcript | Yes (POST) | No | No |
| Start/retry transcription | Yes | No | No |
| View speaker mapping UI data | Yes (GET); edit POST | GET (read mapping metadata) | Same |
| Edit speaker mapping | Yes | No | No |
| Run AI analysis | Yes | No | No |
| View full facilitator AI | Yes | No (until shared) | No |
| View shared AI | Yes | Yes (sanitized + own feedback slice) | Yes |
| Share/unshare AI | Yes | No | No |

**Risks:**

- Observer sees full transcript (may be acceptable product-wise; document decision).
- Join page SSR leaks private role briefings to non-facilitators.
- Shared AI: `sanitizeAnalysisForParticipants` removes `roleObjectivesAnalysis` but other fields may still reference private objectives — needs review.
- `participantPersonalFeedback` filtered by `displayName` — collision risk.

**Files:** `app/api/sessions/[sessionId]/materials/status/route.ts`, `app/join/[joinToken]/page.tsx`, `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`

---

## 8. Rejoin and recovery audit

### localStorage

- Key: `negotaitions.recovery.v1`
- Stores tokens in plaintext (XSS = full account compromise for guest flows).

### Stale data

- Client TTL via `isRecoveryContextExpired`; server re-validates on `/api/rejoin/validate`.

### Server validation

- **Yes** — `lib/rejoin/validate.ts` calls `resolveEventAccess` / `getSessionParticipantByJoinToken`.

### After session finished

- Rejoin routes to materials (`/join/[joinToken]`).

### After event completed

- Lobby rejoin rejected (`eventCompleted`); session materials may still work via `joinToken`.

### Multi-session events

- EVENT_LOBBY rejoin prefers active assignment → room; else latest session → materials; else lobby.
- No UI to pick among multiple active sessions if several exist.

### Recommended server-side rejoin (post-auth)

1. Active session room for user
2. Active event lobby
3. Latest finished session materials
4. Personal dashboard
5. Chooser when multiple actives

---

## 9. Admin and diagnostics audit

| Question | Answer |
|----------|--------|
| Who can access `/admin` today? | **Anyone** |
| Server-side protection? | **No** — `getDemoFacilitator()` only checks DB seed |
| Secrets shown? | Config **presence** (not values), FFmpeg path, usage counters |
| ExternalServiceEvents visible? | **Yes** — last 50 in `/api/admin/health` |
| Normal users can open diagnostics? | **Yes** |

### Future admin model

- `User.globalRole`: `USER` | `ADMIN`
- `ADMIN_EMAILS` env → promote on register/first login
- `isAdmin(user)` guard on `/admin`, `/api/admin/*`
- `/admin/users` for approval
- Never expose `passwordHash`, `sessionTokenHash`, raw env secrets

---

## 10. Required future auth model (document only)

```prisma
// Proposed — NOT in schema today

model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String?
  passwordHash    String
  globalRole      GlobalRole @default(USER)  // USER | ADMIN
  status          UserStatus @default(PENDING) // PENDING | APPROVED | REJECTED | BLOCKED
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  lastLoginAt     DateTime?
  approvedAt      DateTime?
  approvedByUserId String?
}

model UserSession {
  id               String   @id @default(cuid())
  userId           String
  sessionTokenHash String   @unique
  expiresAt        DateTime
  createdAt        DateTime @default(now())
  lastSeenAt       DateTime?
  userAgent        String?
  ipHash           String?
}

// Extend existing:
// TrainingEvent.hostUserId String?
// EventParticipant.userId String?
// SessionParticipant.userId — already nullable

// Optional:
model AdminActionLog { ... }
```

**Note:** Existing `User.role` (`FACILITATOR`/`PARTICIPANT`/`OBSERVER`) conflicts with session participant types — consider renaming to `accountType` or removing in favor of `globalRole` + session-scoped types.

---

## 11. Required future access rules

### Event access

Allowed if: `isAdmin(user)` OR `user.id = event.hostUserId` OR `EventParticipant.userId = user.id` OR valid `hostToken`/`participantToken` (guest).

### Session access

Allowed if: admin OR `SessionParticipant.userId` OR valid `joinToken` OR host/facilitator per event rules.

### Session materials

- Participant: own role briefing + shared/public materials
- Observer: observer-safe view only
- Facilitator/host: facilitator view
- Admin: support view (not default full private case dump)

### Dashboard

- User sees only own Events/Sessions
- Admin ops on `/admin`, not mixed into user dashboard

### Pending users

- Block dashboard, events, sessions, cases, materials, hidden case data
- Show `/pending-approval`

---

## 12. Duplicate participant risks

| Location | Issue |
|----------|-------|
| `joinTrainingEvent` | New participant if no `participantToken` |
| `joinTrainingEvent` | Same person, new browser → duplicate |
| `createSessionFromEvent` | Blocks duplicate **active** session assignment per event participant |
| displayName-only identity | AI feedback, roster, notes |

### Recommendations

- Unique `(eventId, userId)` on `EventParticipant` when logged in
- Copy `userId` to `SessionParticipant` on assignment
- Guest: optional email hash or "continue as …" with stored token
- Merge tool for legacy duplicates during migration

---

## 13. Migration plan

### Phase A — Auth primitives

- `User` / `UserSession`, bcrypt, httpOnly cookie
- Register/login/logout
- `ADMIN_EMAILS` → `globalRole`

### Phase B — Admin approval

- `User.status`, `/pending-approval`, `/admin/users`
- Approve/reject/block/unblock

### Phase C — User binding

- `hostUserId`, `EventParticipant.userId`, `SessionParticipant.userId`
- Join flows bind logged-in user

### Phase D — Dashboard & rejoin

- Filtered dashboard/events/sessions
- Server rejoin by `UserSession` with token fallback

### Phase E — Privacy hardening

- Serializers (§6)
- Fix join page SSR leak
- AI shared report audit
- Remove tokens from list pages

---

## 14. Risk list

### Critical

1. **No authentication** — `(app)/*` routes public — all facilitator pages  
   *Mitigation:* Phase A middleware + session cookie
2. **hostToken in dashboard/events SSR** — `lib/event-overview-stats.ts`, `dashboard/page.tsx`  
   *Mitigation:* Never send tokens to list views; use server actions with auth
3. **Private role data in join SSR** — `app/join/[joinToken]/page.tsx`  
   *Mitigation:* `toParticipantSessionView` / `toObserverSessionView`
4. **cancelTrainingEvent without auth** — `app/actions/events.ts`  
   *Mitigation:* Require hostToken or hostUserId
5. **Admin APIs public** — `/api/admin/health`  
   *Mitigation:* `isAdmin` guard

### High

6. Facilitator notes API without joinToken — `GET /api/sessions/[id]/notes`
7. ~~Events/sessions overview APIs public~~ **Fixed (Phase 1.1+)** — both APIs guarded with `apiRequireActiveUser`, user-scoped, no tokens in response
8. Token = bearer secret for all session data
9. All events visible on `/events`

### Medium

10. Duplicate EventParticipant on re-join
11. displayName collision in AI filtering
12. Observer full transcript access (product decision)
13. localStorage plaintext tokens

### Low

14. `publicJoinCode` enumerable (8-char alphabet)
15. Demo password in seed (`demo1234`) — dev only

---

## 15. Open questions

1. Should guest token access remain after deploy?
2. Can pending registered users join as guests?
3. Should admins see all private case data by default?
4. Can event host see all private role briefings? (Currently yes via facilitator session view.)
5. Facilitator rights: event-level vs session-level?
6. Is user approval required for every registration?
7. How to link old token-only sessions after account creation?
8. Should observers see full transcript/recording?
9. Retire `User.role` (FACILITATOR/PARTICIPANT/OBSERVER) vs repurpose?
10. Keep `demo@example.com` for dev only behind env flag?

---

## 16. Implementation checklist

### Files to change

- `prisma/schema.prisma` — UserSession, hostUserId, userId fields, globalRole, status
- New `middleware.ts` — session cookie, pending-user redirect
- New `lib/auth/*` — `getCurrentUser`, `isAdmin`, `requireAuth`
- `lib/event-auth.ts`, `lib/session-participant-auth.ts` — user + token dual auth
- `lib/event-overview-stats.ts`, `dashboard/page.tsx`, `events/page.tsx` — remove token exposure
- `app/join/[joinToken]/page.tsx` — safe serializers
- `app/actions/events.ts` — auth on create/cancel/complete
- All `/api/admin/*`, `(app)/*` pages — real guards
- `lib/participant-notes-access.ts` — require auth or joinToken always

### Helpers to add

- `toPublicCaseView`, `toParticipantSessionView`, etc.
- `canAccessEvent(user, event, tokens)`
- `canAccessSession(user, session, tokens)`
- `bindGuestTokensToUser(user)`

### Pages to add

- `/login`, `/register`, `/logout`
- `/pending-approval`
- `/admin/users`

### APIs to protect

- All `(app)` facilitator proxies: notes, presence, display-status, overview
- Admin routes
- Server actions

### Tests to write

- Auth middleware redirects
- Pending user blocked
- Join page does not leak private roles in HTML
- Event list does not include hostToken
- cancel/complete require host auth
- Admin 403 for non-admin
- User dashboard scoping

### Migrations needed

- UserSession table
- User.status, globalRole, approval fields
- hostUserId, EventParticipant.userId (unique index)
- Backfill strategy for existing events

---

## Validation (read-only)

- `npx prisma validate` — passed
- `npm run lint` — passed

---

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | AUTH_ACCESS_AUDIT.md created | Done |
| 2 | No code changes | Done |
| 3 | No migrations | Done |
| 4 | Token paths identified | Done |
| 5 | localStorage recovery identified | Done |
| 6 | Hidden case data risks identified | Done |
| 7 | Migration plan proposed | Done |
| 8 | Route/API matrix included | Done |
| 9 | Privacy recommendations included | Done |
| 10 | Implementation checklist included | Done |
