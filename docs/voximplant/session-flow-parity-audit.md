# Session Flow Parity Audit (Stage 5.5B)

## Scope and method

- Baseline: `exp/yandex-ai-local` at commit `31c4fe3` (queried via `git diff/git show`).
- Current: `exp/yandex-voximplant-main-room` working tree.
- Focus: domain/session/event/lobby parity, not media transport internals.
- Non-goals in this stage: no runtime fixes, no Prisma/schema changes, no recording pipeline changes.

## Priority definitions

- **P0**: required before internal demo in negotiation club.
- **P1**: required before broader testing.
- **P2**: polish/commercial readiness.

## Parity matrix

| feature | domain area | old behavior | current behavior | old source files | current source files | gap | proposed fix | risk | priority |
|---|---|---|---|---|---|---|---|---|---|
| case -> session creation | core domain behavior | Event host creates session from selected case with role snapshot, facilitator/participant/observer assignment, durations, and event linkage. | Same domain flow and contracts; still creates `Session`, `SessionRole`, `SessionParticipant`, assignment links. | `lib/create-event-session.ts`, `app/api/events/[id]/host/route.ts` | `lib/create-event-session.ts`, `app/api/events/[id]/host/route.ts` | No functional gap observed. | Keep as provider-agnostic domain layer; do not mix with Vox transport logic. | Low | P2 |
| event -> session flow | core domain behavior | Lobby host edits assignment draft, then creates session; participants receive assignment cards and room/material links. | Same state build and assignment semantics; links now account-first with fallback token mode. | `lib/event-state.ts`, `components/event-lobby-view.tsx` | `lib/event-state.ts`, `components/event-lobby-view.tsx` | Minor UX mismatch risk from mixed account/token assumptions in some tests. | Normalize all lobby/session checks to account-mode-first expectations; keep token only as legacy fallback. | Medium | P1 |
| event join flow | event/lobby flow | `/events/[id]/join` allowed join into event flow with invite/visibility checks. | Same route and visibility checks, but guest join explicitly closed and login redirect enforced. | `app/events/[id]/join/page.tsx` | `app/events/[id]/join/page.tsx` | Expected product policy change; parity depends on whether demo expects guest join. | Confirm product decision; if guest join must stay closed, update specs/tests to reflect it. | Medium | P1 |
| lobby route and bootstrapping | event/lobby flow | `/events/[id]/lobby` loads event state and lobby media, participant heartbeat, assignment cards. | Same route and state polling, but lobby media remains LiveKit-only token issuance. | `app/events/[id]/lobby/page.tsx`, `components/event-lobby-view.tsx`, `app/api/events/[id]/livekit-token/route.ts` | `app/events/[id]/lobby/page.tsx`, `components/event-lobby-view.tsx`, `app/api/events/[id]/livekit-token/route.ts` | Provider split: lobby on LiveKit while session room may be Voximplant. | Add provider adapter for lobby media token/context (`VIDEO_PROVIDER` switch) while preserving `event-state` API contracts. | High (migration inconsistency) | P0 |
| session start/finish lifecycle | core domain behavior | Facilitator actions drive negotiation state machine; START/FINISH tied to recording behavior. | State machine is preserved; control route branches recording side effects by provider. | `app/api/sessions/[sessionId]/control/route.ts`, `lib/negotiation-control.ts` | `app/api/sessions/[sessionId]/control/route.ts`, `lib/negotiation-control.ts` | No domain transition gap, but provider-specific recording trigger path diverged. | Keep transition authority in `control` route; confine recording provider specifics to adapter endpoints/hooks. | Medium | P1 |
| session status transitions | core domain behavior | `PREPARATION* -> READY_TO_START -> RUNNING/PAUSED -> FINISHED`; auto transitions from timers. | Same transitions and guards, same timer fields and pause accounting. | `lib/negotiation-control.ts`, `app/api/sessions/[sessionId]/control-state/route.ts` | `lib/negotiation-control.ts`, `app/api/sessions/[sessionId]/control-state/route.ts` | No parity gap detected. | Keep untouched; regression test transitions after any UI/provider changes. | Low | P2 |
| materials/status polling | core domain behavior | Materials endpoint exposes processing stages and role-based visibility for recording/transcript/AI. | Same endpoint and semantics; includes Yandex/AI pipeline stages and visibility gating. | `app/api/sessions/[sessionId]/materials/status/route.ts` | `app/api/sessions/[sessionId]/materials/status/route.ts` | No parity gap in API contract. | Do not modify in UX parity phase; only consume better in room/lobby flows. | Low | P2 |
| participant role source | role model | Sidebar/session APIs derive participant type and role from DB (`SessionParticipant`, `SessionRole`). | Same source for business UI via sidebar; Vox transport role used only as fallback. | `app/api/livekit/sidebar/route.ts`, `lib/room-sidebar.ts` | `app/api/livekit/sidebar/route.ts`, `components/voximplant-negotiation-room-page.tsx` | Remote role labeling in Vox tiles not mapped from DB roster. | Build provider-agnostic participant directory map (`participantId -> displayName/role`) and feed Vox layout. | High (role confusion) | P0 |
| role persistence and refresh/rejoin | role model | After refresh/rejoin, role/type resolved from server state; user-to-participant ownership enforced. | Same account-mode enforcement and participant resolver behavior. | `app/room/[sessionId]/page.tsx`, `lib/room-participant-resolver.ts` | `app/room/[sessionId]/page.tsx`, `lib/room-participant-resolver.ts` | No hard parity gap observed. | Keep resolver as source of truth; avoid client-side guessed roles. | Low | P2 |
| role-specific permissions | role model | Facilitator-only controls, participant/observer restrictions enforced in APIs and UI. | Still enforced (`control`, `recording-control`, materials permissions). | `app/api/sessions/[sessionId]/control/route.ts`, `app/api/sessions/[sessionId]/recording-control/route.ts` | same | No policy gap, but Vox UI presentation lags role richness. | Reuse shared shell controls and badges; ensure Vox media area mirrors role clarity. | Medium | P1 |
| timer source of truth | timer | Server-backed fields (`timerStartedAt`, pauses, durations) and `control-state` polling drive countdown. | Same server-backed timer source and polling cadence (1s). | `lib/negotiation-control.ts`, `app/api/sessions/[sessionId]/control-state/route.ts` | same | No backend timer gap. | Keep timer logic untouched. | Low | P2 |
| timer visibility in room | timer | LiveKit room layout has central timer and negotiation/preparation state messaging. | Vox layout has no timer block; only tile grid and local labels. | `components/structured-video-layout.tsx` | `components/voximplant-video-layout.tsx`, `components/shared-room-shell.tsx` | Missing timer parity in Vox room UI. | Introduce provider-agnostic timer panel in shared shell or shared layout primitive used by both providers. | High (demo-visible) | P0 |
| timer behavior on refresh/reconnect | timer | Refresh/reconnect resumes from server timestamps, not local clocks. | Same for business state; Vox UI still receives server control-state. | `components/video-room-page.tsx` | `components/voximplant-negotiation-room-page.tsx` | Functional parity mostly intact; visual parity still lacking due no visible timer. | Once timer block is shared, parity should be complete without backend changes. | Medium | P1 |
| facilitator controls visibility | facilitator controls | Controls shown only when `canControl` and not closed/debrief. | Same via shared shell in both providers. | `components/video-room-page.tsx` (baseline inline logic) | `components/shared-room-shell.tsx` | No major gap. | Keep controls centralized in shared shell. | Low | P2 |
| start/finish recording linkage | facilitator controls | LiveKit start/finish linked to egress start/stop in server control flow. | Vox uses server dispatch + client conference message relay + webhook completion; linked to negotiation lifecycle. | `app/api/sessions/[sessionId]/control/route.ts`, `app/api/sessions/[sessionId]/recording-control/route.ts` | same + `components/voximplant-negotiation-room-page.tsx` | Domain parity exists, but split responsibility is more fragile in UI/network failures. | Add deterministic idempotency/telemetry checks around relay success states without changing pipeline behavior. | Medium | P1 |
| participant windows/layout (2/3/4+) | room/video layout | Structured table layout: observers row, negotiator columns, facilitator center + timer; scales by participant counts. | Vox: generic 1-2 column grid, no role lanes, no observer/facilitator zones, weak 4+ behavior semantics. | `components/structured-video-layout.tsx` | `components/voximplant-video-layout.tsx` | Major layout parity gap. | Implement role-aware Vox layout matching domain zones (observers/facilitator/participants), preserving Vox stream plumbing. | High (demo-critical UX) | P0 |
| observer/facilitator visual model | room/video layout | Clear visual separation and labels by participant type and role. | Local role label only; remote role labels missing (`TODO`), observer/facilitator zones absent. | `components/structured-video-layout.tsx` | `components/voximplant-video-layout.tsx` | Role display and cognitive model mismatch. | Add server-backed remote role label mapping and role-specific tile framing. | High | P0 |
| recording/review implications in layout | room/video layout | Layout communicates negotiation context clearly for later review. | Vox current grid can obscure who is facilitator/observer in recorded meetings. | `components/structured-video-layout.tsx` | `components/voximplant-video-layout.tsx` | Potential confusion in training review and QA. | Align visual roles and naming in-grid; keep recording transport unchanged. | Medium | P1 |
| authenticated join and returnUrl | event/lobby flow | Join/lobby routes redirect to login with returnUrl when unauthenticated in hardened flows. | Same behavior in current room/event routes; account-first path emphasized. | `app/events/[id]/join/page.tsx`, `app/events/[id]/lobby/page.tsx`, `app/room/[sessionId]/page.tsx` | same | No parity gap. | Keep as is; ensure tests assert account-mode returnUrl paths. | Low | P2 |
| invite/access checks | event/lobby flow | Access validated through visibility/invite/token ownership checks. | Same resolve/access pattern and participant auto-provision for authenticated users. | `lib/event-auth.ts`, `app/api/events/[id]/state/route.ts` | same | No domain gap detected. | Preserve; avoid provider-specific access forks. | Low | P2 |
| lobby -> room transition | event/lobby flow | Assigned participant receives room/material links from event state and enters session room. | Same link generation semantics; but lobby media context still LiveKit while room may be Vox. | `lib/event-state.ts`, `components/event-lobby-view.tsx` | same | Mixed-provider transition is incomplete architecture parity. | Add provider boundary abstraction for lobby media session creation and token/context fetch. | High | P0 |
| Vox room context creation for event flow | event/lobby flow | Baseline had only LiveKit context creation. | Current has Vox room access endpoint for session rooms but no event-lobby Vox context endpoint. | `app/api/events/[id]/livekit-token/route.ts` | `app/api/sessions/[sessionId]/voximplant/access/route.ts` (session-only), `app/api/events/[id]/livekit-token/route.ts` | Missing Vox event-lobby context path. | Introduce `/api/events/[id]/voximplant-access` adapter + lobby view switch by provider. | High | P0 |
| reusable old tests | e2e coverage | Event/session/materials lifecycle tests validated domain logic independent of provider internals. | Same tests present; many still assert LiveKit endpoints or legacy joinToken patterns. | `tests/e2e/event-flow.spec.ts`, `tests/e2e/session-materials-processing.spec.ts` | same | Reuse possible, but not all assertions are provider-agnostic. | Keep domain assertions; parameterize provider-specific endpoint expectations. | Medium | P1 |
| tests to port to Vox-specific | e2e coverage | Baseline lacked Vox-specific tests. | Current includes `voximplant-recording-debug.spec.ts` but limited to debug/recording diagnostics. | n/a | `tests/e2e/voximplant-recording-debug.spec.ts` | Missing broad Vox room parity tests (roles/timer/layout/event-lobby->room). | Add Vox-focused e2e specs for room UX parity and event-lobby transition. | High | P0 |
| provider-agnostic vs provider-specific test split | e2e coverage | Implicitly LiveKit-centric in places. | Still mixed; domain and provider checks interleaved. | `tests/e2e/session-lifecycle.spec.ts`, `tests/e2e/phase-6-4-1-session-guest-closed.spec.ts` | same | Regression blind spots due coupling. | Split tests into domain contracts (always-on) and provider adapters (`livekit`/`voximplant`) via fixtures/env matrix. | Medium | P1 |
| missing end-to-end regression path | e2e coverage | No explicit single test for event -> lobby -> room -> recording -> materials on Vox path. | Still missing comprehensive chain on Vox provider. | n/a | n/a | High-value regression gap for migration confidence. | Add one critical smoke e2e for full Vox chain before demo. | High | P0 |

## Gap summary

### P0 (demo-blocking)

- Vox room layout parity: role-aware zones and participant arrangement.
- Visible timer parity in Vox room.
- Remote role display mapping for Vox participants.
- Event lobby/provider migration gap (LiveKit lobby + Vox room split).
- Missing full-chain Vox e2e regression (event -> lobby -> room -> recording -> materials).

### P1 (broader testing readiness)

- Harden mixed account/token assumptions in tests and UI checks.
- Strengthen recording relay observability/idempotency around START/FINISH callbacks.
- Split provider-agnostic vs provider-specific tests for stable CI signals.

### P2 (polish/readiness)

- Keep stable domain APIs unchanged and document provider boundaries in code comments/docs.
- Additional UI consistency refinements once P0/P1 are complete.

## Files inspected (audit evidence)

- `docs/voximplant/domain-and-session-architecture-map.md`
- `app/room/[sessionId]/page.tsx`
- `components/video-room-page.tsx`
- `components/shared-room-shell.tsx`
- `components/structured-video-layout.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `components/voximplant-video-layout.tsx`
- `components/facilitator-room-controls.tsx`
- `lib/negotiation-control.ts`
- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/control-state/route.ts`
- `app/api/sessions/[sessionId]/recording-control/route.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `app/events/[id]/join/page.tsx`
- `app/events/[id]/lobby/page.tsx`
- `components/event-lobby-view.tsx`
- `components/event-lobby-video-room.tsx`
- `app/api/events/[id]/state/route.ts`
- `app/api/events/[id]/host/route.ts`
- `app/api/events/[id]/livekit-token/route.ts`
- `lib/event-state.ts`
- `lib/create-event-session.ts`
- `tests/e2e/event-flow.spec.ts`
- `tests/e2e/session-lifecycle.spec.ts`
- `tests/e2e/session-materials-processing.spec.ts`
- `tests/e2e/voximplant-recording-debug.spec.ts`

