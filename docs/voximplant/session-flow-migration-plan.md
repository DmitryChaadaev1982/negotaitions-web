# Session Flow Migration Plan (Stage 5.5B)

## Goal

Restore user-facing feature parity (session/event/lobby UX) on Voximplant while preserving the working recording pipeline:

`Vox room/recording -> recording webhook -> Recording.fileKey -> SpeechKit transcription -> Yandex AI/DeepSeek analysis -> materials/status`.

## Hard constraints for this plan

- Do not change Prisma schema/migrations.
- Do not change Yandex SpeechKit / Yandex AI / DeepSeek processing flow.
- Do not change working Vox recording webhook/dispath flow semantics.
- Do not remove recording debug panel.
- Do not modify production/server config.
- Do not rename Vox scenario/rule in this stage.

## Provider migration boundary

### Domain logic (must stay provider-agnostic)

- Session lifecycle/state machine: `lib/negotiation-control.ts`, `app/api/sessions/[sessionId]/control/route.ts`, `app/api/sessions/[sessionId]/control-state/route.ts`.
- Role and participant authority: `app/api/livekit/sidebar/route.ts`, `lib/room-sidebar.ts`, `lib/room-participant-resolver.ts`.
- Event/lobby/session assignment: `lib/event-state.ts`, `lib/create-event-session.ts`, `app/api/events/[id]/state/route.ts`, `app/api/events/[id]/host/route.ts`.
- Materials post-processing and permissions: `app/api/sessions/[sessionId]/materials/status/route.ts`.

### Voximplant-specific logic

- Session room media transport + SDK join: `lib/voximplant/use-voximplant-room.ts`.
- Vox room access and identity handshake: `app/api/sessions/[sessionId]/voximplant/access/route.ts`.
- Vox recording message dispatch and webhook ingestion: `app/api/sessions/[sessionId]/recording-control/route.ts`, `lib/voximplant/recording-dispatch.ts`, `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`.
- Vox room view adapter: `components/voximplant-negotiation-room-page.tsx`, `components/voximplant-video-layout.tsx`.

## Files that must not be changed (this migration scope)

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts` (except additive logs/tests if strictly needed)
- `lib/voximplant/recording-dispatch.ts` (no behavior change in message contract)
- `lib/services/*speech*` and `lib/ai/*` pipeline internals
- `docs/voximplant/neg-conf.main-room.scenario.js` (no rename or semantic scenario rewrite in this phase)
- Production runtime config files

## Recommended implementation stages

## Stage 1 - P0: Visual parity in session room (no pipeline changes)

**Outcome**
- Timer parity in Vox room.
- Role-aware layout parity (participants/facilitator/observers).
- Remote role labels resolved from server authority, not transport guesses.

**Likely files to change**
- `components/shared-room-shell.tsx` (shared timer placement primitive, if needed)
- `components/voximplant-video-layout.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts` (only if additional participant identity mapping hooks are required)
- `lib/room-provider/types.ts` (only additive type changes)

**Guardrails**
- No changes to `app/api/sessions/[sessionId]/recording-control/route.ts` behavior.
- No changes to webhook route semantics.

## Stage 2 - P0: Event lobby provider parity

**Outcome**
- Event lobby can operate with Vox provider path, not only LiveKit.
- Consistent event -> lobby -> room provider experience.

**Likely files to change**
- `components/event-lobby-view.tsx` (provider switch integration)
- `components/event-lobby-video-room.tsx` (may become LiveKit-specific adapter)
- `app/api/events/[id]/livekit-token/route.ts` (keep for LiveKit path)
- `app/api/events/[id]/voximplant-access/route.ts` (new)
- `app/events/[id]/lobby/page.tsx`
- `lib/env.ts` (read-only use of provider flag already present; additive helper usage only)

**Guardrails**
- Keep `lib/event-state.ts` payload contract stable.
- Do not touch session creation/event assignment DB logic.

## Stage 3 - P1: Control/recording robustness and UX hardening

**Outcome**
- Better resilience around facilitator START/FINISH relay race conditions and reconnects.
- Clear user feedback when relay succeeds server-side but conference delivery fails.

**Likely files to change**
- `components/facilitator-room-controls.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `components/recording-debug-panel.tsx` (additive diagnostics only)
- `app/api/sessions/[sessionId]/control/route.ts` (only additive metadata/log hints, no state machine rewrite)

**Guardrails**
- Preserve current start/stop dispatch contracts.
- Preserve current recording row lifecycle owned by webhook outcomes.

## Stage 4 - P1/P2: Test parity and long-term maintainability

**Outcome**
- Clear split between provider-agnostic and provider-specific e2e.
- Full regression coverage for event -> lobby -> room -> recording -> materials.

**Likely files to change**
- `tests/e2e/session-lifecycle.spec.ts`
- `tests/e2e/event-flow.spec.ts`
- `tests/e2e/session-materials-processing.spec.ts`
- `tests/e2e/voximplant-recording-debug.spec.ts`
- `tests/e2e/*new*` (new provider-specific parity tests)
- `tests/e2e/helpers/*` (provider fixtures)

**Guardrails**
- Keep existing domain regression tests; refactor, do not delete useful assertions.

## E2E tests to restore/port

### Reuse as provider-agnostic (keep and stabilize)

- `tests/e2e/event-flow.spec.ts`
- `tests/e2e/session-materials-processing.spec.ts`
- Core parts of `tests/e2e/session-lifecycle.spec.ts` that validate domain transitions and materials permissions.

### Port or split into provider-aware variants

- LiveKit endpoint-specific assertions in `tests/e2e/session-lifecycle.spec.ts` (`/api/livekit/*` token/sidebar checks).
- Event lobby media token checks currently tied to `/api/events/[id]/livekit-token`.

### Add Voximplant-specific coverage (missing)

- Vox room layout parity (2/3/4+ participants, facilitator/observer visibility).
- Vox timer visibility and refresh/reconnect continuity.
- Event lobby -> assigned session -> Vox room join -> facilitator start/finish -> webhook completion -> materials availability.

## Manual smoke test checklist

- Set `VIDEO_PROVIDER=voximplant`.
- Open event join page, verify login redirect/returnUrl works.
- Enter lobby, verify participant presence and assignment updates.
- Create session from event draft and open assigned room.
- Verify visible timer, role labels, facilitator/observer layout zones.
- Facilitator: start preparation, start negotiation, pause/resume, finish.
- Confirm recording relay starts/stops and debug panel still works.
- Wait for webhook completion and verify `materials/status` progresses to transcript and AI readiness.
- Refresh/rejoin during running and post-finish states; verify role and timer continuity.
- Repeat with observer and participant accounts for permission checks.

## Rollback strategy

- Keep changes in small PR-sized stages.
- For each stage, guard new provider behavior behind existing `VIDEO_PROVIDER` branch checks.
- If regression appears, rollback only adapter/UI stage branch while preserving stable domain APIs.
- Do not rollback by editing database schema or migration history.
- Keep a known-good tag/commit for "recording pipeline green" and compare only room/lobby adapter diffs.

## Risk register

### Risks to working recording pipeline

- START/FINISH UI callback timing could accidentally suppress or duplicate relay messages.
- Reconnect flows may lose client relay context before webhook confirms state.
- Over-eager refactors in `recording-control` could break scenario message format.

**Mitigation**
- Avoid contract changes in recording dispatch/webhook code.
- Add focused tests around relay idempotency and post-finish status transitions.

### Risks to future Yandex server deployment

- Provider-specific logic leaking into domain layers increases migration complexity.
- Mixed lobby provider behavior can create environment-dependent failures.

**Mitigation**
- Enforce provider boundary modules and avoid direct provider checks in domain services.
- Keep transport adapters isolated behind explicit entry routes/components.

### Risks to future commercial product development

- UX inconsistency in roles/timers undermines facilitator trust and training quality.
- Weak regression coverage can cause repeated breakage during feature additions.

**Mitigation**
- Prioritize P0 visual/domain parity first.
- Establish test taxonomy: domain contracts vs provider adapters.

## Recommended next implementation stage

Start with **Stage 1 (P0 visual parity in session room)** because it closes the most visible demo blockers (timer + role-aware layout) without touching the working recording pipeline or database layer.

