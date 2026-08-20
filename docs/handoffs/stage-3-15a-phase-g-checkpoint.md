# Stage 3.15A handoff — park after Checkpoint G

Date: 2026-08-20  
Purpose: resume tomorrow at Phase H from this exact worktree without reconstructing chat history.

```
NEXT_PHASE = H
PHASE_H_STARTED = NO
LAST_ACCEPTED_CHECKPOINT = G
CHECKPOINT_G_ACCEPTED = YES
MANUAL_CHECKPOINT_A = ACCEPTED
MANUAL_CHECKPOINT_B = ACCEPTED
MANUAL_CHECKPOINT_C = ACCEPTED
MANUAL_CHECKPOINT_D = ACCEPTED
MANUAL_CHECKPOINT_E = ACCEPTED
MANUAL_CHECKPOINT_F = ACCEPTED
MANUAL_CHECKPOINT_G = ACCEPTED
NO_COMMIT = YES
NO_PUSH = YES
NO_DEPLOY = YES
```

Authoritative requirements:
[`docs/requirements/stage-3-15a-post-processing-workflow.md`](../requirements/stage-3-15a-post-processing-workflow.md)

PT-01..PT-35 were **not** renumbered. Status values remain `APPROVED` until
Phase H closes them as `PASS`, `DECISION_REQUIRED`, or operator-deferred.
PT-35 is **not** complete. Do not create PT-36.

Do not start Phase H from this document automatically. Wait for the operator
to continue in the same conversation/worktree.

---

## A. Worktree / git state

| Item | Value |
| --- | --- |
| Worktree | `C:\Projects\Negotiations AI\negotiations-web-stage-3-15a-post-processing` |
| Branch | `feat/stage-3-15a-post-processing-workflow` |
| Current HEAD | `964f074d4f5bb580dae2ab7a11404c24755778c3` |
| HEAD subject | `feat: add public site seo and consent-aware analytics` |
| Base production branch | `origin/deploy/yandex-poc` at the same SHA `964f074d4f5bb580dae2ab7a11404c24755778c3` |
| Stage 3.15A original starting SHA | `964f074d4f5bb580dae2ab7a11404c24755778c3` |
| Worktree clean | **NO** — all Stage 3.15A implementation remains **UNCOMMITTED** on this HEAD |

`git diff --check` at park time: **PASS** (exit 0, no whitespace errors).

Do not commit, push, reset, discard, or switch worktrees unless the operator
explicitly asks. Do not validate this worktree against another worktree's
server. Playwright Lab uses managed server port **3100**.

Unrelated dirty tree noise such as `.next-e2e/` must not be committed.
Do not include `.env` or secrets.

### Changed / new files grouped by phase purpose

**Lab / fixtures / runner (Phase A, reused later)**

- `scripts/lab-post-transcription.ts`
- `scripts/lab-run-auto-speaker-mapping.ts`
- `scripts/lab-apply-material-invalidation.ts`
- `scripts/lab-attempt-participant-notes-write.ts`
- `scripts/lab-stamp-input-fingerprint.ts`
- `tests/e2e/post-transcription-lab.spec.ts`
- `tests/e2e/helpers/post-transcription-lab-*.ts`
- `tests/e2e/helpers/db.ts`
- `package.json` (`lab:post-transcription`)
- `playwright.local.config.ts`
- `docs/testing/e2e-strategy.md`

**Speaker mapping / AM07 / solvers (Phase A; preserved through G)**

- `lib/transcription/speaker-mapping-candidates.ts` + `.test.ts`
- `lib/transcription/speaker-mapping-candidate-load.ts`
- `lib/transcription/auto-speaker-mapping.ts`
- `lib/transcription/auto-trigger-mapping.ts`
- `lib/transcription/mapping-decision.test.ts`
- `app/api/sessions/[sessionId]/speaker-mapping/route.ts`

**Phase B — metadata, diarizedText, enhancement**

- `lib/transcription/processing-metadata.ts` + `.test.ts`
- `lib/transcription/canonical-diarized-text.ts` + `.test.ts`
- `lib/services/transcript-enhancement-orchestration.ts` + `.test.ts`
- `app/api/sessions/[sessionId]/transcript/route.ts`
- `app/api/sessions/[sessionId]/manual-speaker-attribution/route.ts`

**Phase C — projection / completeness / shared consumers**

- `lib/post-processing/projection.ts` + `.test.ts`
- `lib/transcription/speaker-mapping-completeness.ts` + `.test.ts`
- `lib/transcription/speaker-mapping-readiness.ts` + `.test.ts`
- `lib/ai/analysis-readiness.ts` + `.test.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `lib/session-overview-stats.ts`
- `components/session-post-processing-panel.tsx`
- `components/sessions-list-view.tsx`

**Phase D — fingerprint, rewind, notes, Prisma**

- `prisma/schema.prisma`
- `prisma/migrations/20260819120000_add_ai_analysis_input_fingerprint/`
- `lib/ai/material-input-envelope.ts` + `.test.ts`
- `lib/ai/material-input-invalidation.ts` + `.test.ts`
- `lib/ai/material-negotiation-notes.ts` + `.test.ts`
- `lib/ai/analysis-currentness.ts` + `.test.ts`
- `lib/ai-publication-revoke.ts`
- `lib/participant-notes-write.ts`
- `lib/debrief-visible-notes.ts` + `.test.ts`
- `lib/ai/session-analysis-context.ts`
- `lib/ai/session-analysis-prompt.ts` + `.test.ts`
- `app/api/sessions/[sessionId]/analyze/route.ts`
- `app/api/sessions/[sessionId]/ai-analysis/share/route.ts`
- `app/api/sessions/[sessionId]/ai-analysis/unshare/route.ts`
- `app/actions/sessions.ts`
- `components/participant-notes-panel.tsx`
- `lib/legal/privacy.ts`, `lib/legal/ai-notice.ts`, `lib/legal/legal-copy.test.ts`
- `docs/architecture/04-session-event-flow.md`, `10-data-storage-and-retention.md`, `12-external-systems.md`

**Phase E — mapping confirmation, save copy, roomQuick/materialsDetail**

- `lib/transcription/confirm-mapping-after-ai-admission.ts` + `.test.ts`
- `lib/transcription/speaker-mapping-state.ts` + `.test.ts`
- `lib/transcription/phase-e-save-contract.test.ts`
- `lib/transcription/recording-transcription-presentation.ts` + `.test.ts`
- `lib/transcription/mapping-ui-presentation.ts`
- `lib/transcription/assisted-speaker-mapping.ts` + `.test.ts`
- `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ru.ts`
- `components/recording-transcription-section.tsx`
- `components/session-materials-dashboard.tsx`

**Phase F — transcription ownership / canonical adapter**

- `lib/services/transcription-ownership.ts` + `.test.ts`
- `lib/services/transcription-generation-cas.ts` + `.test.ts`
- `lib/services/transcription-run-claim.ts`
- `lib/services/transcription-runner.ts`
- `lib/services/transcribe-recording-compatibility.ts` + `.test.ts`
- `lib/services/transcription-phase-f-race.test.ts`
- `lib/transcription/transcription-routes.ts` + `.test.ts`
- `app/api/sessions/[sessionId]/materials/transcribe/route.ts`
- `app/api/sessions/[sessionId]/materials/retranscribe/route.ts`
- `app/api/sessions/[sessionId]/transcribe-recording/route.ts`
- `tests/e2e/session-lifecycle.spec.ts` (mock fixture text aligned to canonical runner)

**Phase G — conservative cleanup**

- `D components/speaker-mapping-panel.tsx`
- `lib/access-control.ts` (unused aliases removed)

**Docs / this handoff**

- `docs/requirements/stage-3-15a-post-processing-workflow.md`
- `docs/architecture/06-recording-transcription-pipeline.md`
- `docs/architecture/07-speaker-mapping-and-telemetry.md`
- `docs/architecture/08-ai-analysis-and-debrief.md`
- `docs/architecture/code-map.md`
- `docs/handoffs/stage-3-15a-phase-c-checkpoint.md` (historical park after C)
- `docs/handoffs/stage-3-15a-phase-f-checkpoint.md`
- `docs/handoffs/stage-3-15a-phase-g-checkpoint.md` (this file; resume at H)

---

## B. Checkpoint state

```
CHECKPOINT_A = ACCEPTED
CHECKPOINT_B = ACCEPTED
CHECKPOINT_C = ACCEPTED
CHECKPOINT_D = ACCEPTED
CHECKPOINT_E = ACCEPTED
CHECKPOINT_F = ACCEPTED
CHECKPOINT_G = ACCEPTED
NEXT_PHASE = H
PHASE_H_STARTED = NO
```

---

## C. Phase A–G architecture summary (accepted)

- Facilitator Lab: real routes, real React, real APIs.
  `STATE_FIXTURE` + `PIPELINE_FIXTURE`. Synthetic telemetry mapping is real
  solver validation, not mocked React.
- Canonical speaker candidates = historical room presence ∩ `PARTICIPANT`
  (AM07A–E). Never-entered invitees do not reduce coverage.
- Mapping fallback: remote telemetry → local mic telemetry → review/manual.
  Global 2x2 margin override preserved (AM11). Many-to-one safety preserved
  (AM04 source selection + AM04B decision core).
- `processingMetadata`: reread + `mergeProcessingMetadata` (no stale whole-JSON
  namespace wipe).
- `diarizedText`: one policy via `buildCanonicalDiarizedText` (lexical segment
  text + current speaker identity/mapping). Raw `buildDiarizedText` remains
  for providers.
- Enhancement `RUNNING` barrier; completion ownership is run identity, not
  `updatedAt` alone. Terminal `COMPLETED` / `PARTIAL` / `FAILED` / `SKIPPED`
  remain usable; same-identity COMPLETED is not rewritten to SKIPPED.
- Canonical five-stage server projection: `projectPostProcessingStages`.
  Complete `AUTO_SUGGESTED` is `informational`. Structural completeness:
  `evaluateSpeakerMappingStructuralCompleteness`.
- Nullable `AiAnalysis.inputFingerprint` (additive migration
  `20260819120000_add_ai_analysis_input_fingerprint`). SHA-256 canonical
  material envelope `schemaVersion = 1`. Same snapshot for prompt + hash.
  Legacy NULL fingerprint uses `transcriptId` + `retranscribeCount`.
  Stale AI rewinds presentation; historical rows retained. Active publication
  revokes via existing Unshare. Stale recipient access fails closed.
- Participant preparation notes: material, fingerprinted, locked after
  `FINISHED`, visible post-meeting by approved role matrix (own notes only
  for the participant; facilitator/authorized observer see all participant
  preparation notes; read-only after negotiation). Lock ≠ hide.
- Facilitator/observer own notes: non-material, editable under existing
  permissions, do not invalidate AI or revoke publication.
- `AUTO_SUGGESTED` is algorithm-only advisory. Successful Start AI confirms
  structurally complete AUTO_SUGGESTED (`CONFIRMED` + timestamps/by).
- Complete human mapping save → `CONFIRMED`; cannot revert to AUTO_SUGGESTED.
- Transcript primary save: RU `Сохранить транскрипт` / EN `Save transcript`.
  Mapping-only save stays separate.
- Presentation split: Debrief `roomQuick` vs Materials `materialsDetail`.
- `/transcribe-recording`: `OLD_ROUTE_MODE=CANONICAL_ADAPTER`. Not a fallback.
  Shared admit/claim. Competing writer 409. Compatibility envelope
  `{ transcript, warnings, recording }` preserved.
- Phase G: conservative dead-code cleanup only (see section F).

---

## D. Legal / data residency

ООО «Фастком» / Voximplant written evidence (2026-08-19): provider-side
cross-border transfer = **NO**. Processing by that provider, including media
traffic and technical support, is in the Russian Federation. Client-selected
recording storage is saved to the client; the provider does not retain a copy.

User-facing scoped wording is in Privacy Policy and AI-processing notice.
It explicitly applies **only** to Voximplant.

```
PLATFORM_WIDE_NO_CROSS_BORDER_CLAIM_SUPPORTED = NO
```

Do **not** introduce “all platform data stays in Russia”. Cookie consent copy
was not in Phase G cleanup scope.

---

## E. Validation already performed (focused only)

Do **not** claim these for the full accumulated Stage 3.15A diff:

- `validate:fast`
- final lint/build/deploy validation
- broad/final regression selection
- final requirement-by-requirement PT-01..PT-35 evidence review
- final independent high-risk reviewer
- production deployment

| Phase | Latest focused evidence |
| --- | --- |
| A | Lab + AM01 AM02 AM03 AM04 AM04B AM07A–E AM11 |
| B | metadata/diarizedText/enhancement units; E02/E06/E07; E05 headed |
| C | projection/completeness/readiness units; Lab smoke S03 S10 E03 S02 S11; headed C |
| D | fingerprint/currentness/notes units; Lab I01 I03 N03 N04 N05 headed |
| E | save-contract + mapping-status units; Lab S03 S10 S11 E03 I03; headed S03-A/B |
| F | F01–F08 units; F09 AM01–AM04/AM04B/AM07A–E/AM11; `git diff --check` |
| G | projection/mapping/fingerprint/legal/F-route units (61 pass); AM01–AM04/AM04B/AM07A–E/AM11 AM12 AM13 (13 pass); `git diff --check` |

Lab catalog IDs **S06/S07 do not exist**. Do not invent them. PT-15/PT-16
evidence is `speaker-mapping-state.test.ts` + `phase-e-save-contract.test.ts`.

---

## F. Intentional deferrals (not required Phase H product work)

These are **not** silently converted into Stage 3.15A closure TODOs unless a
PT item cannot close without them:

- `hasWeakMargins` unused helper (inline live check differs)
- speaker-solver consolidation
- unused `room.*` mapping i18n keys after panel removal
- client `speakerMappingRequired` OR projection semantic
- `/transcribe-recording` deprecation/removal
- platform-wide no-cross-border claim (unsupported)

Phase G accepted REMOVE/KEEP:

**REMOVED:** `components/speaker-mapping-panel.tsx`; unused
`canEditSpeakerMapping`, `canAccessSessionMaterials`, `canRunTranscription`,
`canRunAiAnalysis`.

**KEPT:** canonical adapter endpoint and compatibility restore/response;
canonical projection; `isSpeakerMappingReadyForAnalysis`; fingerprint +
NULL-legacy currentness; canonical/raw diarized text helpers; role-aware
notes; Voximplant-scoped legal copy.

Accepted G flags:

```
SPEAKER_SOLVER_CONSOLIDATION_PERFORMED = NO
OLD_TRANSCRIBE_ENDPOINT_REMOVED = NO
CANONICAL_PROJECTION_PRESERVED = YES
CANONICAL_DIARIZED_TEXT_PRESERVED = YES
FINGERPRINT_CURRENTNESS_PRESERVED = YES
ROLE_AWARE_NOTES_PRESERVED = YES
VOXIMPLANT_SCOPED_LEGAL_COPY_PRESERVED = YES
FOCUSED_REGRESSIONS = PASS
SPEAKER_ANCHORS = PASS
git diff --check = PASS
```

---

## NEXT SESSION — PHASE H

```
NEXT_PHASE = H
PHASE_H_STARTED = NO
LAST_ACCEPTED_CHECKPOINT = G
```

Phase H is the **final documentation / requirement validation / broad
validation / packaging** phase.

Do **not** introduce new product architecture unless final validation
discovers a real defect.

Expected Phase H scope:

1. Finalize Stage 3.15A architecture/docs/runbook/test documentation.
2. Verify all approved product semantics from Phases A–G are documented.
3. Complete PT-01..PT-35 requirement-by-requirement validation.
4. Every PT item must end as `PASS`, `DECISION_REQUIRED`, or explicitly
   operator-deferred where permitted.
5. No requirement may remain silently unknown/untested.
6. Map actual evidence to every requirement: implementation, focused tests,
   Lab/manual checkpoint, docs.
7. Run final focused regression suites.
8. Then run `validate:fast`, lint/build/deploy validation according to
   repository tooling, and `git diff --check`.
9. Run final targeted high-risk review using the already-approved independent
   reviewer approach.
10. Review Prisma migration safety: `AiAnalysis.inputFingerprint` nullable
    additive migration.
11. Verify no production secrets / env files / Lab seed data are included.
12. Verify Lab/test production guards remain fail-closed.
13. Verify no unsupported platform-wide cross-border claim was introduced.
14. Produce the final Stage 3.15A completion report.
15. **STOP BEFORE COMMIT/PUSH/DEPLOY** for operator review unless the original
    Stage 3.15A instructions explicitly place commit packaging inside Phase H.

Do not perform any of this until the operator continues.
