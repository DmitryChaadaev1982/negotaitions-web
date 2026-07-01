# Stage 3 Regression and Yandex Readiness Audit

Date: 2026-07-01  
Branch: `exp/yandex-voximplant-main-room`

## Preflight gate result

All required preflight checks passed before implementation:

1. Clean working tree: passed.
2. `checkpoint/vox-room-parity-stage-1`: present.
3. `checkpoint/vox-event-lobby-stage-2`: present.
4. `npm run lint`: passed (warnings only, no errors).
5. `npm run build`: passed.
6. `npx prisma validate`: passed.
7. `npx prisma generate`: passed.
8. Stage 1 and Stage 2 targeted tests: passed.

## A) Current architecture summary

### Event lobby provider flow

- Provider switch is controlled by `VIDEO_PROVIDER`.
- Vox path: event APIs + Vox access + account-first participant identity.
- LiveKit path remains as isolated legacy fallback.

### Session room provider flow

- Account-first access in `app/api/sessions/[sessionId]/voximplant/access/route.ts`.
- Browser performs one-time-key handoff and joins Vox conference via WebSDK.
- Room client is in `lib/voximplant/use-voximplant-room.ts`.

### Recording flow

- Recording control command is generated server-side in `lib/voximplant/recording-dispatch.ts`.
- Browser relays message to scenario (`conference.sendMessage(...)`).
- Recording row lifecycle is persisted in DB (`STARTING/RECORDING/STOPPED/COMPLETED/FAILED`).

### Webhook flow

- Vox callback endpoint: `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`.
- Signature validation uses `VOXIMPLANT_RECORDING_WEBHOOK_SECRET`.
- Invalid signature returns `401` and does not update DB.

### Transcription flow

- Recording file fetched from storage.
- Compression/transcoding handled in `lib/audio/compress.ts`.
- Provider dispatch in `lib/services/transcription-provider.ts`.
- Yandex SpeechKit client in `lib/services/yandex-speechkit-transcription.ts`.

### AI analysis/materials flow

- Transcript and analysis statuses are exposed via materials/status endpoints.
- Analysis sharing and access controls enforced by role-aware materials APIs.

### Observer-safe analysis sharing flow

- Observer path is sanitized to shared/general data only.
- Participant path receives only own private recommendations.
- Facilitator path receives full analysis scope.

### LiveKit fallback boundaries

- Kept intact for legacy compatibility.
- Vox-specific changes remain isolated in Vox routes/helpers/components.

## B) Deployment-readiness risks

### Required env/secret readiness

- Voximplant credentials and rule/scenario names must be present.
- Webhook secret and base URL must be configured.
- Storage credentials and bucket settings must be valid.
- Yandex SpeechKit and Yandex AI credentials must be present.
- Optional DeepSeek credentials must match selected enhancement model.

### Domain and HTTPS assumptions

- Public HTTPS URL is required for webhook callbacks.
- Local tunnels are acceptable for smoke, but must not be hard-coded.

### Vox console assumptions

- Rule + scenario must match environment names.
- Recording settings in console must align with expected webhook contract.

### Database/build assumptions

- Existing Prisma schema is sufficient for current Stage 3 scope.
- No migration required for implemented Stage 3 hardening.
- Next.js build/runtime assumptions validated by `npm run build`.

### Debug flags to disable/protect

- `RECORDING_DEBUG_PANEL` should remain off in production unless explicitly needed.
- Debug endpoints are gated and return 404 when disabled.

## C) Multi-instance / concurrency risks

Current implementation:

- `lib/session-room-connection-lease.ts`: in-memory `globalThis` map.
- `lib/event-lobby-connection-lease.ts`: in-memory `globalThis` map.

Implications:

- Works for local/single-process demo.
- Not safe for multi-instance horizontal deployment.
- Newest-connection-wins semantics can diverge across instances.

Recommendation:

- Production-grade lease should be centralized:
  - Redis-backed lease (recommended), or
  - DB-backed lease table/lock strategy.

Schema note:

- Robust DB lease likely requires explicit persistence model.
- No schema migration was introduced in this Stage 3 pass.

## D) Full demo flow risk map

Status legend:

- ✅ covered by existing automated tests
- ⚠️ manual smoke required

1. Create/open Event — ✅  
2. Join as facilitator — ✅  
3. Join as participant A — ✅  
4. Join as participant B — ✅  
5. Join as observer 1 — ✅  
6. Join as observer 2 — ⚠️ manual multi-tab/account smoke  
7. Vox lobby opens — ✅  
8. Camera busy/unavailable handling — ✅  
9. Case selection — ✅  
10. Role assignment — ✅  
11. Session creation — ✅  
12. Lobby -> Room transition — ✅  
13. Preparation timer — ✅  
14. Start negotiation — ✅  
15. Recording start — ⚠️ partially automated (debug path), full Vox runtime smoke needed  
16. Pause — ⚠️ manual  
17. Resume — ⚠️ manual  
18. Finish — ✅/⚠️ (state flow covered, real recording smoke needed)  
19. Recording stop — ⚠️ manual real runtime  
20. Recording webhook — ✅ signature + status path covered; ⚠️ real infra smoke needed  
21. Transcription — ⚠️ manual real audio run  
22. Manual speaker role assignment — ⚠️ manual  
23. AI analysis — ⚠️ manual real provider run  
24. Share/send materials — ✅  
25. Observer sees only general/shared analysis — ✅  
26. Participant sees only allowed participant-specific content — ✅  
27. Return to lobby/events — ✅

## E) Existing test coverage inventory

### `tests/e2e/voximplant-room-parity.spec.ts`

- Roster composition and parity.
- Timer/control-state persistence.
- Role/access correctness.
- Materials access.
- Audio policy transitions.

### `tests/e2e/voximplant-room-presence.spec.ts`

- Newest-wins connection lease semantics.
- Stale facilitator action blocking.
- Stale heartbeat rejection.

### `tests/e2e/voximplant-layout-camera-model.spec.ts`

- Layout model and role zoning.
- Camera toggle idempotency.
- Busy camera fallback.
- Diagnostics visibility rules.

### `tests/e2e/voximplant-recording-debug.spec.ts`

- Debug endpoint gate behavior.
- Snapshot/events endpoints.
- Smoke lifecycle in debug mode.
- Simulated signed webhook completion.

### `tests/e2e/event-flow.spec.ts`

- Account-first event join flow.
- Event/session duration separation.

### `tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts`

- Broad event/session/account regression set.
- Materials privacy and access controls.
- Facilitator API authorization boundaries.
- Navigation and token leakage checks.

### `tests/e2e/voximplant-event-lobby.spec.ts`

- Lobby lease semantics.
- Stale lease access blocking.
- Participant dedupe.
- Vox path presence and LiveKit isolation.

### Observer-analysis/materials tests

- Covered in `phase-6-12` (T14/T15, T18-T21) and related materials tests.

## Gaps and Stage 3 decision

Remaining gaps are primarily real-runtime integration:

- True Vox recording artifact inspection (codec/bitrate/rate/channels).
- Real webhook over public HTTPS in deployed environment.
- SpeechKit quality A/B comparison on identical script.
- Facilitator + 2 participants + 2 observers full live smoke with camera constraints.

Decision:

- Keep existing automated suite unchanged.
- Add manual smoke/runbook and audio A/B checklist (documented in Stage 3 docs).

## F) Debug/security cleanup audit

- Debug recording API is gated by `isRecordingDebugEnabled()` and returns `404` when disabled.
- Webhook endpoint rejects invalid signature with `401` (`Invalid webhook signature.`).
- Webhook debug output redacts sensitive fields (`lib/debug/recording-debug.ts`).
- No hard-coded Cloudflare tunnel URL found in runtime server logic; only docs/placeholders reference example URLs.
- No production dependency on local personal filesystem paths was introduced.

## G) Playwright and env stability audit

- Known local failure mode reproduced: `EADDRINUSE` on default `PLAYWRIGHT_PORT=3100`.
- Safe fallback command is documented and validated:

```powershell
$env:PLAYWRIGHT_PORT="3000"
```

- DB env for tests remains required and documented:

```powershell
$env:DATABASE_URL="postgresql://negotiations:negotiations_password@localhost:5432/negotiations_vox_test"
```

No risky test infra refactor was introduced in Stage 3.

