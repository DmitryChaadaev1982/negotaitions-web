# Yandex POC Smoke & Regression Test Plan

**Date:** 2026-07-03  
**Target:** `https://app.negotaitions.ru` (negotaitions POC)  
**Stack:** Voximplant + Yandex Object Storage + Yandex SpeechKit + Yandex AI  
**Rules:** Manual plan + E2E backlog; no code changes in this document

---

## 1. Objectives

1. Confirm **technical pipeline** (room → recording → webhook → S3 → transcription → analysis) on POC.
2. Confirm **session UX parity** with original product (timer, roles, layout, facilitator/observer behavior).
3. Establish a **repeatable smoke** script for post-deploy validation.
4. Define **Playwright E2E** scope for later automation.

---

## 2. Prerequisites

### 2.1 Environment (POC)

| Check | Expected |
|---|---|
| `VIDEO_PROVIDER` | `voximplant` |
| `TRANSCRIPTION_PROVIDER` | `yandex_speechkit` |
| `AI_ANALYSIS_PROVIDER` | `yandex` |
| `APP_URL` | `https://app.negotaitions.ru` |
| `VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL` | `https://app.negotaitions.ru` |
| Vox key path | `/etc/negotaitions/secrets/voximplant_private.json` |
| Service | `negotaitions-poc` running single instance |

### 2.2 Test accounts

| Role | Requirement |
|---|---|
| Admin | In `ADMIN_EMAILS`; access `/admin` |
| Facilitator / host | ACTIVE user |
| Participant A | ACTIVE user, second browser/profile |
| Participant B | ACTIVE user, third browser/profile |
| Observer | ACTIVE user, fourth browser/profile |

### 2.3 Test data

- One **published case** with exactly two assignable roles (buyer/seller or Participant A/B naming).
- Optional: one case with **non-English / custom role names** to stress layout heuristics.

### 2.4 Tools

- Chrome + Edge (or Chrome + Firefox) for multi-user simulation
- Admin access to `/admin` and optionally `/admin/voximplant-recording`
- Optional: `?debugRecording=1` for facilitator (non-production or controlled)

---

## 3. Smoke test tiers

| Tier | Duration | When |
|---|---|---|
| **S0** Admin health | 5 min | Every deploy |
| **S1** Room join + timer | 15 min | Every deploy |
| **S2** Full event session | 45 min | Weekly / pre-demo |
| **S3** Materials pipeline | 30–60 min | After S2 or recording fix |
| **R** Regression suite | 2–4 h | Before major release |

---

## 4. S0 — Admin health smoke

| # | Step | Expected | Fail action |
|---|---|---|---|
| S0.1 | Open `https://app.negotaitions.ru/admin` as admin | Diagnostics load | Check service + nginx |
| S0.2 | Verify env display: `VIDEO_PROVIDER=voximplant` | Correct provider | Fix `.env` / systemd |
| S0.3 | Vox section: application, scenario, rule configured | All true | Fix env |
| S0.4 | Webhook secret + base URL configured | true | Fix env |
| S0.5 | S3 check (storage probe) | Pass | Fix bucket credentials |
| S0.6 | ffmpeg check | available | Install ffmpeg or use static |
| S0.7 | Yandex keys present | folder + api key | Fix Yandex IAM |
| S0.8 | `GET /api/admin/check-voximplant` | Success JSON | Key file / Management API |

**High-risk surfaces:** `/api/admin/health`, `lib/services/admin-health.ts`

---

## 5. S1 — Standalone session room smoke

Create a standalone session via `/sessions/new` (facilitator + 2 participants + observer).

| # | Step | Expected | testid / signal |
|---|---|---|---|
| S1.1 | Facilitator opens `/room/[sessionId]` | Vox connects, sidebar loads | — |
| S1.2 | Verify timer visible | Preparation timer shown | `room-server-timer` |
| S1.3 | Participant opens same room (other browser) | Joins, correct sidebar role | — |
| S1.4 | Desktop layout | Zones: observers, A, center (timer+facilitator), B | `vox-zone-main-desktop` |
| S1.5 | Facilitator START PREPARATION | State → PREPARATION_RUNNING; timer counts | control-state |
| S1.6 | Wait or SKIP preparation | READY_TO_START | — |
| S1.7 | Facilitator START negotiation (with recording consent) | RUNNING; recording indicator active | RecordingIndicator |
| S1.8 | Observer mic | Locked / policy muted label | tile subtitle |
| S1.9 | FINISH | FINISHED overlay; debrief options | `session-finished-message` |
| S1.10 | Refresh facilitator tab mid-RUNNING | Timer resumes; no duplicate self tile | — |
| S1.11 | Same user second tab | Stale banner or 409 on control | stale connection UX |

**High-risk files:** `voximplant-negotiation-room-page.tsx`, `voximplant-video-layout.tsx`, `shared-room-shell.tsx`

---

## 6. S2 — Full event flow smoke

| # | Step | Expected |
|---|---|---|
| S2.1 | Create event `/events/new` | Event created |
| S2.2 | Open lobby `/events/[id]/lobby` as host + 3 others | All see lobby |
| S2.3 | Vox lobby video | `EventLobbyVoximplantRoom` renders; mic/camera toggles work |
| S2.4 | Host selects case + assigns roles + observer | Assignment draft saved |
| S2.5 | Host creates session | Assigned cards appear with room link |
| S2.6 | Each assigned user enters room | Correct participant type in sidebar |
| S2.7 | Run short negotiation (2–3 min) | Timer + layout OK |
| S2.8 | FINISH + return to lobby | Event lobby accessible; session marked complete |
| S2.9 | Lobby → room → lobby again (one participant) | No SDK DISCONNECTING error |
| S2.10 | Complete event (host) | Event COMPLETED; lobby results view |

**Duplicate participant check:** Same user must appear **once** in lobby list. If twice → log event ID for dedupe bug.

**High-risk files:** `event-lobby-view.tsx`, `event-lobby-voximplant-room.tsx`, `lib/event-state.ts`, `create-event-session.ts`

---

## 7. S3 — Recording & materials pipeline smoke

Run after S1 or S2 with at least 60 seconds of spoken audio.

| # | Step | Expected | API / UI |
|---|---|---|---|
| S3.1 | During RUNNING, recording indicator | RECORDING | recording-control refresh |
| S3.2 | After FINISH, wait ≤2 min | Webhook received | journalctl / debug panel |
| S3.3 | Open session materials | Recording stage `ready` | `/materials/status` |
| S3.4 | Facilitator start transcription | Status → TRANSCRIBING | `/materials/transcribe` |
| S3.5 | Wait for completion | Transcript text present | materials UI |
| S3.6 | Speaker labels | Names match participants | speaker mapping section |
| S3.7 | Run AI analysis | COMPLETED | `/analyze` or auto |
| S3.8 | Share with session (facilitator) | Observer can view | share API |
| S3.9 | Optional: enhancement | If enabled, enhancement COMPLETED | status metadata |

**Optional CLI (on downloaded file):**

```bash
npm run inspect:audio -- /path/to/recording.mp3
```

Record codec, sample rate, bitrate in test notes.

**High-risk files:** `voximplant/recording-status/route.ts`, `transcription-runner.ts`, `yandex-speechkit-transcription.ts`

---

## 8. Regression areas (manual R suite)

### 8.1 Session lifecycle

| Scenario | Reference spec |
|---|---|
| Preparation pause/resume | `session-lifecycle.spec.ts` |
| Auto-finish preparation timer | `session-lifecycle.spec.ts` |
| Duration edit in PREPARATION | `session-duration-editor` flow |
| Session close by event | `event-completion.spec.ts` |

### 8.2 Role & access

| Scenario | Reference |
|---|---|
| Unassigned participant locked notes | `phase-6-11b-session-role-assignment.spec.ts` |
| Facilitator role management | same |
| Guest join closed | `phase-6-4-1-session-guest-closed.spec.ts` |
| Account-only room | `phase-6-10-standalone-sessions-auth-role.spec.ts` |

### 8.3 Event domain

| Scenario | Reference |
|---|---|
| Multi-session event | `event-multi-session.spec.ts` |
| Case library in lobby | `event-case-library.spec.ts` |
| Event flow end-to-end | `event-flow.spec.ts` |

### 8.4 Vox-specific (local / CI with DB)

| Scenario | Reference |
|---|---|
| Room parity | `voximplant-room-parity.spec.ts` |
| Event lobby | `voximplant-event-lobby.spec.ts` |
| Layout / camera | `voximplant-layout-camera-model.spec.ts` |
| Recording debug | `voximplant-recording-debug.spec.ts` |

Run locally:

```powershell
$env:DATABASE_URL="postgresql://negotiations:negotiations_password@localhost:5432/negotiations_vox_test"
$env:VIDEO_PROVIDER="voximplant"
npx playwright test tests/e2e/voximplant-room-parity.spec.ts
npx playwright test tests/e2e/voximplant-event-lobby.spec.ts
```

---

## 9. E2E automation backlog (implement later)

| Priority | Spec | Scope |
|---|---|---|
| P0 | `voximplant-poc-materials-chain.spec.ts` | Mock webhook → transcribe → analyze with yandex providers |
| P0 | `voximplant-role-zones.spec.ts` | Parametrized case roles → zone testids |
| P1 | `voximplant-timer-two-context.spec.ts` | Facilitator + participant timer sync |
| P1 | `voximplant-recording-relay-failure.spec.ts` | Simulate failed sendConferenceMessage |
| P1 | Provider matrix wrapper | Run domain specs under `VIDEO_PROVIDER=voximplant` |
| P2 | `event-lobby-dedupe.spec.ts` | Seed duplicate EventParticipant; assert single card |
| P2 | Mobile viewport layout | Playwright device profiles for `vox-zone-main-mobile` |

**CI recommendation:** Job `e2e-vox` with Postgres service container + env matrix; separate from LiveKit legacy job.

---

## 10. Recording quality checks

| Check | Method | Pass criteria |
|---|---|---|
| File lands in S3 | Admin storage / DB fileKey | Non-empty key |
| File size reasonable | S3 console | > 10 KB for 1 min speech |
| Codec metadata | `npm run inspect:audio` | Document rate/channels |
| No double lossy encode | Compare size before/after compress step | Small files skip recompress |
| SpeechKit diarization | Transcript segments | ≥2 speakers for 2-party case |
| Mapping accuracy | Manual review | Buyer/seller names correct |

---

## 11. Failure triage guide

| Symptom | Likely cause | First check |
|---|---|---|
| Room won't join | Vox identity / scenario | `/api/admin/check-voximplant`, browser console |
| Timer missing | Stale bundle or JS error | Network tab: control-state 200? |
| Wrong role zone | Role name heuristics | Case role names vs `room-layout-model.ts` |
| Recording stuck STARTING | Browser relay failed | Facilitator console; retry recording-control |
| No fileKey | Webhook URL / HMAC | Admin webhook base URL; server logs |
| Transcription FAILED | SpeechKit auth/quota | `/admin/log` ExternalServiceEvent |
| ffmpeg error | Binary missing | Admin ffmpeg status |
| 409 stale connection | Expected on old tab | Refresh stale tab |
| Duplicate lobby user | Duplicate EventParticipant rows | DB query by eventId+userId |

---

## 12. Test report template

```markdown
## POC smoke — YYYY-MM-DD

- Deploy commit: ______
- Tester: ______
- S0: PASS / FAIL — notes
- S1: PASS / FAIL — notes
- S2: PASS / FAIL — notes
- S3: PASS / FAIL — notes
- Recording fileKey: ______
- inspect:audio: codec __, rate __, channels __
- Issues filed: ______
```

---

## 13. Exit criteria for "POC demo ready"

All must pass:

- [ ] S0 admin health green
- [ ] S2 full event flow without SDK errors
- [ ] Timer visible for facilitator and participants (desktop)
- [ ] Role zones correct for standard 2-role case
- [ ] S3 recording → transcript → analysis completes once
- [ ] Observer access follows share rules
- [ ] No P0 security regressions (auth gates on room/lobby)

---

## 14. Recommended execution order (next safe step)

**Before any code changes:**

1. Run **S0** on production POC (15 min).
2. Run **S2 + S3** once with real users; fill test report template.
3. If timer/layout issues: capture screenshots + `control-state` JSON + case role names.
4. If recording issues: enable debug panel; capture webhook + recording row states.
5. Only then prioritize fixes from `session-flow-gap-analysis.md` P0 list.

This validates whether reported UX gaps are **deploy/config** vs **code** issues.
