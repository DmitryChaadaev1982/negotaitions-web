# Stage 3.15A handoff — park after Checkpoint C

Date: 2026-08-18  
Purpose: resume tomorrow at Phase D from this exact worktree without reconstructing chat history.

```
NEXT_PHASE = D
PHASE_D_STARTED = NO
LAST_ACCEPTED_CHECKPOINT = C
MANUAL_CHECKPOINT_A = ACCEPTED
MANUAL_CHECKPOINT_B = ACCEPTED
MANUAL_CHECKPOINT_C = ACCEPTED
NO_COMMIT = YES
NO_PUSH = YES
NO_DEPLOY = YES
```

Authoritative requirements:
[`docs/requirements/stage-3-15a-post-processing-workflow.md`](../requirements/stage-3-15a-post-processing-workflow.md)

PT-01..PT-35 were **not** renumbered. Status values remain `APPROVED` until
final Stage acceptance (`PT-35`). Checkpoints A/B/C are recorded in that
manifest. This file is a resume contract, not a second requirement source.

Do not start Phase D from this document automatically. Wait for the operator
to continue in the same conversation/worktree.

---

## A. Worktree / git state

| Item | Value |
| --- | --- |
| Worktree | `C:\Projects\Negotiations AI\negotiations-web-stage-3-15a-post-processing` |
| Branch | `feat/stage-3-15a-post-processing-workflow` |
| Current HEAD | `964f074d4f5bb580dae2ab7a11404c24755778c3` |
| HEAD subject | `feat: add public site seo and consent-aware analytics` |
| Base | `origin/deploy/yandex-poc` at the same SHA `964f074d4f5bb580dae2ab7a11404c24755778c3` |
| Worktree clean | **NO** — all Stage 3.15A implementation is **uncommitted** on this HEAD |

`git diff --check` at park time: **PASS** (exit 0, no whitespace errors).

Do not commit, push, reset, or switch worktrees unless the operator explicitly
asks. Do not validate this worktree against another worktree's server.

### Changed files by purpose

**Lab / fixtures / runner**

- `scripts/lab-post-transcription.ts`
- `scripts/lab-run-auto-speaker-mapping.ts`
- `tests/e2e/post-transcription-lab.spec.ts`
- `tests/e2e/helpers/post-transcription-lab-*.ts`
- `tests/e2e/helpers/db.ts` (room-connection `createdAt` / overlap helpers)
- `package.json` (`lab:post-transcription`)
- `playwright.local.config.ts`
- `docs/testing/e2e-strategy.md`

**Speaker mapping / AM07 candidate unification**

- `lib/transcription/speaker-mapping-candidates.ts`
- `lib/transcription/speaker-mapping-candidate-load.ts`
- `lib/transcription/speaker-mapping-candidates.test.ts`
- `lib/transcription/auto-speaker-mapping.ts`
- `lib/transcription/auto-trigger-mapping.ts`
- `lib/transcription/mapping-decision.test.ts`
- `app/api/sessions/[sessionId]/speaker-mapping/route.ts`

**Phase B — metadata, diarizedText, enhancement locks**

- `lib/transcription/processing-metadata.ts` + `.test.ts`
- `lib/transcription/canonical-diarized-text.ts` + `.test.ts`
- `lib/services/transcript-enhancement-orchestration.ts` + `.test.ts`
- `app/api/sessions/[sessionId]/transcript/route.ts`
- `app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts`
- `components/recording-transcription-section.tsx`
- `components/session-materials-dashboard.tsx`

**Phase C — projection / completeness / shared consumers**

- `lib/transcription/speaker-mapping-completeness.ts` + `.test.ts`
- `lib/transcription/speaker-mapping-readiness.ts` + `.test.ts`
- `lib/post-processing/projection.ts` + `.test.ts`
- `lib/ai/analysis-readiness.ts` + `.test.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `app/api/sessions/[sessionId]/analyze/route.ts`
- `lib/session-overview-stats.ts`
- `components/session-post-processing-panel.tsx`
- `components/sessions-list-view.tsx`
- `lib/i18n/dictionaries/en.ts`
- `lib/i18n/dictionaries/ru.ts`

**Architecture / requirements / this handoff**

- `docs/architecture/06-recording-transcription-pipeline.md`
- `docs/architecture/07-speaker-mapping-and-telemetry.md`
- `docs/architecture/08-ai-analysis-and-debrief.md`
- `docs/architecture/code-map.md`
- `docs/requirements/stage-3-15a-post-processing-workflow.md`
- `docs/handoffs/stage-3-15a-phase-c-checkpoint.md`

Unrelated dirty tree noise such as `.next-e2e/` must not be committed.

---

## B. Approved requirements through Phase C

Authority: `docs/requirements/stage-3-15a-post-processing-workflow.md`.

| IDs | Through Phase C | Evidence notes |
| --- | --- | --- |
| PT-01, PT-02 | Lab exists: real routes/components/APIs, STATE_FIXTURE + PIPELINE_FIXTURE, catalog 43 scenarios | `CODE` + `LAB` + helper tests |
| PT-03, PT-04 | `mergeProcessingMetadata`; `buildCanonicalDiarizedText` | `CODE` + unit tests |
| PT-05, PT-06 | Enhancement ownership/recovery; same-identity COMPLETED not rewritten to SKIPPED | `CODE` + unit + E02/E05 |
| PT-07, PT-09 | Edit/save 409 + AI blocked while enhancement RUNNING | `CODE` + E02/E06/E07 + Checkpoint B |
| PT-10 | FAILED/PARTIAL/SKIPPED terminal; retry + continue-current-transcript | `CODE` + E03 Checkpoint C PASS |
| PT-11 | One structural completeness invariant; AM07 candidate population | `evaluateSpeakerMappingStructuralCompleteness`; AM07A–E |
| PT-12, PT-13, PT-17 | AUTO_SUGGESTED informational when complete; REQUIRED/incomplete blocks AI; one projection | S03/S10/S02 Checkpoint C PASS |
| PT-14, PT-15, PT-16 | **Not implemented** — Phase E (Start AI → CONFIRMED; save label) | S10 banner deferred |
| PT-18..PT-28 | **Not implemented** — Phase D | See resume contract below |
| PT-29, PT-30 | **Not implemented** — Phase F | Old `/transcribe-recording` fence |
| PT-31, PT-32 | Mapping fallback + no unsafe solver cleanup | AM01/AM02/AM04B/AM11 kept |
| PT-33, PT-34 | Interactive Lab + per-phase cheap check | A/B/C accepted |
| PT-35 | **Not done** — final stage acceptance | Broad suites not run |

---

## C. Checkpoint history

### Checkpoint A — ACCEPTED

- Production-safe Facilitator Lab accepted.
- S10 originally reproduced the **then-current** product contradiction:
  materials/AI treated AUTO_SUGGESTED as ready; `/sessions` still said mapping
  required. That contradiction was evidence, not a Phase A defect.
- Two fixture classes: `STATE_FIXTURE` (seeded finished states) and
  `PIPELINE_FIXTURE` (real `autoTriggerSpeakerMappingAfterTranscription`).
- AM01–AM14 strategy; AM04B covers many-to-one at
  `evaluateMappingSafety` + `decideAutoMappingApplication`.
- AM07 product defect found and fixed: auto-mapping and facilitator review
  now share one candidate loader.
- Canonical candidates = historical room presence ∩ `ParticipantType.PARTICIPANT`.
- Post-A speaker anchors stayed green: AM01, AM02, AM03, AM04, AM04B,
  AM07A–E, AM11.

### Checkpoint B — ACCEPTED

- `processingMetadata` writers reread + merge namespaces (do not erase
  `transcriptEnhancement` / unknown keys).
- Canonical `diarizedText` from lexical segment text + current mapping.
- Enhancement completion ownership is runId / identity / generation, not
  `updatedAt` alone.
- Same-identity already-COMPLETED is not rewritten to SKIPPED.
- Transcript/mapping/manual-attribution POST is 409 while enhancement RUNNING.
- AI start blocked while enhancement RUNNING; notes not blanket-locked.
- E05 terminal visual: enhancement COMPLETED, `[ИИ-уточнение]` lexical marker
  preserved, Lab Buyer / Lab Seller names preserved, editor unlocked.

### Checkpoint C — ACCEPTED

Operator visual:

| ID | Result |
| --- | --- |
| S03 | PASS — complete AUTO_SUGGESTED informational; AI can start |
| S10 | PASS — AI COMPLETED/current; mapping-required contradiction gone |
| E03 | PASS — FAILED terminal; retry + continue toward AI |
| S02 | PASS — incomplete mapping action_required; AI blocked (no mapping save) |

Implementation:

- One projection: `lib/post-processing/projection.ts`
  (RECORDING, TRANSCRIPTION, TRANSCRIPT_ENHANCEMENT, SPEAKER_MAPPING, AI_ANALYSIS).
- Semantic states: pending / running / ready / action_required /
  informational / failed / not_applicable.
- Consumers: five-card rail, materials status `postProcessing`, `/sessions`,
  dashboard pipeline text.
- Structural completeness is independent of the AUTO_SUGGESTED string.

**Phase E UX note (do not fix now):** S10 still shows

> Сопоставление применено. Проверьте и подтвердите его.  
> Сопоставление можно изменить позже.

while AI is already COMPLETED. Misleading, not a C failure. Phase E must
persist CONFIRMED on successful Start AI admission, then refine RU/EN copy
at Manual Checkpoint E.

---

## D. Discoveries / invariants (do not lose)

1. Automatic mapping and facilitator review use the same canonical candidate
   population from historical room presence
   (`loadCanonicalSpeakerMappingCandidates`).
2. Invitation alone is not candidacy. Never-entered invitees are excluded.
3. Entered-then-disconnected can remain a candidate if the connection
   overlapped the evidence interval.
4. Facilitator/Observer presence does not create negotiation speaker
   candidates (`selectNegotiationSpeakerMappingCandidates` keeps PARTICIPANT).
5. Active fallback remains remote telemetry → local mic → review/manual.
6. Existing global 2x2 margin override (AM11) stays intact.
7. Existing many-to-one safety stays intact (AM04B).
8. `AUTO_SUGGESTED` is algorithm-only, not human confirmation.
9. Structural completeness is independent from status-label shortcuts.
10. Enhancement RUNNING is a hard barrier for transcript/material edits and
    AI start. Facilitator/observer notes are not locked by that barrier.
11. COMPLETED / PARTIAL / FAILED / SKIPPED are terminal enhancement states
    when a usable transcript exists. FAILED/PARTIAL/SKIPPED allow continue
    with current transcript (Start AI is the continue path).
12. `processingMetadata` writers must preserve sibling/unknown namespaces.
13. `diarizedText` is a derived canonical projection: keep lexical text and
    mapped names.
14. Room connections used for mapping evidence must overlap the recording
    interval. Lab pipeline inserts connections with
    `createdAt = recording.startedAt - 60s`.
15. Playwright workers cannot import production `@/` modules that pull Prisma
    ESM (`import.meta`). Lab inspect/pipeline may import only Prisma-free
    helpers (`speaker-mapping-completeness`, `projection` via relative paths).
    Real algorithm runs through `scripts/lab-run-auto-speaker-mapping.ts` (tsx).
16. Do not pass enhancement RUNNING as `isLocked` on
    `RecordingTranscriptionSection` — that overlay hides the transcript.
17. Enhancement rail visibility needs `transcriptionProvider: "yandex_speechkit"`
    on Lab seeds when enhancement ≠ `none`.
18. Do not overlap two managed Playwright servers on port **3100**.
19. PowerShell: use `;` not `&&`.
20. S10 Lab AI fixture must be a valid canonical analysis document (not a
    stub `{executiveSummary, overallScore}`).
21. Valid ANALYSIS_READY does **not** show “ИИ-разбор готов.” Assert
    `ai-report`.

---

## E. Lab state

Fail-closed Lab. Real app routes, real React, real APIs, isolated E2E DB.
Does not mock product React components. Refuses production hosts
(`negotaitions.ru` and non-local/staging/test/dev/e2e `*.negotaitions.ru`),
refuses non-isolated `DATABASE_URL` / `E2E_DATABASE_URL`, and forces mock /
disabled provider modes. After `.env` load, Lab must keep
`VOXIMPLANT_SERVER_STOP_MODE=disabled`.

Known commands in this worktree:

```
npm run lab:post-transcription -- S10
npm run lab:post-transcription -- S10 E02
npm run lab:post-transcription -- S10 --smoke
npm run lab:post-transcription -- AM01 AM02 AM03 AM04 AM04B AM07A AM07B AM07C AM07D AM07E AM11 --smoke
npm run lab:post-transcription -- E05
npm run lab:post-transcription -- S03 S10 E03 S02
npm run lab:post-transcription -- --smoke E03 E05 S02 S03 S10
```

`--smoke` disables `page.pause`. Headed Lab uses Playwright managed server on
**3100**. Do not start a second managed Playwright server.

| Class | Meaning |
| --- | --- |
| STATE_FIXTURE | Seed finished domain rows; inspect current UI/API |
| PIPELINE_FIXTURE | Seed transcript/telemetry only; run real auto-mapping |

Important IDs:

- Mapping presentation: **S02** REQUIRED/incomplete; **S03** AUTO_SUGGESTED
  complete before AI; **S10** AUTO_SUGGESTED + AI COMPLETED; **S11** CONFIRMED
- Enhancement: **E02/E06/E07** RUNNING locks; **E03** FAILED continue;
  **E05** COMPLETED terminal visual
- Pipeline anchors: **AM01** remote AUTO_SUGGESTED; **AM02** local;
  **AM03** REQUIRED; **AM04/AM04B** many-to-one; **AM07A–E** candidate parity;
  **AM11** global-margin override
- Phase D notes/rewind (catalog exists, behavior not implemented):
  **N01..N05**, **I01**, **I03**, **S17**, **S18**

---

## F. Test state (actually executed)

Do **not** claim `validate:fast`, `validate:deploy`,
`test:e2e:smoke`, `test:e2e:smoke:browser`, or the full Playwright suite.
Those have **not** been run for the accumulated Stage 3.15A tree.

| Check | Latest result |
| --- | --- |
| AM01, AM02, AM03, AM04, AM04B, AM07A–E, AM11 | PASS (post-A anchors, before Phase B depth) |
| Phase B units (metadata merge, diarizedText, enhancement recovery, same-identity COMPLETED) | PASS |
| Phase B E02/E06/E07 smoke | 3 passed |
| Phase B E05 smoke + headed visual | 1 passed; operator accepted terminal visual |
| Phase C units (completeness, projection, readiness, lab catalog helpers) | 38 passed, then 15 re-checked after Playwright import fix |
| Phase C Lab smoke `E03 E05 S02 S03 S10` | **5 passed** (27.6s); `S10_MAPPING_CONTRADICTION_STILL_REPRODUCED=NO` |
| Checkpoint C headed S03/S10/E03/S02 | Operator PASS |
| `git diff --check` at park | PASS |

---

## G. Intentional deferrals

- Phase D fingerprint / rewind / Prisma `AiAnalysis.inputFingerprint` — **not started**
- Phase E AUTO_SUGGESTED → CONFIRMED on Start AI, save-label, S10 banner copy — **not started**
- S10 residual confirmation banner intentionally deferred to Phase E
- Speaker solver cleanup not performed (PT-32)
- Old `/transcribe-recording` convergence/fencing is Phase F
- Proven-safe cleanup is Phase G
- Final architecture polish after behavior exists is Phase H
- Final broad validation / PT-35 not run
- No commit, push, or deploy

---

## NEXT SESSION — PHASE D

```
NEXT_PHASE = D
PHASE_D_STARTED = NO
LAST_ACCEPTED_CHECKPOINT = C
```

Start only after the operator continues. Local/test Prisma only. Do **not**
apply a production migration.

### Already-approved Phase D scope

From the original Stage 3.15A prompt (D1–D12):

- Add nullable `AiAnalysis.inputFingerprint` (SHA-256-capable storage,
  repo-consistent). Historical rows stay NULL. No mass backfill.
- One deterministic material-envelope builder reused with the AI prompt
  context. Same normalized context for fingerprint and prompt. Stable keys,
  stable semantic array order, explicit `schemaVersion` (e.g. `1`). Hash
  SHA-256.
- Envelope includes only actual mutable negotiation-AI prompt inputs
  (transcript/segments/mapping/names/roles, participant preparation notes,
  role objectives/constraints/hiddenInfo/fallback, material session/case
  snapshot, analysis language, other prompted mutable values).
- Legacy `inputFingerprint = NULL` stays readable via `transcriptId` +
  `retranscribeCount`. Do not retroactively stale historical analyses.
- Fingerprinted currentness on materials/status, share/publish, recipient
  access, facilitator current projection. Mismatch → AI not current,
  `canShare` false, stale publication not served, facilitator presentation
  `NOT_STARTED` / needs rerun. Do not show old AI as current ready-but-stale.
- Facilitator-controlled material save with active publication: warn, then
  save + revoke + make AI non-current. Old `AiAnalysis` remains historical.
  Fingerprint mismatch fails closed even if revoke lags.
- Do not start Phase E from Phase D.

### Role-aware notes contract — do not lose

**Negotiation PARTICIPANT notes**

- Preparation/position notes are current negotiation AI input.
- MUST be included in the fingerprint if the prompt uses them.
- Changing them changes fingerprint/currentness.
- Existing post-negotiation UI lock MUST remain. Do **not** open participant
  post-negotiation editing in the UI.
- Phase D tests may use controlled DB/system mutation for positive
  invalidation (N01/N02).

**FACILITATOR notes**

- Not current negotiation AI input. Excluded from fingerprint.
- Must not invalidate AI or revoke publication.
- Remain editable per existing permissions.
- Enhancement/AI material locks must not blanket-lock them.

**OBSERVER notes**

- Same non-material behavior as facilitator notes for current negotiation AI.
- Excluded from fingerprint. Must not invalidate AI or revoke publication.
- Remain editable per existing permissions.

Future facilitator/observer debrief feedback distributed to participants:
**OUT OF SCOPE.**

If the current analysis builder includes facilitator/observer notes, correct
it to this contract and add tests.

### Required Phase D controls

| ID | Expected |
| --- | --- |
| N01 | Participant material note controlled change → fingerprint changes → current AI false |
| N02 | Published AI + participant material note controlled change → revoke / current false via approved helper |
| N03 | Facilitator note change → fingerprint unchanged → AI current → publication unaffected |
| N04 | Observer note change → fingerprint unchanged → AI current → publication unaffected |
| N05 | Participant post-negotiation preparation notes remain locked; facilitator/observer notes remain editable |
| Non-prompt field mutation | Fingerprint unchanged; AI remains current |

Cheap check before any broad suite: schema/migration tests; deterministic
fingerprint + stable ordering; same-context fingerprint/prompt; participant
positive; facilitator/observer/non-material negatives; legacy NULL
compatibility; stale share denial; stale recipient denial; Lab **I01, I03,
N01, N02, N03, N04, N05**.

Manual Checkpoint D (after CONTINUE C implementation): headed **I01, I03,
N03, N04, N05**, plus N01/N02 evidence if participant notes stay locked in
normal UI. Then STOP and wait for `CONTINUE D`.

### Architecture docs for Phase D

Before coding, read `docs/architecture/README.md`,
`docs/architecture/code-map.md`, `08-ai-analysis-and-debrief.md`,
`10-data-storage-and-retention.md`, and `prisma/schema.prisma`. Update mapped
architecture docs in the same change. Inspect generated Prisma types before
SQL.

### Working-mode reminder

One continuous Stage 3.15A conversation and this worktree. Parent model:
Grok 4.6. Do not open a new implementation chat, new worktree, or commit
unless the operator asks.
