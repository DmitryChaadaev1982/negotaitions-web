# Large realistic transcript enhancement UAT

This is **not** the Post-processing Facilitator Lab and **not** CP-BENCH.
It does not compare models or score enhancement quality.

## Why two tools exist

- **Deterministic Lab (LAB-01..28)** — acceptance, race, and Skip/UI coverage
  with `page.pause()` checkpoints. Mock-safe. Do not extend it with this
  scenario (no LAB-29).
- **Large realistic UAT** — one frozen BUG02 operating point
  (`1800` chars, per-job `8`, global `10`, `reserved_slot`, D1) against a
  deterministic ~30-minute synthetic Russian B2B transcript, using the **real
  current Yandex enhancement path**.

## Skip is not Resume

- **Skip / Continue with current transcript**
  (`CONTINUE_WITH_CURRENT_TRANSCRIPT`): the operator abandons publication
  from this run. The current published raw transcript stays authoritative.
  Durable completed chunks are **not** partially published. A later Improve
  starts a **new** run.
- **Retry / Resume unfinished**: the same eligible D1 job continues
  unfinished work (`RETRYABLE_FAILED`, `PENDING`, interrupted `RUNNING`
  converted to retryable). Already `COMPLETED` chunks are not sent to Yandex
  again.
- **Automatic provider retry is bounded and resume-aware**: at most 2 HTTP POST
  attempts per chunk per run, owned by D1 orchestration. A resumed run reads the
  durable `attemptCount`, so a chunk that already spent both attempts sends no
  further request. A live-provider observation showing 3+ POSTs for one chunk in
  one run is a defect, not expected retry behavior. HTTP 429 waits
  `max(backoff, Retry-After)` capped at 30 s; that wait holds no provider slot.
- **Global provider capacity is shared with the maintenance process**: both the
  app and the Stage 3.10 oneshot lease from the same 10-slot
  `TranscriptEnhancementProviderSlot` inventory (8 per job). A live run may
  therefore observe waiting rather than immediate parallelism when another
  process holds capacity.

## Manual session start state

`npm run uat:enhancement:large-manual` seeds an isolated E2E session:

- session finished, recording completed, transcription ready
- published transcript = RAW synthetic text (`qualityText` = same RAW)
- enhancement `NOT_STARTED` (no job, no chunks, no auto-start)
- AI analysis not started
- mapping `AUTO_SUGGESTED` and inspectable/editable

Opening the ordinary Product materials page must not start enhancement.
The operator click on «Запустить ИИ-улучшение» is T0.

## Commands

Isolated `E2E_DATABASE_URL` only. Never production DB/host/SSH/deploy.

- `npm run uat:enhancement:large-provider` — one live Yandex background
  qualification (`executeTranscriptEnhancement` → `enhanceTranscriptWithYandexAi`)
- `npm run uat:enhancement:large-manual` — fresh NOT_STARTED session, headed
  Product UI, then free operator control. Prints `LARGE_UAT_MANUAL = READY`
  plus `SESSION_ID` / `SESSION_URL` before handing control to the operator.
  A healthy registry-proven Large-UAT-owned Next on `127.0.0.1:3101` is reused.
  Silent success is forbidden.
- `npm run uat:enhancement:large-manual -- --mode=resume` — controlled
  unfinished-chunk resume harness (real Yandex for unfinished chunks only).
  This path completes in-process via `runTranscriptEnhancementRecoveryTick`.
- `npm run uat:enhancement:large-manual -- --mode=recovery` — operator
  Scenario 3 handoff. Real Yandex prepares durable COMPLETED chunks 0–2,
  injects PENDING 3–19 + RETRYABLE_FAILED 20 on the same D1 run, holds the
  lease until the Product materials page is open, then expires the lease.
  Recovery is the existing automatic status-read tick
  (`reconcileTranscriptEnhancementTimeout` →
  `runTranscriptEnhancementRecoveryTick`), not Skip and not a new Improve.
  Prints `LARGE_UAT_RECOVERY = READY` and does not wait for completion.
- `npm run uat:enhancement:large-report -- --latest` — read-only current
  isolated-DB state (`CURRENT_DB_STATE` is authoritative). Does not stop
  Next/browser/provider PIDs, does not mutate the session, and does not
  label a stale `latest.json` seed snapshot as `LIVE_YANDEX`. An optional
  historical artifact block is labeled `OPTIONAL_ARTIFACT_SNAPSHOT`.
  When provider-observe JSONL exists, the report also prints
  `PROVIDER_COMPLETED_AFTER_SKIP` / `LATE_CHECKPOINT_ACCEPTED` from HTTP
  timestamps, not from D1 chunk status. A recovery session also prints
  `RECOVERY_PROVIDER_CALL_CHUNKS` / `RECALLED_COMPLETED_CHUNKS` using
  `RECOVERY_START`, not D1 status.   The Next server used for manual
  UAT is started with `LARGE_REALISTIC_UAT_PROVIDER_OBSERVE=1` so
  `instrumentation.ts` can install the UAT observer onto the generic
  enhancement observation seam. Late Yandex completions are recorded
  after Skip even though D1 refuses the checkpoint. Production
  (`NODE_ENV=production`) never installs that observer and never writes
  this file.
- `npm run uat:enhancement:large-cleanup` — delete **only** sessions/users
  marked as this synthetic fixture
- `npm run test:uat:enhancement:large` — deterministic fixture/safety tests

Reports are written under gitignored `.debug/large-realistic-uat/`.
Do not auto-delete sessions before collecting a report.

## Process ownership

The launcher never infers ownership from "a Next process is listening on 3100
or 3101". It may terminate a process only when its own registry proves it, and
the proof is re-verified against the live process every time:

- the PID was recorded by this worktree when the harness spawned the server
  (`.debug/large-realistic-uat/owned-processes.json`, gitignored);
- the registry record's `worktreeRoot` equals the current worktree;
- the process still exists and its command line still equals the snapshot taken
  at spawn time, so a reused PID is refused;
- the command line or working directory names this worktree, so a sibling
  worktree running the same command is refused;
- the recorded listener is actually listening on the recorded port;
- the `.next-e2e` dist dir marker still exists.

A recorded launcher process is stopped only once one of its recorded listeners
passes every check, and the launcher's own ancestor PIDs are always protected.
Anything else observed on the port is reported with a refusal reason and left
running; the harness fails rather than taking a port it cannot prove it owns.

Mode gating: `provider`, `report`, `preflight`, `cleanup`, and the headless
`--mode=resume` harness terminate zero browser and dev-server processes. Only
the headed operator modes (`manual` default and `--mode=recovery`) may stop the
runtime they previously recorded, and only their own recorded descendants.

`tests/e2e/helpers/large-realistic-uat-process-ownership.ts` holds the decision
logic; `tests/e2e/helpers/large-realistic-uat-runtime.test.ts` covers
UAT-PID-01..06 deterministically plus a Windows process-level probe that proves
an unrelated listener survives cleanup.

## Local prerequisite before headed UAT

The headed Product/Lab UAT runs against a real Next server. Before starting it,
the target database must already carry the
`20260916090000_add_transcript_enhancement_provider_slots` migration; provider
admission fails closed without the `TranscriptEnhancementProviderSlot`
inventory. The isolated E2E database used by the UAT harness is migrated
separately from the local development database — run `prisma migrate deploy`
against the development database before serving the Product app from it. Never
point that command at a production-like `DATABASE_URL`.

## Client currentness after publication

A stay-on-page materials tab that watched RUNNING must hydrate the published
`/recording` segments before enhancement polling settles. Hard reload is not
required after `terminalQuality=COMPLETED` / published kind `enhanced`.
Skip / PARTIAL / FAILED do not use that obligation.
