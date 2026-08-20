# Stage 3.15A Authoritative Requirement Manifest

## Authority and use

This is the authoritative, implementation-independent requirement manifest for
Stage 3.15A — Post-processing facilitator workflow and UI hardening.

Approved product decisions in the Stage 3.15A implementation packet are the
product authority. Current architecture documents may confirm or refine a
requirement; historical stage reports, forensic audits, existing tests, and
implementation claims are supporting evidence only and cannot add, weaken, or
replace a requirement.

Do not silently weaken an `APPROVED` requirement. If implementation proves an
`APPROVED` requirement impossible or unsafe, set `DECISION_REQUIRED` and stop
for operator decision.

Status values used in this stage:

- `APPROVED` — accepted for implementation
- `PASS` — finished review with evidence
- `DECISION_REQUIRED` — implementation proved the requirement impossible or unsafe
- `DEFERRED_BY_OPERATOR` — operator explicitly deferred

Do not use `UNKNOWN` for finished review. Green tests alone are not sufficient
for `PASS`.

## Manual checkpoints

```
MANUAL_CHECKPOINT_A = ACCEPTED
MANUAL_CHECKPOINT_B = ACCEPTED
MANUAL_CHECKPOINT_C = ACCEPTED
MANUAL_CHECKPOINT_D = ACCEPTED
MANUAL_CHECKPOINT_E = ACCEPTED
MANUAL_CHECKPOINT_F = ACCEPTED
MANUAL_CHECKPOINT_G = ACCEPTED
MANUAL_CHECKPOINT_H = ACCEPTED
```

```
CHECKPOINT_G_ACCEPTED = YES
PHASE_H_STARTED = YES
CHECKPOINT_H_ACCEPTED = YES
NEXT_PHASE = AUTHORIZED_PRODUCTION_PACKAGING_AND_DEPLOY
```


Checkpoint C operator verification (2026-08-18):

| Scenario | Result |
| --- | --- |
| S03 | PASS — structurally complete AUTO_SUGGESTED is informational; AI can start; mapping is not a blocker |
| S10 | PASS — AI COMPLETED/current; former Materials vs `/sessions` mapping-required contradiction is gone; residual confirm-later banner is a Phase E UX note, not a C failure |
| E03 | PASS — enhancement FAILED is terminal; retry available; continue with current transcript toward AI available |
| S02 | PASS — incomplete mapping is action_required; AI blocked; operator did not save/complete mapping (blocking-state check only) |

Resume handoff: `docs/handoffs/stage-3-15a-local-operator-acceptance.md`.
Manual Checkpoints A–H are accepted. PT-01..PT-35 are PASS. Pre-deploy local
operator acceptance is PASS. Packaging/deploy proceed under the authorized
Stage 3.15A production packet.

## Phase E S06 / S07 accounting

`S06` and `S07` are not IDs in the current Facilitator Lab catalog. They must
not remain an unexplained PT-15/PT-16 gap.

Equivalent Phase E evidence:

| Intended semantic | Actual evidence | Result |
| --- | --- | --- |
| Complete human save → `CONFIRMED` | `lib/transcription/speaker-mapping-state.test.ts` (`complete human mapping save persists CONFIRMED`); Lab `S11` | PASS |
| Human save cannot revert to `AUTO_SUGGESTED` | same unit file (`complete CONFIRMED mapping does not revert`); Lab `S11_CONFIRMED_NOT_REVERTED=YES` | PASS |
| Save transcript RU/EN primary action | `recording.saveTranscript` = `Сохранить транскрипт` / `Save transcript`; `GradientButton` on edit-transcript and manual attribution | PASS |
| Mapping-only save remains separate | `recording.saveMappingAction` + `data-testid="save-speaker-mapping-button"` | PASS |

## Cross-cutting legal / data-residency amendment (2026-08-19)

Recorded during Phase D. **Do not renumber PT-01..PT-35. Do not create PT-36.**

New written provider evidence from ООО «Фастком» (Voximplant), ИНН 7702764401,
dated 2026-08-19, confirmed that processing performed by that provider,
including media-traffic processing and technical support, is performed within
the Russian Federation and that cross-border transfer by ООО «Фастком» is not
performed. The provider also confirmed that when client storage is selected
for call/video recording, the recording is saved to the client's storage and
ООО «Фастком» does not retain a copy on its own servers.

This evidence is authoritative **only** for ООО «Фастком» / Voximplant. It
must not be rewritten as a platform-wide “NegotAItions never transfers any
data outside Russia” claim unless every active production data path is
separately proven.

**Execution boundary:** recorded during Phase D. User-facing Voximplant-scoped
wording was added in Privacy Policy and AI-processing notice after Checkpoint D.
Do not publish the private correspondence. Preserve this amendment through
final PT-35 evidence.

```
PLATFORM_WIDE_NO_CROSS_BORDER_CLAIM_SUPPORTED = NO
```

Do not introduce a platform-wide “all data stays in Russia” claim.

See `docs/architecture/12-external-systems.md` for the provider register.

## Phase G accepted cleanup (2026-08-20)

Conservative dead-code cleanup only. Deferred items are **not** Phase H
product work unless a PT requirement cannot close without them.

**Removed:** orphan `components/speaker-mapping-panel.tsx`; unused
`access-control` aliases `canEditSpeakerMapping`,
`canAccessSessionMaterials`, `canRunTranscription`, `canRunAiAnalysis`.

**Kept:** `/transcribe-recording` canonical adapter; compatibility restore
and response envelope; canonical projection; `isSpeakerMappingReadyForAnalysis`;
fingerprint + NULL-legacy currentness; `buildCanonicalDiarizedText` /
`buildDiarizedText`; role-aware notes; Voximplant-scoped legal copy.

**Deferred:** `hasWeakMargins`; speaker-solver consolidation; unused
`room.*` mapping i18n keys; client `speakerMappingRequired` OR projection
semantic.

Focused regressions PASS. Speaker anchors AM01–AM04/AM04B/AM07A–E/AM11/AM12/AM13
PASS. `git diff --check` PASS.

## Phase H packaging (2026-08-20)

Final documentation, requirement-evidence, and repository validation completed
in this worktree. Operator accepted Checkpoint H on 2026-08-20.

This does **not** authorize commit, push, or production deploy. A separate
pre-deploy local real-session acceptance gate remains pending:
`docs/handoffs/stage-3-15a-local-operator-acceptance.md`. That gate is not a
new PT ID (do not create PT-36).

```
CHECKPOINT_H_ACCEPTED = YES
PT_01_35_ALL_ACCOUNTED = YES
PT_PASS_COUNT = 35
PT_DECISION_REQUIRED_COUNT = 0
PT_DEFERRED_BY_OPERATOR_COUNT = 0
AUTOMATED_STAGE_3_15A_VALIDATION = PASS
HISTORICAL_SESSION_ACCEPTANCE = PASS
NEW_SESSION_ACCEPTANCE = PASS
PRE_DEPLOY_LOCAL_ACCEPTANCE = PASS
STAGE_3_15A_READY_FOR_COMMIT = YES
STAGE_3_15A_READY_FOR_DEPLOY = YES
VALIDATE_FAST = PASS
VALIDATE_DEPLOY = PASS
INDEPENDENT_HIGH_RISK_REVIEW = PASS
COMMIT_CREATED = YES
PUSH_PERFORMED = NO
DEPLOY_PERFORMED = NO
```

## Evidence types

| Type | Meaning |
| --- | --- |
| `CODE` | Implementation in mapped runtime or lab source |
| `TEST` | Automated unit, helper, API, or E2E evidence |
| `LAB` | Deterministic Facilitator Lab scenario |
| `MANUAL` | Operator visual checkpoint in this conversation |
| `DOC` | Current-state architecture / testing documentation |

## Requirements

| ID | Requirement | Acceptance evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| PT-01 | Production-safe Post-processing Facilitator Lab using real application routes, real React components, real APIs for tested transitions, and deterministic initial test DB fixtures. | `CODE` + `TEST` + `LAB` | PASS | Lab must not mock React product components. Two fixture classes: STATE_FIXTURE and PIPELINE_FIXTURE. |
| PT-02 | Lab covers normal, enhancement, speaker mapping, AI, publication, rewind and selected legacy/compatibility states. | `CODE` + `LAB` | PASS | State matrix S02–S18, E01–E07, I01–I05, N01–N05, F05 plus auto-speaker pipeline AM01–AM14. |
| PT-03 | `processingMetadata` updates cannot erase another subsystem's namespace through stale whole-JSON merge. | `CODE` + `TEST` | PASS | Preserve unknown/historical keys including `transcriptEnhancement` and `mappingSuggestion`. Writers reread + `mergeProcessingMetadata` before persist. |
| PT-04 | `diarizedText` has one canonical construction policy based on current lexical segment text + current speaker identity/mapping. | `CODE` + `TEST` | PASS | Enhancement must not erase mapped names; mapping must not rewrite lexical text. Canonical helper: `buildCanonicalDiarizedText`. |
| PT-05 | Enhancement `RUNNING` has reliable stale/recovery semantics and cannot remain permanently stuck due to a competing write/CAS ownership loss. | `CODE` + `TEST` + `LAB` | PASS | No concurrent successful owners. Completion ownership is runId/identity/generation, not `updatedAt` alone. |
| PT-06 | Same-identity already-`COMPLETED` enhancement does not misleadingly regress the visible logical state to `SKIPPED` merely because no new enhancement call was needed. Real disabled/auto-off `SKIPPED` remains supported. | `CODE` + `TEST` | PASS | `skip_completed_same_identity` returns without rewriting COMPLETED. |
| PT-07 | Transcript/material edit/save that can conflict with enhancement is blocked client-side and server-side while enhancement is `RUNNING`. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | View remains allowed. E02/E06/E07 plus 409 on transcript/mapping/manual-attribution. |
| PT-08 | Material negotiation-AI inputs are protected while AI is `QUEUED`/`ANALYZING`. Protection is material-input aware and must not block facilitator or observer notes solely because those notes share `SessionParticipant` storage. | `CODE` + `TEST` + `LAB` | PASS | Server enforcement: `decideFacilitatorMaterialChangeGuard` + 409 `MATERIAL_CHANGE_AI_RUNNING` on transcript/mapping/attribution. Facilitator/observer notes stay off that path. |
| PT-09 | AI cannot start while enhancement is non-terminal/`RUNNING`. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | Analyze returns 409; materials `canStart` is false while enhancement is IN_PROGRESS. |
| PT-10 | `COMPLETED` / `PARTIAL` / `FAILED` / `SKIPPED` are usable terminal enhancement outcomes where the existing transcript is usable. Starting AI from `FAILED`/`PARTIAL`/`SKIPPED` is implicit acceptance of the current transcript. No new durable "accept failed enhancement" column. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | UI must make the choice understandable. |
| PT-11 | Speaker mapping structural completeness uses one canonical server invariant. | `CODE` + `TEST` | PASS | Canonical helper: `evaluateSpeakerMappingStructuralCompleteness`. Do not use `mappingSuggestion.isApplied`, cluster JSON alone, client draft alone, or `AUTO_SUGGESTED` string alone. PIPELINE_FIXTURE AM05/AM03 prove incomplete/review blocks. Canonical candidate population is historical room presence ∩ PARTICIPANT (AM07A–E). |
| PT-12 | `AUTO_SUGGESTED` means automatic algorithm output only. A structurally complete `AUTO_SUGGESTED` state is advisory/informational, not an unresolved blocker. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | Human save must not create this status. PIPELINE_FIXTURE AM01/AM02/AM06/AM11 must reach AUTO_SUGGESTED only via `autoTriggerSpeakerMappingAfterTranscription`. Pre-AI advisory is informational; after AI admission the confirm-later banner is hidden. |
| PT-13 | `REQUIRED` / `NEEDS_REVIEW` / structurally incomplete mapping blocks AI. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | PIPELINE_FIXTURE AM03/AM04/AM05/AM08/AM09/AM10. |
| PT-14 | Starting AI with a structurally complete `AUTO_SUGGESTED` mapping persists `CONFIRMED` + `speakerMappingConfirmedAt`/`By` using the existing fields. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | `shouldConfirmAutoSuggestedMappingAfterAiAdmission` after successful claim. Algorithm itself must not write CONFIRMED (AM01). Manual Checkpoint E accepted. |
| PT-15 | A complete human transcript/mapping save ends in `CONFIRMED`. Human complete save does not create `AUTO_SUGGESTED` and does not silently revert `CONFIRMED`. | `CODE` + `TEST` | PASS | Incomplete permitted drafts may remain action-required. Phase E catalog IDs S06/S07 do not exist; evidence is `deriveSpeakerMappingStatus` in `lib/transcription/speaker-mapping-state.test.ts` plus `lib/transcription/phase-e-save-contract.test.ts`. |
| PT-16 | The edit-transcript/manual-attribution primary save action is RU `Сохранить транскрипт` and a natural EN `Save transcript` equivalent, with clear primary visual hierarchy. | `CODE` + `LAB` + `MANUAL` | PASS | Manual attribution and plain transcript use `saveTranscript` + GradientButton. Mapping-only save stays distinct. Phase E S06/S07 N/A; same evidence as PT-15 plus RU/EN dictionary contract. |
| PT-17 | One canonical server-side post-processing projection supplies semantic stage state to the top five-card rail, detailed post-processing rows, `/sessions` list, account dashboard, and materials UI. Clients do not independently reinterpret `AUTO_SUGGESTED`/`CONFIRMED`/readiness. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | Domain / readiness / presentation remain separate layers. No giant persisted pipeline enum. Helper: `projectPostProcessingStages`. Complete AUTO_SUGGESTED is `informational` on rail and `/sessions`. |
| PT-18 | New `AiAnalysis` rows support nullable `inputFingerprint` for material-input freshness. `retranscribeCount` retains ASR-generation meaning. `analysisVersion` retains AI-run/publication meaning. | `CODE` + `TEST` + `DOC` | PASS | Additive nullable column + `20260819120000_add_ai_analysis_input_fingerprint`. No historical backfill. Manual Checkpoint D accepted. Legacy pre-mutation bind at a material-write boundary is a PT-22 compatibility baseline, not a new-run prompted snapshot (PT-19). |
| PT-19 | `inputFingerprint` is computed from the exact normalized MATERIAL context used to produce the negotiation AI prompt. Notes are role/type-aware. Only notes belonging to actual negotiation participants whose notes are used by the negotiation-analysis prompt are material. Facilitator and Observer notes are not fingerprinted. | `CODE` + `TEST` | PASS | Predicate: `areNotesMaterialToNegotiationAnalysis`. Prompt and envelope both use it. |
| PT-20 | The fingerprint envelope includes every actual mutable material input consumed by the AI prompt and excludes facilitator/observer notes, non-prompt data, emails/user IDs if not prompted, and arbitrary loaded-but-unused fields. | `CODE` + `TEST` | PASS | `buildMaterialInputEnvelope` from the same `SessionAnalysisContext`. NM01 control field: `SessionRole.privateInstructions`. |
| PT-21 | A deploy that merely changes model/prompt implementation does not silently make all existing analyses stale. Fingerprint serialization uses an explicit envelope schema version. | `CODE` + `TEST` | PASS | Envelope `schemaVersion = 1`. Model/prompt implementation metadata is not hashed. |
| PT-22 | Historical `AiAnalysis` rows with `inputFingerprint = NULL` remain readable using existing `transcriptId` / `retranscribeCount` compatibility semantics. | `CODE` + `TEST` | PASS | `evaluateAiAnalysisCurrentness` legacy path. Lab I05. Untouched historical rows stay NULL. First facilitator material edit binds a still-legacy-current NULL row to the pre-mutation envelope hash. Historical session `cmsujlhtr008m1guancov0avf` accepted. |
| PT-23 | Any material AI-input change makes fingerprinted existing AI non-current. | `CODE` + `TEST` + `LAB` | PASS | Lab I01/N01. Presentation rewinds; historical row kept. Pre-deploy: facilitator material writes bind legacy-current NULL rows to the pre-mutation envelope hash so the same invalidation applies without overloading `retranscribeCount`. |
| PT-24 | After a material input change, facilitator current workflow presents AI as `NOT_STARTED` / needs rerun. Do not present old AI as the current completed stage with only a stale-info message. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | Materials projection + `analysisJson` hidden when not current. Manual Checkpoint D accepted. Historical and new local sessions accepted 2026-08-20. |
| PT-25 | If current AI has an active publication, facilitator-controlled material save warns the facilitator and revokes the active publication as part of the rewind. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | 409 `MATERIAL_CHANGE_CONFIRMATION_REQUIRED` then revoke via existing Unshare mechanism. Product UI is site `ConfirmDialog`. Checkpoint D headed Lab I03 originally used a native dialog; that Lab helper still waits for `page.waitForEvent("dialog")` and is a future Lab-replay residual, not a product-UX regression. Historical session MANUAL + RT12 cover the accepted ConfirmDialog path. |
| PT-26 | Old `AiAnalysis` artifacts may remain stored historically but are not current, publishable, or active current workflow output. | `CODE` + `TEST` | PASS | Lab I01 keeps the row; share returns 409. |
| PT-27 | Recipient access to a stale/current-fingerprint-mismatched published analysis fails closed. | `CODE` + `TEST` | PASS | Lab I04. Grant existence is not enough when fingerprint mismatches. |

| PT-28 | Notes handling is role/type-aware: negotiation-participant preparation notes are material and remain locked after negotiation; they stay visible (lock ≠ hide) under the post-meeting role matrix; facilitator and observer notes remain editable per existing permissions and do not invalidate AI or revoke publication. Future debrief feedback distribution is out of scope. | `CODE` + `TEST` + `LAB` + `MANUAL` | PASS | Lock helper + persist + `resolveDebriefVisibleNotes`. N05A–K. Manual Checkpoint D accepted. |
| PT-29 | `/transcribe-recording` is not treated as an automatic/silent fallback. Do not delete it in this stage. Prevent it from competing unsafely with canonical transcription. | `CODE` + `TEST` + `DOC` | PASS | `OLD_ROUTE_MODE=CANONICAL_ADAPTER`. Shared admit + generation CAS. Normal UI uses `/materials/transcribe`. F01–F08. Checkpoint F accepted. Phase G kept the endpoint. |
| PT-30 | Where safely possible, the old transcription route converges on canonical transcription admission/orchestration while preserving required compatibility response semantics. | `CODE` + `TEST` + `DOC` | PASS | Adapter: admit → `executeClaimedTranscription` → `{ transcript, warnings, recording }`. Envelope preserved (F07). Deprecation deferred. Not a failover. |
| PT-31 | Active real speaker-mapping fallback remains remote telemetry → local mic telemetry → facilitator review/manual attribution. | `CODE` + `TEST` | PASS | Automatic assignment may fail safely. Not the old `/transcribe-recording` route. Phase G did not change thresholds, 2x2 override, or solvers. AM01 AM02 AM03 AM04 AM04B AM07A–E AM11 AM12 AM13 PASS. |
| PT-32 | Do not remove active/historical speaker-mapping solvers, statuses, or compatibility logic without proof that they are safe cleanup. | `CODE` + `DOC` | PASS | Phase G: solvers DEFERRED. Unused `hasWeakMargins` DEFERRED (inline live check differs). Orphan `SpeakerMappingPanel` REMOVED (no callers). AM11/AM12/AM13 stayed green. |
| PT-33 | UI refinement is performed interactively through the Facilitator Lab in this same Cursor conversation. | `LAB` + `MANUAL` | PASS | Room Debrief uses `roomQuick`; Materials stays `materialsDetail`. Manual Checkpoint E accepted. Phase G did not change visible transcription/mapping UI. |
| PT-34 | Every implementation phase has cheap targeted smoke plus a deterministic manual checkpoint before broad validation. | `TEST` + `MANUAL` | PASS | MANUAL_CHECKPOINT_A/B/C/D/E/F/G/H = ACCEPTED. |
| PT-35 | Final Stage 3.15A acceptance validates the finished implementation against every PT-01..PT-35 requirement with explicit evidence. | `TEST` + `LAB` + `MANUAL` + `DOC` | PASS | Operator accepted Checkpoint H on 2026-08-20. Evidence: `docs/handoffs/stage-3-15a-final-validation.md`. Pre-deploy local real-session gate PASS: historical `cmsujlhtr008m1guancov0avf`, new `cmt1by854000kmoua8uulfcmi`. |

## Local operator acceptance incident (2026-08-20)

Checkpoint H remains accepted. This is not PT-36.

Local operator acceptance against real local sessions failed because the
Stage 3.15A client selected nullable `AiAnalysis.inputFingerprint` while the
local database had not yet received the additive migration. `materials/status`
500ed for every local session. Recording details still loaded from a separate
API, so the UI looked like “recording exists, post-processing is waiting for
recording.”

Mapped requirements:

- PT-17 — canonical `materials/status` projection must be readable
- PT-22 — historical NULL fingerprints are valid only after the column exists
- PT-24 — currentness/presentation cannot be served if status 500s
- PT-35 — local real-session gate is separate from Checkpoint H

Fix applied locally: existing additive migration
`20260819120000_add_ai_analysis_input_fingerprint`. No historical backfill.
Production migration is not applied.

```
CHECKPOINT_H_ACCEPTED = YES
LOCAL_SESSION_1 = PASS — cmt1by854000kmoua8uulfcmi
LOCAL_SESSION_2 = PASS — cmsujlhtr008m1guancov0avf
HISTORICAL_SESSION_ACCEPTANCE = PASS
NEW_SESSION_ACCEPTANCE = PASS
PRE_DEPLOY_LOCAL_ACCEPTANCE = PASS
STAGE_3_15A_READY_FOR_COMMIT = YES
STAGE_3_15A_READY_FOR_DEPLOY = YES
```

## Local operator acceptance incident 2 (2026-08-20) — historical NULL currentness

Not PT-36. Checkpoint H remains accepted.

A historical local session (`cmsujlhtr008m1guancov0avf`) had
`AiAnalysis.inputFingerprint = NULL`. Facilitator transcript save went through
`applyFacilitatorMaterialInputChange` and revoked the active publication, but
legacy currentness still used `transcriptId` + `retranscribeCount`. Those
values did not change, so the old analysis stayed `legacy_current` and the
facilitator workflow still presented it as the current completed result
(`canShare` remained true).

Mapped requirements: PT-22, PT-23, PT-24, PT-25, PT-26, PT-27, PT-35.

Fix: bind a still-legacy-current NULL row to the pre-mutation envelope hash at
the facilitator material-write boundary. No new schema field. No bulk
historical backfill. `retranscribeCount` stays ASR-generation identity.

The already-edited local session cannot reconstruct the pre-edit envelope.
Targeted local repair writes a non-matching fingerprint so the row is
historical-only until the operator reruns AI. Production is not modified.

Residual (not this incident’s transcript-save blocker): participant
preparation notes are locked after `FINISHED`, so they cannot mutate this
session through the UI. Transcript enhancement still does not bind
legacy-current NULL fingerprints; treating any envelope hash as stale for
NULL rows would rewind every untouched historical analysis and break PT-22.
Do not close that as part of this repair unless the operator expands scope.

## Local operator acceptance incident 3 (2026-08-20) — retranscription downstream invalidation UX

Not PT-36. Checkpoint H remains accepted. Historical-session operator recheck
of `cmsujlhtr008m1guancov0avf` is PASS. New-session operator recheck of
`cmt1by854000kmoua8uulfcmi` is PASS. `PRE_DEPLOY_LOCAL_ACCEPTANCE` is PASS.

Confirmed retranscription now invalidates downstream once: new transcript
generation, old AI non-current, active publication revoked in the claim
transaction. Pre-new-AI mapping/attribution/transcript saves do not warn.
A later material edit after a new current AI uses the site `ConfirmDialog`.

Operator close (2026-08-20):

```
HISTORICAL_SESSION_ACCEPTANCE = PASS
HISTORICAL_RESTART_FLOW = PASS
LEGACY_TO_CURRENT_SEMANTICS = PASS
RETRANSCRIPTION_ONE_TIME_INVALIDATION = PASS
POST_NEW_AI_INVALIDATION = PASS
NEW_SESSION_ACCEPTANCE = PASS
PRE_DEPLOY_LOCAL_ACCEPTANCE = PASS
```

Mapped requirements: PT-14, PT-15, PT-17, PT-22, PT-23, PT-24, PT-25, PT-26,
PT-27, PT-35.

## Local operator acceptance incident 4 (2026-08-20) — enhancement live split-brain

Not PT-36. New session `cmt1by854000kmoua8uulfcmi` showed a completed rail
while the expanded transcript section stayed RUNNING. All mounted consumers
must converge from RUNNING to terminal state. Operator recheck PASS.

## Final product enhancement contract

`TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` default = 7000. Enhancement is a short
preferred quality-improvement window. Success within 7 seconds applies the
improved transcript. Failure or timeout leaves the current usable transcript,
becomes non-authoritative terminal, unlocks transcript/mapping, and no longer
blocks AI. Late enhancement cannot overwrite transcript/mapping/AI input. No
additional "continue now" user-decision workflow.

## Future Engineering Workflow observations

These are future methodology improvements, not Stage 3.15A product
requirements. Do not implement them in this stage.

- historical transition testing;
- migration old/new code × old/new schema matrix;
- state vs transition fixtures;
- live mounted UI polling transitions;
- interaction surface coverage;
- native-browser-dialog guard;
- asynchronous AI UX latency budgets;
- pre-deploy historical + new-session acceptance;
- defect discovery layer metric.

