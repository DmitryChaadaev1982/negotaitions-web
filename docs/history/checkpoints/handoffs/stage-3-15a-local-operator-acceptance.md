# Stage 3.15A — pre-deploy local operator acceptance

Date opened: 2026-08-20  
Date closed: 2026-08-20  
Purpose: integrated product check through the **normal user UI** on the current
local worktree before any commit, push, merge, or production deploy.

This is an **operator deployment gate**, not a new requirement ID. Do not create
PT-36. Do not substitute Facilitator Lab fixtures. Do not call production.

Authoritative PT close: Checkpoint H accepted; PT-01..PT-35 = PASS.
See [`stage-3-15a-final-validation.md`](./stage-3-15a-final-validation.md).

```
CHECKPOINT_H_ACCEPTED = YES
MANUAL_CHECKPOINT_H = ACCEPTED
PT_01_35_ALL_ACCOUNTED = YES
PT_PASS_COUNT = 35
PT_DECISION_REQUIRED_COUNT = 0
PT_DEFERRED_BY_OPERATOR_COUNT = 0
PHASE_H_IMPLEMENTATION_COMPLETE = YES
AUTOMATED_STAGE_3_15A_VALIDATION = PASS
HISTORICAL_SESSION_ACCEPTANCE = PASS
HISTORICAL_RESTART_FLOW = PASS
LEGACY_TO_CURRENT_SEMANTICS = PASS
RETRANSCRIPTION_ONE_TIME_INVALIDATION = PASS
POST_NEW_AI_INVALIDATION = PASS
LOCAL_SESSION_2 = PASS — cmsujlhtr008m1guancov0avf
NEW_SESSION_ACCEPTANCE = PASS
LOCAL_SESSION_1 = PASS — cmt1by854000kmoua8uulfcmi
PRE_DEPLOY_LOCAL_ACCEPTANCE = PASS
STAGE_3_15A_READY_FOR_COMMIT = YES
STAGE_3_15A_READY_FOR_DEPLOY = YES
COMMIT_CREATED = YES
PUSH_PERFORMED = NO
DEPLOY_PERFORMED = NO
```

Environment: current local application / worktree
`C:\Projects\Negotiations AI\negotiations-web-stage-3-15a-post-processing`,
branch `feat/stage-3-15a-post-processing-workflow`.

---

## Session log

| SESSION | SESSION_ID | DATE | PURPOSE | RESULT | OBSERVATIONS |
| --- | --- | --- | --- | --- | --- |
| LOCAL_SESSION_1 | cmt1by854000kmoua8uulfcmi | 2026-08-20 | New-session / normal happy path | PASS | Operator accepted 2026-08-20. Recording/transcription completed; enhancement completed; live enhancement status converged; transcript/mapping unlocked; speaker mapping worked; AI analysis and publication worked; post-publication transcript edit, warning/revoke, and AI rewind worked. |
| LOCAL_SESSION_2 | cmsujlhtr008m1guancov0avf | 2026-08-20 | Historical session + retranscription restart | PASS | Operator accepted 2026-08-20. Session operable after schema alignment. Retranscription requires a new AI run, invalidates downstream once, revokes active publication, no redundant older-transcript warning, pre-new-AI mapping/transcript prep does not false-warn, new AI can be generated and published, post-new-AI material edit uses site ConfirmDialog and revokes/rewinds correctly. No native browser confirm. |

---

## LOCAL_SESSION_1 — new-session acceptance (PASS)

Recheck session: `cmt1by854000kmoua8uulfcmi`

Operator close (2026-08-20):

- normal new-session happy path completed;
- recording/transcription completed;
- enhancement workflow completed;
- live enhancement status convergence is correct;
- transcript/mapping unlock correctly;
- speaker mapping works;
- AI analysis works;
- publication works;
- material transcript edit after publication works;
- warning/revoke/AI rewind works.

| # | Acceptance item | Result | Observations |
| --- | --- | --- | --- |
| 1 | Participants enter normally | PASS | Operator new-session happy path. |
| 2 | Negotiation runs and finishes normally | PASS | |
| 3 | Recording/transcription lifecycle progresses without contradictory statuses | PASS | |
| 4 | Transcript appears and is usable | PASS | |
| 5 | Transcript enhancement completes or reaches an accepted terminal state | PASS | Live status converged; no continue-now decision workflow. |
| 6 | Automatic speaker mapping behaves plausibly | PASS | |
| 7 | If mapping is structurally complete AUTO_SUGGESTED, it is advisory rather than blocking | PASS | |
| 8 | Start AI is available when readiness is genuinely satisfied | PASS | Enhancement no longer blocked the path. |
| 9 | Successful Start AI confirms the mapping automatically | PASS | |
| 10 | No residual “please confirm speaker mapping” request remains afterward | PASS | |
| 11 | AI analysis completes and renders normally | PASS | |
| 12 | Participant preparation notes are available post-meeting according to the approved role matrix | PASS | Covered by the accepted happy path. |
| 13 | Facilitator notes remain editable and do not invalidate AI | PASS | Covered by the accepted happy path. |
| 14 | Publication to participants works normally | PASS | |
| 15 | Participant recipient view receives the current published AI result | PASS | Covered by publication + later revoke/rewind. |
| 16 | roomQuick UI does not show recording-status detail or language selector | PASS | Unchanged accepted Checkpoint E/H contract. |
| 17 | Materials detailed UI still shows recording status and language selector | PASS | Unchanged accepted Checkpoint E/H contract. |
| 18 | No unexpected errors or contradictory states | PASS | Live enhancement polling no longer split-brain. |

---

## LOCAL_SESSION_2 — historical session + material change after published AI (PASS)

Operator close (2026-08-20) for `cmsujlhtr008m1guancov0avf`:

- historical session remained operational after additive schema alignment;
- historical retranscription path works;
- retranscription invalidates downstream once;
- publication revoke works;
- no redundant old-analysis workflow warning;
- mapping/transcript preparation before new AI does not show false invalidation warning;
- new AI can be generated/published;
- subsequent material edit uses the site ConfirmDialog;
- revoke + AI rewind work;
- no native browser confirmation remains.

| # | Acceptance item | Result | Observations |
| --- | --- | --- | --- |
| 1 | Warning is shown before destructive downstream consequences | PASS | After the new current AI, material edit uses the site ConfirmDialog. Retranscription copy says a new AI run is required. |
| 2 | Warning communicates that current AI becomes invalid, AI must be rerun, and current publication will be revoked | PASS | Retranscription boundary revokes active publication. Post-new-AI warning is site-styled and currentness-aware. |
| 3 | After confirmation/save: material edit persists; publication revoked; old AI not presented as current; UI requires AI rerun | PASS | Confirmed material edit after the new AI revokes publication and rewinds AI. Retranscription invalidates downstream once. |
| 4 | Previous AiAnalysis may remain historical but is not active/current | PASS | Historical artifact retained. Active workflow does not treat it as current. |
| 5 | Participant cannot continue accessing the stale publication | PASS | Active publication revoked at the retranscription boundary and again after confirmed post-new-AI material edit. |
| 6 | Rerun AI succeeds using the modified material | PASS | Operator generated a new AI analysis after the restart. |
| 7 | New result becomes current | PASS | |
| 8 | Republishing the new result works normally | PASS | |
| 9 | Optional: facilitator note change leaves AI current and publication active | PENDING | Not required for historical-session close. |

---

## Post-H remediations exercised by this gate

These are not PT-36. Checkpoint H remains accepted.

1. Local DBs must already have
   `20260819120000_add_ai_analysis_input_fingerprint` before the new client
   reads `materials/status`.
2. Historical NULL-fingerprint first material edit binds a still-legacy-current
   row to the pre-mutation envelope hash. No bulk backfill.
3. Confirmed retranscription is one downstream invalidation boundary.
4. Post-publication material edit uses application `ConfirmDialog`, not
   `window.confirm`.
5. Enhancement has a 7000 ms preferred quality window. Timeout/failure leaves
   the current usable transcript, becomes non-authoritative terminal, and
   unlocks transcript/mapping/AI. Late enhancement cannot overwrite.
6. All mounted consumers converge live from RUNNING to terminal enhancement
   state.

```
HISTORICAL_SESSION_ACCEPTANCE = PASS
NEW_SESSION_ACCEPTANCE = PASS
PRE_DEPLOY_LOCAL_ACCEPTANCE = PASS
STAGE_3_15A_READY_FOR_COMMIT = YES
STAGE_3_15A_READY_FOR_DEPLOY = YES
```

---

## Historical incident record (kept for packaging evidence)

### Incident 1 — missing local column

Local operator acceptance first failed because the Stage 3.15A client selected
nullable `AiAnalysis.inputFingerprint` while the local database had not yet
received the additive migration. `materials/status` 500ed. Recording details
still loaded from a separate API.

Fix: apply existing
`20260819120000_add_ai_analysis_input_fingerprint`. No historical backfill.

### Incident 2 — historical NULL currentness

Historical session `cmsujlhtr008m1guancov0avf` had `inputFingerprint = NULL`.
Facilitator transcript save revoked publication, but legacy currentness still
used `transcriptId` + `retranscribeCount`, so the old analysis stayed
`legacy_current`.

Fix: bind a still-legacy-current NULL row to the pre-mutation envelope hash at
the facilitator material-write boundary. No new schema field. No bulk
historical backfill.

### Incident 3 — retranscription downstream invalidation UX

Confirmed retranscription now invalidates downstream once. Pre-new-AI
mapping/attribution/transcript saves do not warn. A later material edit after
a new current AI uses the site `ConfirmDialog`.

### Incident 4 — enhancement terminal split-brain

On `cmt1by854000kmoua8uulfcmi` the five-stage rail showed enhancement
completed while the expanded Recording & Transcription section kept a running
banner and locked controls.

ROOT_CAUSE_CLASS = POLLING_STATE with MULTIPLE_DERIVATIONS as the architectural
gap. All mounted consumers now converge from RUNNING to terminal state.

Future Engineering Workflow note (do not build the methodology now):

```
DEFECT CLASS: LIVE STATE TRANSITION / INTERACTION COVERAGE GAP
```
