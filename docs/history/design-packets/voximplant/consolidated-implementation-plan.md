# Voximplant Consolidated Implementation Plan

## Stage 0 — Baseline Stabilization and Checkpoint

### Purpose

Before new development, stabilize the current recording-green state, make validation/e2e signals reliable, and add the new connection lifecycle and audio-recording policy requirements to the implementation plan.

### Executive summary

- Current status: Vox room recording green path is operational (start/stop relay, webhook, `Recording.fileKey`, transcription, AI analysis), but lobby is still LiveKit and room lifecycle/audio policy parity is incomplete.
- Main risks:
  - e2e suite is not trustworthy yet because DB harness is failing with `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`;
  - duplicate same-login connections are not controlled deterministically at active connection level;
  - negotiation pause/resume does not yet enforce "not captured in official recording" behavior.
- Recommended first action: complete Stage 0 checklist, fix DB env for Playwright, run one DB-backed smoke test, then create a checkpoint commit/tag before runtime changes.

### Scope

- Clean temporary artifacts.
- Resolve stale `.next` build cache issue.
- Confirm lint/build/prisma validation.
- Diagnose e2e DB env failure.
- Review current git status and risky diffs.
- Review current duplicate connection/rejoin/presence behavior.
- Review current Voximplant mute/audio/recording behavior.
- Produce safe checkpoint commit/tag recommendation.
- Do not implement product features in this stage.

### Current git status review

- Branch: `exp/yandex-voximplant-main-room`
- Working tree state: not clean (only untracked artifacts).
- `git diff --stat`: no tracked file modifications.
- Untracked files:
  - `playwright-report.zip`
  - `playwright-run.log`

### Modified/untracked file classification

- Recording-green checkpoint files:
  - no tracked modifications detected.
- Debug/admin tooling:
  - no tracked modifications detected.
- Scenario/docs/scripts:
  - no tracked modifications detected.
- Audit artifacts / temporary outputs:
  - `playwright-report.zip`
  - `playwright-run.log`
  - `.next/` cache directory present.
- Risky/unrelated changes:
  - no tracked risky code diffs currently; still enforce pre-checkpoint review list below.

### Files to exclude from checkpoint commit

- `audit-pack/` (if present locally).
- Raw temporary logs.
- Playwright report artifacts unless intentionally stored outside repo.
- Current local outputs to keep uncommitted:
  - `playwright-report.zip`
  - `playwright-run.log`
  - `.next/`
  - `playwright-report/`
  - `test-results/`

### Risky files that require explicit review before checkpoint

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `package.json`
- `package-lock.json`
- `lib/env.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `app/api/admin/health/route.ts`

### Validation commands (checkpoint gate)

Run in order:

1. `Remove-Item -Recurse -Force .next`
2. `npm run lint`
3. `npm run build`
4. `npx prisma validate`
5. `npx prisma generate`

### E2E current state

- Latest reported run:
  - 522 discovered
  - 43 failed
  - 90 skipped
  - 374 did not run
  - 15 passed
- Current signal quality: unreliable for product regression because failures are dominated by DB auth/harness error (`client password must be a string`) from `tests/e2e/helpers/db.ts`.

### E2E harness diagnosis and fix plan

#### Current implementation facts

- DB helper uses only `process.env.DATABASE_URL`:
  - `tests/e2e/helpers/db.ts` creates `new Pool({ connectionString: process.env.DATABASE_URL })`.
- No `TEST_DATABASE_URL` or `E2E_DATABASE_URL` is used by current helper.
- `playwright.config.ts` does not inject `DATABASE_URL` into `webServer.env`.

#### Likely failure reason

- e2e runtime reaches PostgreSQL with invalid/missing password material in connection config.
- In this repo, this is most likely env-loading mismatch or malformed URL value available to Playwright worker/runtime.

#### Required test DB env variable

- Required variable: `DATABASE_URL`
- Expected format:
  - `DATABASE_URL="postgresql://<db_user>:<url_encoded_password>@127.0.0.1:5432/<db_name>?schema=public"`

#### Manual checklist to fix `client password must be a string`

1. Ensure local Postgres is running.
2. Ensure `DATABASE_URL` is set for the process that launches Playwright.
3. Ensure the password portion exists and is URL-encoded if it contains special chars (`@`, `:`, `/`, `?`, `#`, `%`).
4. Ensure no accidental nested quoting in env value.
5. If relying on `.env.local`, ensure Playwright process actually receives `DATABASE_URL` (do not assume Next-only env loading is enough for all worker paths).

#### Exact command to verify DB connectivity before Playwright

Use the same shell/session that will run Playwright:

`node -e "const { Client } = require('pg'); const url = process.env.DATABASE_URL; if (!url) { console.error('DATABASE_URL missing'); process.exit(1); } const c = new Client({ connectionString: url }); c.connect().then(() => c.query('select current_database() as db, current_user as usr')).then(r => { console.log(r.rows[0]); return c.end(); }).catch(e => { console.error(e.message); process.exit(1); });"`

Then run a minimal DB-backed smoke test:

`npx playwright test tests/e2e/event-flow.spec.ts -g "event lobby"`

### Connection lifecycle assessment (current)

#### Current join behavior

- Session room identity is account-first and deterministic at DB row level:
  - `ensureAccountRoomParticipant(sessionId, user)` resolves/creates one `SessionParticipant` per `(sessionId, userId)`.
- Event lobby identity is similarly resolved/created per `(eventId, userId)` via `ensureUserEventParticipant`.

#### Current leave behavior

- Event lobby has explicit leave API (`/api/events/[id]/presence/leave`) for token mode.
- Session room has heartbeat updates (`/api/sessions/[sessionId]/heartbeat`) but no explicit leave endpoint.
- Browser close/network drop are inferred by `lastSeenAt` timeout, not by guaranteed immediate disconnect event handling.

#### Current rejoin behavior

- Rejoin under same login preserves server-side participant identity and role source of truth (sidebar/control APIs).
- Timer state is server-backed via control state.
- UI tile position/layout continuity is not explicitly persisted.

#### Current duplicate-tab / same-login behavior

- Duplicate tabs under same login reuse same participant record and can open concurrent media connections.
- No deterministic "replace old connection / reject new / mark stale then accept" policy is currently enforced at active connection level.
- Presence heartbeats from multiple tabs can overwrite the same `lastSeenAt`, masking duplicate active connections.

#### Current stale connection cleanup

- Time-based only (`lastSeenAt` thresholds), no explicit per-connection lease/id, no server-enforced stale-connection takeover protocol.

#### Risks by actor

- Facilitator:
  - duplicate tabs can cause conflicting control interactions and ambiguous operator state.
- Participants:
  - accidental duplicate audio send paths and inconsistent mute expectations.
- Observers:
  - duplicate observer sessions can distort presence and role clarity.

#### Recommended target policy (Stage 1 implementation target)

- Policy: newest same-login connection replaces previous connection for the same `(sessionId, userId)` and old tab is forced into disconnected/read-only state.
- Required primitives:
  - server-issued `connectionId` + monotonic `connectionVersion`;
  - heartbeat and control APIs validate active `connectionId`;
  - takeover updates prior connection as stale and not authoritative.
- Apply same semantics in lobby and room (only UX message differs).

### Audio/recording policy assessment (current)

#### Current mute implementation

- Vox room currently supports local UI mic/camera toggles through `useVoximplantRoom`.
- This controls local track/conference mute for that client, but there is no server-enforced role policy in negotiation state transitions.

#### UI mute vs captured/sent/recorded audio

- Current logic distinguishes local UI mute state, but does not yet guarantee role-based recording exclusion.
- Remote audio is attached and rendered for all endpoints; no role-filtered recording mix control exists in current app layer.

#### Facilitator/observer recording risk

- Facilitator/observer can be recorded if their microphone stream is active/unmuted at conference level.
- Current flow does not enforce "only negotiating participants recorded during active negotiation" as a hard media policy.

#### Pause impact today

- Negotiation pause updates domain state and pause intervals.
- Pause does not yet enforce recording-level exclusion of pause conversation in Vox path.

#### Vox pause-in-recording design options (for Stage 1 decision)

1. Recorder pause/resume at Vox scenario level (preferred if reliable in deployed scenario runtime).
2. Conference-level role-aware participant mute/unmute driven by scenario messages.
3. Controlled recording mix/routing where only participant A/B audio is fed into official recorder.
4. Fallback: enforce participant mute matrix at both client and scenario boundary, with strict server policy and auditable state.

#### Risks and assumptions requiring manual Vox validation

- Whether deployed VoxEngine runtime supports deterministic recorder pause semantics needed for official recording exclusion.
- Whether mute operations affect recorder feed exactly as expected (not only local playback).
- Timing/race behavior around pause/resume/finish under reconnect conditions.

### Manual configuration checklist

- `.env.local`:
  - `VIDEO_PROVIDER=voximplant`
  - valid `DATABASE_URL`
  - Voximplant env (`VOXIMPLANT_ACCOUNT_NAME`, `VOXIMPLANT_APPLICATION_NAME`, `VOXIMPLANT_USER_DOMAIN`, `VOXIMPLANT_SCENARIO_NAME`, `VOXIMPLANT_RULE_NAME`)
  - `VOXIMPLANT_RECORDING_WEBHOOK_SECRET` set
  - `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL` set or admin override configured
  - Yandex SpeechKit/AI env set as needed.
- Test DB env:
  - ensure `DATABASE_URL` available to Playwright process.
- Local Postgres container:
  - running before e2e and smoke tests.
- Webhook override:
  - verify admin override value if tunnel/public URL changed.
- Cloudflare tunnel:
  - start when end-to-end webhook path is tested locally.

### Voximplant Console manual steps

- Current env points to:
  - scenario: `neg-conf-main-room`
  - rule: `negotaitions-negotiation-room-rule`
- Validate in Voximplant Console:
  1. Open application `negotaitions-video-poc`.
  2. Confirm rule `negotaitions-negotiation-room-rule` routes to scenario `neg-conf-main-room`.
  3. Confirm runtime logs include `[neg-conf-prod] scenario build=... source=neg-conf-main-room`.
  4. If logs show old markers (`neg-conf`, `neg-conf-rec`) or different source name, treat as mismatch and block checkpoint.
- Naming mismatch warning:
  - env names and actual Console binding must match exactly; do not assume docs/scripts names equal deployed runtime.
- If scenario update is required:
  1. Regenerate scenario artifact via existing script flow.
  2. Upload/deploy without renaming scenario/rule in this planning step.
  3. Re-verify logs and rule binding.

### Manual user steps (Stage 0 execution)

- Stop local dev server if running.
- Delete `.next`.
- Verify local Postgres container is running.
- Verify test DB connection string includes password as a string.
- Update `.env.local` or test env file as needed.
- Run validation commands.
- Run a minimal targeted Playwright test after DB env is fixed.
- Manually test same-login duplicate behavior:
  - open same session in two tabs under same login;
  - refresh one tab;
  - close one tab;
  - reconnect after short network interruption (if feasible).
- Manually check current microphone behavior:
  - participant audio;
  - facilitator audio;
  - observer audio;
  - pause/resume behavior.
- Create checkpoint commit/tag only after validation passes.

### Checkpoint recommendation

- Proposed commit name:
  - `chore(vox): checkpoint recording-green before lifecycle and audio policy migration`
- Proposed tag name:
  - `checkpoint/vox-recording-green-pre-lifecycle-audio-policy`
- Include in checkpoint:
  - validated runtime/state that keeps recording green path intact;
  - docs and non-runtime planning artifacts only.
- Exclude from checkpoint:
  - temp artifacts, e2e reports/log archives, `.next`, raw diagnostic dumps.

### Definition of done

- `npm run lint` passes.
- `npm run build` passes after `.next` cleanup.
- `npx prisma validate` and `npx prisma generate` pass.
- At least one DB-backed Playwright smoke test runs without SASL password error.
- Connection lifecycle risks are documented.
- Audio/recording policy implementation options are documented.
- Working tree is ready for checkpoint.
- Recording-green state is protected by checkpoint commit/tag.

## Stage 1 — Vox Room UX, Presence, and Audio Policy Parity

### Purpose

Make the negotiation room demo-ready on Voximplant without breaking the working recording pipeline.

### Scope

- visible timer parity in Vox room;
- role-aware layout for facilitator + 2 participants + 2 observers;
- server-backed remote role labels;
- facilitator controls parity;
- preparation/start/pause/resume/finish UX;
- refresh/rejoin continuity;
- deterministic same-login duplicate-connection handling;
- role-based microphone policy in room:
  - active negotiation: only negotiating participants audible/recorded;
  - facilitator/observers muted;
  - pause: all participants muted for recording purposes;
  - resume: negotiating participants restored, facilitator/observers still muted;
- keep recording debug panel;
- no breakage in webhook/fileKey/transcription/AI pipeline.

### Likely files to change

- `components/shared-room-shell.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `components/voximplant-video-layout.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `lib/room-provider/types.ts` (additive only)
- presence-related APIs/helpers where needed
- targeted room/presence e2e tests

### Files not to touch without explicit justification

- `prisma/schema.prisma`
- `prisma/migrations/*`
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
- `lib/voximplant/recording-dispatch.ts` (except explicitly approved additive typed message support)
- `docs/voximplant/neg-conf.main-room.scenario.js` (unless explicitly planned)
- Yandex transcription/analysis internals

### Required implementation design

- Server/domain data remains role source of truth.
- Do not infer authoritative role only from Vox SDK transport identity.
- Preserve current session control state machine.
- Preserve recording-control message contract unless additive, approved extension is introduced.
- Keep timer server-backed via existing control-state logic.
- Keep shared shell provider-agnostic.
- Implement one clear duplicate policy (recommended: newest connection replaces old stale connection).
- Enforce mute policy at media/recording boundary, not visual-only UI.

### Required e2e

- Vox room parity test covering:
  - facilitator + 2 participants + 2 observers;
  - visible roles and visible timer;
  - prepare/start/pause/resume/finish;
  - facilitator/observer muted during negotiation;
  - all muted during pause;
  - participants restored on resume;
  - refresh/rejoin preserves role and timer;
  - duplicate same-login policy deterministic.
- Add media mock/stub fallback for CI if real media is not feasible.
- Keep one manual real Vox smoke test outside CI.

### Manual user steps

- Set `VIDEO_PROVIDER=voximplant`.
- Confirm currently executed Vox scenario/rule names match env and Console.
- Start local dev server.
- If webhook end-to-end is needed, run:
  - `cloudflared tunnel --url http://localhost:3000`
- Update admin webhook override if tunnel URL changes.
- Run facilitator + 2 participants + 2 observers room walkthrough.
- Validate duplicate same-login behavior.
- Validate mute policy during run/pause/resume.
- Run recording smoke to ensure no regression.

### Validation

- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npx prisma generate`
- targeted Playwright room parity tests
- targeted presence/rejoin tests
- targeted recording debug/smoke test

### Definition of done

- Vox room is demo-usable with expected actor model.
- Roles and timer are clear and server-backed.
- Facilitator controls work for full state cycle.
- Duplicate same-login behavior is deterministic.
- Role-based microphone policy works.
- Pause/resume recording-audio policy works, or documented Vox limitation + approved fallback exists.
- Recording pipeline remains green.
- No regression in materials/status access.

## Stage 2 — Event/Lobby Vox Parity and Full Demo Flow

### Purpose

Complete migration for target demo path:
Event -> Vox Lobby -> Case selection -> Role assignment -> Session -> Room -> Recording -> Materials -> Return to Lobby.

### Scope

- migrate event lobby media/context to Voximplant when `VIDEO_PROVIDER=voximplant`;
- isolate LiveKit as legacy fallback only for `VIDEO_PROVIDER=livekit`;
- preserve event-state and event-to-session contracts;
- support facilitator + 2 participants + 2 observers;
- support deterministic lobby presence/rejoin/duplicate handling;
- support case selection and role assignment in lobby;
- support session creation from event;
- support room transition and return to lobby;
- preserve post-session flow: transcription, manual speaker-role assignment, AI analysis, share to participants.

### Likely files to change

- `components/event-lobby-view.tsx`
- `components/event-lobby-video-room.tsx` (possibly LiveKit-specific adapter)
- new Vox lobby media component/adapter
- `app/api/events/[id]/voximplant-access/route.ts` (or equivalent)
- `app/events/[id]/lobby/page.tsx`
- additive fields in `app/api/events/[id]/state/route.ts` or `lib/event-state.ts` only if needed
- lobby/session presence APIs if needed
- e2e event/lobby/session/materials specs

### Files not to touch without explicit justification

- core event/session DB creation logic (unless concrete documented gap)
- Prisma schema/migrations
- Yandex transcription/analysis internals
- Vox recording webhook route
- recording contract changes unless approved from Stage 1

### Required implementation design

- `VIDEO_PROVIDER=voximplant` must produce consistent Vox lobby + Vox room path.
- Event state remains domain contract.
- Provider-specific token/access logic stays inside provider adapter routes/components.
- Avoid leaking Vox specifics into domain services.
- Keep LiveKit lobby only as isolated legacy fallback.
- Keep lobby and room identity semantics compatible.

### Required e2e

- Full target demo scenario test (media mocked/stubbed if needed):
  Event -> Lobby -> Case selection -> Role assignment -> Session -> Preparation -> Start -> Timer -> Recording control -> Pause -> Resume -> Finish -> Transcription status -> Manual speaker role assignment -> AI analysis -> Share AI analysis -> Return to Lobby.
- Duplicate/rejoin checks in lobby and room.
- Vox provider-specific lobby test.
- Preserve provider-agnostic domain tests.

### Manual user steps

- Verify all Vox env vars for lobby and room.
- If scenario/rule behavior changes are required later, document exact Console steps.
- Restart local dev server after env changes.
- Start Cloudflare tunnel for webhook e2e if needed.
- Update webhook override in admin panel when tunnel changes.
- Manually execute full demo scenario with 1 facilitator, 2 participants, 2 observers.

### Validation

- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npx prisma generate`
- targeted event/lobby Playwright tests
- targeted full demo-flow Playwright test
- manual real Vox smoke test

### Definition of done

- LiveKit is not required in target demo path when `VIDEO_PROVIDER=voximplant`.
- Event lobby works on Voximplant.
- Lobby and room rejoin behavior is deterministic.
- Full demo flow works manually.
- At least one automated regression test covers demo flow with media mocked/stubbed where needed.
- Recording/transcription/AI/materials chain remains working.

## Stage 3 — Regression Pack and Yandex Deployment Readiness

### Purpose

Prepare for internal negotiation club testing and future Yandex server deployment.

### Scope

- stabilize full e2e regression pack;
- split provider-agnostic vs provider-specific tests;
- build reliable Vox-specific regression suite;
- include presence/rejoin/duplicate-connection regressions;
- include microphone/recording-policy regressions where automatable;
- document local env and deployment env;
- preserve debug tooling until confidence is sufficient;
- prepare operational smoke checklist.

### Required test taxonomy

1. Provider-agnostic domain tests:
   - cases, sessions, events, roles, permissions, materials/status.
2. Vox-specific adapter tests:
   - room access and UX parity;
   - room and lobby presence/rejoin/duplicate handling;
   - recording control relay;
   - pause/resume audio-recording behavior;
   - recording debug.
3. Manual real-provider smoke:
   - real Vox lobby + room;
   - real duplicate/rejoin scenario;
   - real recording and webhook through public URL;
   - real pause/resume audio policy;
   - real transcription/AI chain.

### Required e2e goals

- Permanently fix DB env/harness for e2e.
- Ensure full Playwright run completes.
- Ensure target demo path is covered.
- Convert old LiveKit assertions to provider-agnostic, or isolate under LiveKit-only suites.

### Connection lifecycle policy (target)

- Duplicate same-login behavior:
  - newest connection replaces prior active connection for same user+scope (lobby/session);
  - prior tab switches to stale/read-only/disconnected UI state.
- Rejoin behavior:
  - preserve participant identity, role, permissions, timer continuity.
- Stale cleanup:
  - heartbeat + explicit connection lease/version invalidation.
- Identity model:
  - domain identity keyed by user + event/session participant rows;
  - transport identities mapped to domain participant, never opposite.
- Lobby vs room:
  - same policy semantics; only UX and control affordances differ.

### Audio and recording policy (target)

- Preparation:
  - configurable speaking policy, but recording policy must remain explicit and auditable.
- Active negotiation:
  - only negotiating participants may be audible in official recording.
  - facilitator/observers remain muted for recording.
- Pause:
  - all participants muted for official recording.
  - pause discussion excluded from official negotiation recording.
- Resume:
  - participant recording audio restored.
  - facilitator/observers remain muted.
- Distinguish and validate all four layers:
  - UI mute state;
  - local mic capture state;
  - conference send state;
  - official recorder inclusion state.
- Required Vox mechanism:
  - enforce at scenario/conference-recorder layer (not UI-only).
- Known limitations/risks:
  - recorder pause semantics and role-aware mix controls require manual Vox validation against deployed scenario runtime.

### Rollback strategy per stage

- Stage 0 rollback point:
  - before checkpoint commit/tag.
  - revert only temporary artifacts and env-local experiments.
  - do not revert known green recording implementation.
- Stage 1 rollback point:
  - pre-UX/audio-policy parity commit.
  - revert room UX/presence/audio-policy layer only.
  - do not revert webhook/fileKey/transcription/AI chain.
- Stage 2 rollback point:
  - pre-lobby migration commit.
  - revert lobby provider adapter changes only.
  - keep domain event/session contracts and recording pipeline intact.
- Stage 3 rollback point:
  - pre-regression-pack hardening commit.
  - revert flaky test harness changes selectively.
  - keep deterministic connection and recording policy logic.
- Green-path confirmation after each rollback:
  - run minimal recording smoke: start -> stop -> webhook -> fileKey -> transcription -> AI completion.

### Manual user steps

- Run full Playwright suite.
- Run targeted Vox suite.
- Run real Vox manual smoke.
- Check DB `Recording` row after finish.
- Check `materials/status`.
- Check transcript speaker-role assignment flow.
- Check AI analysis sharing.
- Check return to event lobby.
- Check duplicate/rejoin behavior.
- Check pause/resume recording-audio behavior.
- Prepare Yandex deployment env list.
- Verify no tunnel/local-only assumptions are hardcoded.
- Verify debug/admin tooling is protected.

### Validation

- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npx prisma generate`
- `npx playwright test`
- targeted Vox tests
- manual production-like smoke

### Final acceptance criteria

- Technical:
  - full demo path works with recording pipeline intact.
- Product:
  - facilitator/participants/observers behavior is clear and deterministic.
- Demo:
  - 1 facilitator + 2 participants + 2 observers complete end-to-end flow.
- E2E:
  - harness stable and meaningful; critical demo path covered.
- Connection lifecycle:
  - deterministic duplicate and rejoin policy in lobby and room.
- Audio/recording policy:
  - enforced at actual recording boundary, not UI-only.
- Deployment readiness:
  - env documentation and Yandex deployment checklist complete.

