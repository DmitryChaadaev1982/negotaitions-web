# Stage 3.17A Authoritative Requirement Manifest

## Authority and use

This is the authoritative, implementation-independent requirement/change-plan
manifest for Stage 3.17A — AI Analysis Schema Reliability & Recovery.

This file is the first product-stage pilot of the Stage 3.16A engineering
workflow (`docs/testing/engineering-workflow.md`). Approved decisions in this
manifest are the product-planning authority for this stage. Current
architecture, privacy, access, database, and operations documents remain the
domain/safety authorities. Historical stage reports cannot add, weaken, or
replace a requirement.

Do not silently weaken an `APPROVED` requirement. If implementation proves an
`APPROVED` requirement impossible or unsafe, set `DECISION_REQUIRED` and stop
for operator decision.

Status values used in this stage:

- `APPROVED` — accepted stage scope
- `PROPOSED` — not yet accepted
- `OUT_OF_SCOPE` — forbidden or explicitly excluded
- `DECISION_REQUIRED` — operator judgment required before implementation
- `PASS` — finished review with evidence (operator-accepted or locally evidenced
  forensic/planning fact)
- `DEFERRED` — later checkpoint; still expected unless superseded

Checkpoint authorization is separate from status. A later Change Unit may be
`APPROVED` stage scope and still `NOT_AUTHORIZED` for the current Cursor run.

Evidence types used here:

| Type | Meaning |
| --- | --- |
| `DOC` | Current-state architecture / this manifest |
| `CODE` | Repository source inspection |
| `TEST` | Existing deterministic test evidence (source or executed) |
| `MANUAL` | Operator checkpoint in this conversation |
| `PROD_RO` | Read-only production DB/journal evidence (not authorized in Checkpoint 0) |

## Stage identity

```
STAGE_ID = 3.17A
STAGE_NAME = AI Analysis Schema Reliability & Recovery
STAGE_KIND = product / reliability / provider-contract
PRODUCT_BEHAVIOR_CHANGE = NOT_IN_CHECKPOINT_1
DIAGNOSTICS_CHANGE = BOUNDED_JOURNAL_FIELDS_ONLY
WORKFLOW_PILOT = Stage 3.16A first real product CIA/CU/eval pilot
```

## Objective

AI analysis must fail and recover in a controlled, diagnosable way when the
provider produces output that does not satisfy the canonical analysis result
contract.

Checkpoint 0 determines the actual failure boundary before any recovery
mechanism is chosen.

## Problem statement

Known production observation on session `cmt1l5d3p000irsm1ekwg3oh3`:

- very short completed negotiation/session;
- transcript was available;
- first AI-analysis run failed because the returned result did not satisfy
  the expected result format / structure;
- the operator reran AI analysis on the same transcript;
- the second run completed successfully.

Do **not** infer from this alone that retry is the fix. The two runs establish
only that the same material input can produce an invalid structured result and
later a valid structured result.

Current preference: the strict canonical persisted analysis contract remains
strict unless forensic evidence proves the contract itself is wrong. Do not
solve provider variability by persisting malformed analysis.

## Known incident facts vs hypotheses

### FACTS

| ID | Fact | Evidence |
| --- | --- | --- |
| F-01 | Operator reported session `cmt1l5d3p000irsm1ekwg3oh3`. | Operator packet |
| F-02 | Session was very short and completed; transcript was available. | Operator packet |
| F-03 | First run failed as `MODEL_SCHEMA_VALIDATION_ERROR` at `listeningAndReframing.missedOpportunities.0`. | `PROD_RO` ExternalServiceEvent |
| F-04 | Operator reran on the same transcript; second run succeeded. | Operator packet |
| F-05 | Start, retry, and rerun are the same `POST /api/sessions/[sessionId]/analyze`. | `CODE` `app/api/sessions/[sessionId]/analyze/route.ts` |
| F-06 | Production automatic retry count is clamped to 1 (`AI_ANALYSIS_MAX_ATTEMPTS` min=max=1). Compact-fallback and optional-depth calls are hardcoded to 0. | `CODE` `getAiAnalysisMaxAttempts`, `getAiAnalysisPerformanceModel` |
| F-07 | `MODEL_INVALID_OUTPUT` and `MODEL_SCHEMA_VALIDATION_ERROR` exhaust the recorded generation (`canRecoverProviderResponseAfterFailure` = false). An explicit retry creates a **new** provider generation. | `CODE` + `TEST` `lib/ai/negotiation-analysis.test.ts` |
| F-08 | Failed runs persist `AiAnalysis.status=FAILED` and a generic Russian `errorMessage`. They do **not** persist raw provider output, extracted JSON, Zod issue messages, error class, or attempt number. | `CODE` `failAiAnalysisRun` |
| F-09 | Best-effort `ExternalServiceEvent` may retain `rawError.errorClass`, `diagnostics`, and metrics. Yandex failures are stored as `ExternalService.APP`. Model/schema codes map to `ExternalServiceErrorCode.UNKNOWN`. `requestId` is not written. | `CODE` `observeFailure` in analyze route |
| F-10 | One mutable `AiAnalysis` row per session. A later success overwrites the failed row and clears `errorMessage`. First-run row state is therefore gone after run 2. | `CODE` Prisma `sessionId @unique`; `completeAiAnalysisRunWithCurrentParticipants` |
| F-11 | Write schema `NegotiationAnalysisOutputSchema` requires the full structural object. Arrays may be empty. Extra keys are stripped, not rejected (schema is not `.strict()`). Depth/count heuristics in `getAnalysisDepthIssues` never block persist (`maxOptionalDepthCalls = 0`). | `CODE` |
| F-12 | Prompt tells the model to emit complete structured analysis and quality-count targets, and to use empty arrays when uncertain. It does not say “never omit required keys.” | `CODE` `SYSTEM_PROMPT`, `YANDEX_COACHING_REQUIREMENTS`, `buildAnalysisPrompt` |
| F-13 | `FAILED` cannot be published. `canShare` and the share route require `COMPLETED` plus currentness. | `CODE` materials/status + share route |
| F-14 | Production first-run raw provider body is not reconstructable from the current `AiAnalysis` row. | `CODE` F-08 + F-10 |
| F-15 | Successful current run: `COMPLETED`, `analysisVersion=1`, provider Yandex / `deepseek-v4-flash`, `language=ru-RU`, `overallScore=35`, `inputFingerprint=7dbc638f4dd728f29f031c857bef2e5b279dd1ff85e005e0515096902e05a10d`, successful `responseLength=11115`. | `PROD_RO` |
| F-16 | Incident transcript richness: `textChars=216`, `diarizedChars=606`, `segmentCount=10`, participants=2, facilitator=1. No publication rows. | `PROD_RO` |
| F-17 | First failed run journal: title `AI analysis failed: MODEL_SCHEMA_VALIDATION_ERROR`, `errorClass=MODEL_SCHEMA_VALIDATION_ERROR`, provider yandex, model `deepseek-v4-flash`, `retryable=false`, `issueCount=1`, `issuePaths=["listeningAndReframing.missedOpportunities.0"]`. No `outputCondition` / provider lifecycle error. | `PROD_RO` |
| F-18 | Canonical write contract for `listeningAndReframing.missedOpportunities` is `z.array(z.string())` with no min length, coercion, or refine. Path `.0` is a first-element type failure. | `CODE` + `TEST` |

### HYPOTHESES (not proven)

| ID | Hypothesis | Why it remains a hypothesis |
| --- | --- | --- |
| H-01 | First-element value at `missedOpportunities.0` was a non-string, most plausibly an object analogized from `questionsAnalysis.missedQuestions`. | Production journal has the path, not the raw value. Zod `.0` on `string[]` is a first-element type failure. |
| H-03 | Short-session sparsity made the model more likely to emit the plausible wrong representation. | Consistent with coaching "phrase + why" plus neighbouring object arrays; not proven as historical causation. |
| H-04 | Model nondeterminism alone can produce valid output on a later same-prompt generation. | Operator rerun succeeded; synthetic characterization is a small sample, not a reliability benchmark. |

### DISPROVEN FOR THIS INCIDENT

| ID | Former hypothesis | Why disproven |
| --- | --- | --- |
| H-02 | First failure was `MODEL_INVALID_OUTPUT` / JSON_PARSE. | Production journal class is `MODEL_SCHEMA_VALIDATION_ERROR`; parse succeeded far enough to validate a named path. |
| H-05 | Transport/truncation / provider lifecycle caused run 1. | No `outputCondition`, incomplete reason, or lifecycle error was recorded. |

### UNSUPPORTED ASSUMPTIONS REMOVED

- Retry is the fix.
- The write schema is too strict for short sessions (arrays may already be empty).
- Permissive JSON parsing is required (Yandex already strips fences, trailing commas, and extracts the first balanced object).
- The first failed provider body can be reconstructed from the current `AiAnalysis` row.
- Automatic in-process retry already exists in production.
- Extra unexpected keys fail the write schema (they are stripped).
- Missing personal-feedback coverage of the roster fails the write (bind drops unknown IDs; empty PPF array is schema-valid).
- Live provider calls are needed to classify the application boundary.
- The first failed provider body can be inferred from the successful second-run body.

## Explicit assumptions vs remaining unknowns

Assumptions used for planning:

- Production provider is Yandex (`AI_ANALYSIS_PROVIDER=yandex`) per current
  architecture. OpenAI remains an explicit alternate path.
- The operator rerun used the existing UI retry/start control, not a new
  recovery mechanism.
- Materials were not edited between the two runs (operator: same transcript).

Unknowns that still constrain recovery design:

- Exact first-run element value/type at `missedOpportunities.0` (raw body not
  persisted).
- Whether the production failure was caused by prompt ambiguity, provider
  nondeterminism, or both.

Resolved for Checkpoint 2 direction only (not implemented):

- A bounded same-prompt extra generation is the approved recovery direction
  for `MODEL_SCHEMA_VALIDATION_ERROR`. See Approved recovery direction.

## Explicit non-scope (this stage unless later authorized)

| ID | Requirement | Status |
| --- | --- | --- |
| S317A-NS-001 | No generic automatic retry in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-002 | No JSON repair implementation in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-003 | No provider prompt rewrite in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-004 | No canonical write-schema relaxation in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-005 | No provider-model change. | `OUT_OF_SCOPE` |
| S317A-NS-006 | No DB migration in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-007 | No new production logging implementation in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-008 | No UI retry redesign in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-009 | No historical data rewrite. | `OUT_OF_SCOPE` |
| S317A-NS-010 | No production replay, live-provider experiment, SSH/DB/journal access, commit, push, or deploy in Checkpoint 0. | `OUT_OF_SCOPE` |
| S317A-NS-011 | Do not persist malformed provider output as current valid analysis. | `APPROVED` invariant |

## Pipeline (current)

```
INPUT (transcript, mapping, PARTICIPANT notes, fingerprint)
  → PROMPT (SYSTEM_PROMPT + language + Yandex coaching/schema or OpenAI schema text)
  → PROVIDER (Yandex background POST/GET or OpenAI chat)
  → RAW RESPONSE (completed envelope / message content only)
  → EXTRACTION (Yandex: fence strip, first balanced object, trailing commas;
                OpenAI: raw JSON.parse only)
  → JSON PARSE
  → SCHEMA (NegotiationAnalysisOutputSchema.safeParse)
  → SEMANTIC CONTRACT (bindParticipantPersonalFeedback; depth issues advisory)
  → PERSISTENCE (COMPLETED + analysisJson / rawModelOutput, or FAILED + errorMessage)
  → UI (failed copy + canRetry; share only if COMPLETED + current)
```

Exact files/functions:

| Stage | File | Function / symbol |
| --- | --- | --- |
| Trigger / rerun | `app/api/sessions/[sessionId]/analyze/route.ts` | `POST` |
| UI start/retry/rerun | `components/session-post-processing-panel.tsx` | `handleRunAiAnalysis` / `handleRunAiAnalysisConfirmed` |
| UI start/retry | `components/session-materials-dashboard.tsx` | `handleRunAiAnalysis` |
| Admission | `lib/ai/analysis-readiness.ts` | `evaluateAiAnalysisReadiness` |
| Input | `lib/ai/session-analysis-context.ts` | `buildSessionAnalysisContext` |
| Fingerprint | `lib/ai/material-input-envelope.ts` | `buildMaterialInputEnvelope` / `fingerprintSessionAnalysisContext` |
| Currentness | `lib/ai/analysis-currentness.ts` | `evaluateAiAnalysisCurrentness` |
| Claim | `lib/ai/analysis-operation.ts` | `claimAiAnalysisRun` |
| Prompt | `lib/ai/session-analysis-prompt.ts` | `buildAnalysisPrompt` / `packAnalysisPrompt` |
| System/schema text | `lib/ai/negotiation-analysis.ts` | `SYSTEM_PROMPT`, `YANDEX_*`, `runNegotiationAnalysis` |
| Provider | same | `runYandexNegotiationAnalysis` / `runOpenAiNegotiationAnalysis` |
| Extract/parse | same | `extractYandexOutputText`, `stripMarkdownJsonFences`, `tryParseJsonWithRecovery` |
| Schema | same | `NegotiationAnalysisOutputSchema`, `validateOutput` |
| Bind | same | `bindParticipantPersonalFeedback` |
| Fail/complete | `lib/ai/analysis-operation.ts` | `failAiAnalysisRun`, `completeAiAnalysisRunWithCurrentParticipants` |
| Orchestration | `lib/ai/analysis-orchestration.ts` | `executeOwnedAnalysis` |
| Journal | `lib/services/external-service-events.ts` | `logExternalServiceEvent` |
| Publish gate | `app/api/sessions/[sessionId]/ai-analysis/share/route.ts` | share requires `COMPLETED` |

## Failure-boundary table

| Failure class | Exact code boundary | Current handling | Retryability hypothesis | Evidence quality |
| --- | --- | --- | --- | --- |
| PROVIDER_FAILURE (5xx/429/HTTP) | Yandex `fetch` / lifecycle | `PROVIDER_HTTP_ERROR` / `PROVIDER_RATE_LIMIT`; generation exhausted | YES for 429/5xx at transport; explicit operator retry creates new generation | `CODE`/`TEST` |
| PROVIDER_LIFECYCLE (`failed`/`cancelled`/`incomplete`) | `classifyYandexResponseLifecycle` | `PROVIDER_LIFECYCLE_ERROR`; ID cleared | CONDITIONAL — new generation may succeed; same ID must not be replayed | `CODE`/`TEST` (`incomplete` + `max_output_tokens`) |
| TRANSPORT / timeout | poll/operation deadline, HTTP timeout | `NETWORK_TIMEOUT` / `NETWORK_ERROR`; ID **kept** | YES — retrieve same generation if still running; do not POST a duplicate | `CODE`/`TEST` |
| TRUNCATION (JSON) | `looksPossiblyTruncatedJson` after completed text | `MODEL_INVALID_OUTPUT`; ID cleared | CONDITIONAL — new generation may finish; raising tokens/prompt is a later decision | `CODE`/`TEST` truncated `'{"executiveSummary":'` |
| JSON_EXTRACTION | Yandex fence/balanced-object/comma recovery; OpenAI none | Remaining failure → `MODEL_INVALID_OUTPUT` | CONDITIONAL same-prompt; more extraction is not justified without evidence | `CODE` |
| JSON_PARSE | `tryParseJsonWithRecovery` / OpenAI `JSON.parse` | `MODEL_INVALID_OUTPUT` | CONDITIONAL (nondeterminism) | `CODE`/`TEST` |
| SCHEMA_VALIDATION | `NegotiationAnalysisOutputSchema.safeParse` | `MODEL_SCHEMA_VALIDATION_ERROR`; Yandex logs `issueCount`+`issuePaths` (5 paths); OpenAI logs 3 `path: message` | CONDITIONAL same-prompt; repair prompt later; **do not loosen schema** | `CODE`/`TEST` undersized object |
| SEMANTIC_VALIDATION | `bindParticipantPersonalFeedback` | Drops unknown IDs; does **not** fail the write | NO as a retry class — not a write failure | `CODE` |
| PROMPT_CONTRACT | prompt quality targets vs empty-array permission | Advisory `getAnalysisDepthIssues` only | N/A until production class is known | `CODE` |
| MODEL_NONDETERMINISM | new generation on exhausted MODEL_* | Application already treats exhausted generation as non-recoverable | CONDITIONAL — explains the incident shape; not a license for unbounded retry | `CODE` + incident F-03/F-04 |
| PERSISTENCE / CURRENTNESS | one-row overwrite; fingerprint; `analysisVersion++` on claim | Success overwrites; fail leaves prior `analysisJson` | N/A for first-run class; **HIGH** for any later recovery | `CODE` |
| APPLICATION_READER | `parseCanonicalAnalysisOutput` / published viewer parser | Historical read is looser than write | Unlikely for this incident (write failed before persist) | `CODE` |
| CONTENT_DEPENDENT_OUTPUT | short/sparse transcript | Schema allows empty arrays; prompt still asks for complete analysis | CONDITIONAL contributor, not a separate retry class | `CODE`; production richness unknown |
| INPUT_TOO_LARGE | budget packer | Fail before POST | NO | `CODE`/`TEST` |
| CONFIG / OWNERSHIP | env / lease | Fail closed; ownership not terminalized as user-retryable success | NO automatic product retry | `CODE` |

Incident-relevant surviving classes after production forensics:

`SCHEMA_VALIDATION` (proven class/path) | `PROMPT_AMBIGUITY` (static contributor) | `MODEL_NONDETERMINISM` (mechanism that made run 2 able to succeed)

Disproven for this incident: `JSON_PARSE` / `MODEL_INVALID_OUTPUT`, `TRUNCATION`, `PROVIDER_LIFECYCLE`.

## First vs second run forensics

```
FIRST_FAILED_RUN_FORENSICALLY_RECONSTRUCTABLE = PARTIAL
SECOND_SUCCESSFUL_RUN_COMPARABLE_TO_FIRST = PARTIAL
```

| Artifact | Failed run retained? | After successful rerun? |
| --- | --- | --- |
| Provider request/run ID | PARTIAL — kept only if recoverable; cleared for MODEL_* | Success always nulls `providerResponseId` |
| Provider model | PARTIAL — not written on fail; may appear in journal `rawError.model` | YES on `AiAnalysis.model` |
| Raw provider response | NO on fail | YES in `rawModelOutput.providerEnvelope` (success only) |
| Extracted JSON candidate | NO | NO (success stores parsed envelope, not a fail candidate) |
| Parse error | PARTIAL — generic `errorMessage`; journal `errorClass` + `outputCondition` | Cleared on success |
| Schema/Zod issues | PARTIAL — journal only; Yandex paths without messages | Cleared |
| Finish / truncation metadata | PARTIAL — journal `providerStatus` / `incompleteReason` / `outputCondition` | Success diagnostics in `rawModelOutput.diagnostics` |
| Duration | PARTIAL — `startedAt`/`completedAt` overwritten; journal metrics | YES for success |
| Input fingerprint | YES — set before `after()`; fail does not clear | YES (same row) |
| Retry relation / attempt # | NO durable parent/attempt | `analysisVersion` increments on claim only |
| Error category | PARTIAL — not a Prisma column; journal title `AI analysis failed: ${code}` | Cleared from row |

Lost after run 2 unless journal/events exist: first-run `errorMessage`, first-run
timestamps, first-run raw body, first-run Zod detail, first-run provider ID
(if MODEL_*).

## Short-session analysis

| Question | Result |
| --- | --- |
| Does schema require multiple participants? | No |
| Does schema require non-empty tactics/strengths/quotes? | No — arrays may be `[]` |
| Does schema require PPF for every participant? | No — empty array is valid; bind drops unknown IDs |
| Does schema require summary/detail minimums? | No — `getAnalysisDepthIssues` is advisory and unused as a gate |
| Does prompt assume richness? | Yes — 2–4 strengths, 3–5 improvements, 4–7-sentence summary, 4–6 debrief questions, “complete structured analysis” even when short |
| Does prompt say empty arrays are allowed? | Yes, when uncertain |
| Does prompt say never omit required keys? | No |

```
SHORT_SESSION_VERDICT = VALID_CONTRACT + PROMPT_AMBIGUITY + PROVIDER_VARIABILITY
SCHEMA_GAP = NOT_EVIDENCED
ACTUAL_FIRST_FAILURE_CLASS = MODEL_SCHEMA_VALIDATION_ERROR
INCIDENT_ISSUE_PATH = listeningAndReframing.missedOpportunities.0
PROMPT_SCHEMA_RESULT = AMBIGUITY
```

A short session can legally persist a sparse but structurally complete report.
The write schema is not a SCHEMA_GAP. The Yandex coaching line asks for
"improved phrase and why it works" while the typed contract remains `string[]`.
Neighbouring `questionsAnalysis.missedQuestions` is an object array with the
same two-part semantics. That is prompt ambiguity, not a typed contradiction.
Do not infer the exact wrong production value; the failed raw body was not
persisted.

## Retry matrix (design only — not implemented)

| Class | Retryable? | Same prompt vs repair | Cost / latency | Safety note |
| --- | --- | --- | --- | --- |
| NETWORK_TIMEOUT / NETWORK_ERROR | YES | Same generation GET if ID kept; no new POST | Low if retrieve; high if new POST | Current recovery-first ID rule is correct |
| PROVIDER 429 / 5xx | YES | New generation after backoff | Medium | Bound attempts |
| PROVIDER_LIFECYCLE incomplete/max tokens | CONDITIONAL | New generation; repair/higher-token is a later decision | High | Do not replay exhausted ID |
| MODEL_EMPTY_OUTPUT | CONDITIONAL | New generation | High | `retryable:true` today but max attempts=1 so unused |
| MODEL_INVALID_OUTPUT | CONDITIONAL | Same prompt **once** may help (nondeterminism). Repair prompt only after class is proven (prose vs truncation) | One extra full generation | No blind loop |
| MODEL_SCHEMA_VALIDATION_ERROR | CONDITIONAL | Same prompt **once** may help. Targeted repair (missing keys) only after `issuePaths` exist | One extra full generation | Do not loosen schema to make this disappear |
| SCHEMA semantic / application bug | NO | Fix code | n/a | |
| INPUT_TOO_LARGE | NO | Fail closed | n/a | |
| CONFIG_MISSING | NO | Ops | n/a | |
| OWNERSHIP_LOST | NO | Other owner continues | n/a | |
| DB persist failure after valid parse | CONDITIONAL | Do not re-call provider if output is in hand | Low | Not the incident shape |

If a later checkpoint authorizes retry, the minimum policy is:

- eligible: only classified CONDITIONAL/YES classes above;
- max extra attempt: 1 (total 2 generations) unless operator raises it;
- attempt 2 default: same prompt until production class proves a repair prompt;
- user-visible: remain `ANALYZING` through the bounded extra attempt, then
  `FAILED` with classifiable error;
- currentness: claim/`analysisVersion`/runToken fence must refuse to overwrite
  a newer successful analysis;
- observability: persist error class + bounded diagnostics before retrying;
- no infinite retry.

## Compact CIA (Checkpoint 1)

```
CHANGE: classify proven MODEL_SCHEMA_VALIDATION_ERROR at
        listeningAndReframing.missedOpportunities.0; add bounded journal
        sanitizer + type-kind fields; add schema/twin/harness tests;
        characterize Yandex on synthetic fixtures only.
INVARIANTS: write schema stays strict; no production retry; no prompt
            rewrite; no raw/sensitive persist; no production fixtures;
            fence not weakened; ExternalServiceEvent remains the durable
            failure source.
IMPACT: server/domain diagnostics helper, analyze journal payload,
        tests/evals, research tooling, architecture/manifest docs
UNITS: CU-B, CU-C, characterization tooling, docs
KERNEL: none of CU-D/F this checkpoint
STRATEGY: B
VALIDATION_PLAN: L1 focused + L2 AI cluster; L3 validate:fast
                 required after production-code change; no L4
```

## Compact CIA (Checkpoint 1 source-review correction)

```
CHANGE: fail-closed positive allowlist for AI failure-diagnostics
        sanitizer; correct PARSE-MALFORMED-SHAPES invariant to match
        current bounded wrapper recovery vs irrecoverable malformed JSON.
INVARIANTS: no production recovery; same prompt; canonical schema
            unchanged; no Yandex/live call; no model change; unknown
            diagnostic keys dropped; free-form issues/prose dropped;
            wrapper noise is not MODEL_INVALID_OUTPUT solely because of
            fences/prose/trailing commas.
IMPACT: server/domain diagnostics helper, tests/evals, architecture/
        registry/manifest docs
UNITS: CU-B sanitizer correction; CU-C parser-eval wording/evidence
KERNEL: CU-B (journal persist)
STRATEGY: A — same CP1 contract-correction batch
VALIDATION_PLAN: L1 focused diagnostics + parser tests;
                 eval:registry:check; git diff --check;
                 L3 validate:fast after production-code change; no L4
RECOVERY_DIRECTION = DIRECTION_2_BOUNDED_SAME_PROMPT_RETRY
ELIGIBLE_CLASS = MODEL_SCHEMA_VALIDATION_ERROR
MAX_EXTRA_GENERATIONS = 1
CHECKPOINT_2 = NOT_AUTHORIZED
```

## Compact CIA (Checkpoint 0)

```
CHANGE: (planned, not implemented) diagnosable AI-analysis failure classification
        and a later selective recovery policy. Checkpoint 0 changes docs only.
INVARIANTS:
  - canonical persisted analysis remains schema-valid
  - malformed provider output never becomes current valid analysis
  - failed run never grants publication/access
  - recovery cannot overwrite newer successful analysis
  - input fingerprint/currentness remains correct
  - participant personal-feedback privacy remains intact
  - historical analysis compatibility remains intact (read ≠ write)
  - provider cost is bounded; no infinite retry
  - same input may legitimately produce different provider outputs
  - failures become diagnosable without persisting sensitive raw data
    unnecessarily
IMPACT MAP (future implementation; Checkpoint 0 = docs only):
  - server/domain: parser/classification/diagnostics
  - API: analyze fail payload / materials error class
  - client: operator-visible failure + retry semantics
  - AI currentness / material inputs: reclaim + fingerprint
  - provider integration: optional selective second generation
  - historical data: read compatibility if diagnostics/schema change
  - tests/evals: synthetic invalid→valid and invalid→invalid twins
  - DB/Prisma: only if durable diagnostic columns are later approved
  - publication/roles: must stay fail-closed on FAILED
UNITS: CU-A .. CU-H
KERNEL: CU-D + CU-F (+ CU-B if durable diagnostics persist provider-adjacent data)
EVAL: STATE parse/schema; TRANSITION invalid→valid and invalid→invalid;
      HISTORICAL_READ if persistence shape changes; PROVIDER_INTEGRATION mock
      twins, not live; INTERACTION for operator retry later
STRATEGY: B — diagnostics/eval foundation before recovery
VALIDATION_PLAN: Checkpoint 0 = L1 docs/forensic. Later CUs L1 each;
                 L2 on kernel; L3 at implementation checkpoint; L4 at final
                 code/config package. No live-provider default.
```

Async AI class: **MANDATORY GATE** for the analysis report (facilitator cannot
use the report until COMPLETED or FAILED-closed). It is not a live-room
blocker. Existing operation deadline (~600s) remains the UX latency budget
unless a later CU changes it. Race/correctness (lease, exhausted generation)
stay separate from that budget.

## Change Units

| ID | Change Unit | Risk | Coupling | Historical | Provider | Privacy/access | Validation separability | Checkpoint | Auth now | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CU-A | Failure-boundary / parser-schema forensic | LOW product / HIGH reasoning | Documents all later CUs | None | None | None | Separable (docs) | 0 | `AUTHORIZED` | `PASS` |
| CU-B | Failure classification + bounded diagnostic evidence | LOW-SENSITIVITY journal helper; no migration | Parser + journal | None | None | HIGH if raw body stored — not stored | Separable from retry | 1 | `AUTHORIZED` | `IMPLEMENTED` (ExternalServiceEvent sufficient; fail-closed positive allowlist sanitizer + type kinds) |
| CU-C | Synthetic malformed fixtures + invalid↔valid evals | MEDIUM | Shares taxonomy with CU-B | Synthetic only | Mock only | Must not copy production transcript | Separable once taxonomy frozen | 1 | `AUTHORIZED` | `IMPLEMENTED` (proposed recovery marked not production-enabled) |
| CU-D | Recovery policy / selective retry or repair | HIGH | Currentness, cost, provider | First mutation on FAILED rows | Extra generation | Must not publish fail | **Not** separable until CU-B/C + prod class | 2 | `NOT_AUTHORIZED` | `APPROVED` direction `DIRECTION_2`; impl `NOT_STARTED` |
| CU-E | UI/operator recovery semantics | MEDIUM | CU-B codes + CU-D policy | Copy/read | None | Facilitator-only error detail | After CU-B/D | 3 | `NOT_AUTHORIZED` | `PROPOSED` |
| CU-F | Persistence / currentness / concurrency safety | HIGH | CU-D | HISTORICAL_FIRST_MUTATION | Duplicate-generation risk | Publication fail-closed | With CU-D kernel | 2 | `NOT_AUTHORIZED` | `APPROVED` invariant / `PROPOSED` impl |
| CU-G | Historical compatibility | HIGH if write/read contract changes | Readers, publications | READ + first mutation | None | Viewer projections | After any persist/schema change | 2 or 4 | `NOT_AUTHORIZED` | `APPROVED` invariant |
| CU-H | Provider cost / latency bounds | MEDIUM | CU-D | None | Cost | None | With CU-D | 2–3 | `NOT_AUTHORIZED` | `PROPOSED` |

```
HIGH_RISK_KERNEL = CU-D + CU-F
HIGH_RISK_IF_RAW_DIAGNOSTICS = CU-B
```

Do not label the entire stage HIGH merely because AI is involved. CU-A is
forensic. CU-C is synthetic. CU-E/H are cheaper after the kernel.

## Change graph

```
CU-A (Checkpoint 0 PASS)
  → CU-B + CU-C  (Checkpoint 1 — classify + synthetic twins + characterization)
    → operator review
      → CU-D + CU-F + CU-H  (only if Checkpoint 2 is authorized)
        → CU-E
      → CU-G if persist/read shape changes
```

No change to WHY KEEP TOGETHER / WHY SPLIT. CU-D remains unauthorized.

**WHY KEEP TOGETHER**

- CU-B and CU-C share the failure taxonomy. Splitting them risks evals that
  assert the wrong class.
- CU-D and CU-F share overwrite/currentness/lease semantics. Retry without
  the concurrency fence is unsafe.

**WHY SPLIT**

- Diagnostics/evals must stabilize **before** recovery. Implementing retry now
  would guess the missing forensic boundary.
- UI (CU-E) should consume a frozen error taxonomy, not invent one.
- CU-A stays docs-only and must not pull product code into Checkpoint 0.

## Strategy

```
STRATEGY = B
HIGH-RISK CONTRACT FIRST = keep write schema strict; add classification/evals
THEN FAST LANE = selective recovery + UI after evidence
```

Why not A: recovery is not yet specified; integrating it now couples an
unknown policy to the whole stage.

Why not C: CU-D/F are not independently safe without CU-B/C.

Hybrid only later: after kernel acceptance, CU-E may split.

## Eval selection

### EXISTING_EVALS_REUSED

| Eval ID | Why |
| --- | --- |
| `EVAL-AI-HIST-NULL-READ` | Any persist/read change must keep NULL-fingerprint historical rows readable |
| `EVAL-AI-HIST-NULL-FIRST-MATERIAL-EDIT` | Recovery/rerun must not break first material mutation |
| `EVAL-AI-MATERIAL-CHANGE-REVOKE` | Recovery must not bypass rewind/publish revoke |
| `EVAL-AI-RECIPIENT-STALE-FAIL-CLOSED` | Failed/stale analysis must not leak to recipients |
| `EVAL-PP-S10-AI-CURRENT` | Current completed AI presentation |
| `EVAL-PP-CANONICAL-PROJECTION` | Failed/current/retry presentation stays server-projected |
| `EVAL-PP-MAPPING-INCOMPLETE-BLOCKS-AI` | Retry must not skip mapping readiness |
| `EVAL-PP-HIST-MATERIALS-OPEN` | Historical materials/AI remain openable |
| `EVAL-PROV-MOCK-SMOKE` | Default suites stay mock |
| `EVAL-PROV-LIVE-OPT-IN` | Live provider remains opt-in; not a Checkpoint 0/1 default |
| `EVAL-MANUAL-PREDEPLOY-HIST-AND-NEW` | Later product package only |

Checkpoint 0 added no Registry entries. Checkpoint 1 registered only
invariant-level IDs whose contracts were actually demonstrated. The incident
path belongs inside `EVAL-AI-SCHEMA-WRITE-STRICT`, not as a test-level ID.

### REGISTERED IN CHECKPOINT 1

| Eval ID | Class | Coverage |
| --- | --- | --- |
| `EVAL-AI-SCHEMA-WRITE-STRICT` | STATE | `COVERED` — includes incident `.0` wrong-element-type case |
| `EVAL-AI-PARSE-MALFORMED-SHAPES` | STATE | `COVERED` — recoverable wrapper noise vs irrecoverable malformed JSON |
| `EVAL-AI-INVALID-THEN-VALID-TWIN` | TRANSITION | `PARTIAL` — synthetic harness only; production path does not yet implement the transition |
| `EVAL-AI-INVALID-THEN-INVALID-BOUNDED` | TRANSITION | `PARTIAL` — synthetic harness only; production path does not yet implement the transition |
| `EVAL-AI-FAIL-DIAGNOSTICS` | STATE | `COVERED` — fail-closed positive allowlist wired into analyze `observeFailure` |

### STILL PROPOSED (later CUs)

| Proposed ID | Class | Invariant |
| --- | --- | --- |
| `EVAL-AI-FAIL-NO-PUBLISH` | STATE / TRANSITION | FAILED never yields `canShare` or a grant |
| `EVAL-AI-RETRY-NO-OVERWRITE-NEWER` | TRANSITION | A late retry/recovery cannot overwrite a newer successful analysis |

The synthetic **invalid-first / valid-second twin is required**. It is the
application-level proof of the incident shape and must not depend on live
provider randomness. The twin runner is test-only and does not enable
production retry.

`EVAL-AI-INVALID-THEN-VALID-TWIN` and `EVAL-AI-INVALID-THEN-INVALID-BOUNDED`
remain `PARTIAL` because:

- a deterministic policy/harness exists;
- the intended bounded transition is demonstrated synthetically;
- production orchestration wiring does not yet implement the transition;
- promotion to `COVERED` requires Checkpoint 2 production-path deterministic
  evidence.

Do not delete these evals. Do not redefine them merely to preserve `COVERED`.

## Checkpoint structure

```
CHECKPOINT_0 = FORENSIC_AND_CHANGE_PLAN
CHECKPOINT_0_SCOPE = CU-A + this manifest
CHECKPOINT_0_IMPLEMENTATION = COMPLETE
CHECKPOINT_0_OPERATOR_ACCEPTANCE = PASS
CHECKPOINT_0 = PASS

CHECKPOINT_1 = DIAGNOSTICS_AND_EVAL_FOUNDATION
CHECKPOINT_1_SCOPE = CU-B + CU-C + synthetic characterization
CHECKPOINT_1_IMPLEMENTATION = COMPLETE
CHECKPOINT_1_OPERATOR_ACCEPTANCE = PENDING
CHECKPOINT_1_AUTHORIZATION = AUTHORIZED
CHECKPOINT_1_DEPENDS_ON = operator acceptance of Checkpoint 0
                          + production forensic packet (received)

CHECKPOINT_2 = SELECTIVE_RECOVERY_KERNEL
CHECKPOINT_2_SCOPE = CU-D + CU-F + CU-H (approved class only)
CHECKPOINT_2_STATUS = NOT_STARTED
CHECKPOINT_2_AUTHORIZATION = NOT_AUTHORIZED
CHECKPOINT_2_RECOVERY_DIRECTION = DIRECTION_2_BOUNDED_SAME_PROMPT_RETRY
CHECKPOINT_2_DEPENDS_ON = Checkpoint 1 operator acceptance
                          + explicit Checkpoint 2 implementation authorization

CHECKPOINT_3 = OPERATOR_SURFACE
CHECKPOINT_3_SCOPE = CU-E
CHECKPOINT_3_STATUS = NOT_STARTED

CHECKPOINT_4 = HISTORICAL_AND_PACKAGE
CHECKPOINT_4_SCOPE = CU-G as needed + L4 if product code shipped
CHECKPOINT_4_STATUS = NOT_STARTED
```

Minimize Cursor/operator iterations: accept Checkpoint 0, authorize the
read-only production packet (if wanted), then one Checkpoint 1
implementation packet. Do not authorize CU-D in the same packet as CU-B.

## Requirements

### Forensic / planning (Checkpoint 0)

| ID | Requirement | Acceptance evidence | Auth | Status |
| --- | --- | --- | --- | --- |
| S317A-F-001 | Entire AI-analysis path is mapped to exact files/functions. | `CODE` + this DOC | `AUTHORIZED` | `PASS` |
| S317A-F-002 | Failure-class table exists with current handling and retry hypotheses. | this DOC | `AUTHORIZED` | `PASS` |
| S317A-F-003 | Failed-run evidence inventory is explicit (YES/PARTIAL/NO). | `CODE` + this DOC | `AUTHORIZED` | `PASS` |
| S317A-F-004 | Short-session schema vs prompt vs provider variability are distinguished. Write schema is not declared a SCHEMA_GAP. | `CODE` + this DOC | `AUTHORIZED` | `PASS` |
| S317A-F-005 | Compact CIA, CUs, graph, kernel, strategy, eval plan, and validation plan exist before implementation. | this DOC | `AUTHORIZED` | `PASS` |
| S317A-F-006 | Production forensic packet is specified and not executed. | this DOC | `AUTHORIZED` | `PASS` |
| S317A-F-007 | Exact first-run production error class is identified. | `PROD_RO` journal: `MODEL_SCHEMA_VALIDATION_ERROR` at `listeningAndReframing.missedOpportunities.0` | `AUTHORIZED` | `PASS` |

### Product invariants (later CUs; not implemented now)

| ID | Requirement | Status |
| --- | --- | --- |
| S317A-P-001 | Canonical persisted `analysisJson` remains write-schema valid. | `APPROVED` |
| S317A-P-002 | Malformed provider output never becomes current valid analysis. | `APPROVED` |
| S317A-P-003 | FAILED never grants publication or recipient access. | `APPROVED` (already true; must be preserved) |
| S317A-P-004 | Recovery cannot overwrite a newer successful analysis. | `APPROVED` |
| S317A-P-005 | Input fingerprint/currentness remains the prompted-material contract. | `APPROVED` |
| S317A-P-006 | Personal-feedback privacy projections remain server-side. | `APPROVED` |
| S317A-P-007 | Historical persisted-read compatibility remains distinct from write validation. | `APPROVED` |
| S317A-P-008 | Provider cost is bounded; no infinite retry. | `APPROVED` |
| S317A-P-009 | Failures are diagnosable without persisting transcript/notes/hiddenInfo or raw model text by default. | `APPROVED` |
| S317A-P-010 | Automatic retry, if later approved, is eligible-class only and default-max one extra generation. | `APPROVED` direction: `MODEL_SCHEMA_VALIDATION_ERROR` only; max 1 extra generation; same prompt. Impl remains Checkpoint 2 / `NOT_AUTHORIZED`. |
| S317A-P-011 | Write-schema relaxation requires proven SCHEMA_GAP. | `APPROVED` — SCHEMA_CHANGE remains `NOT_AUTHORIZED` |
| S317A-P-012 | Prompt change requires proven PROMPT_GAP contribution to the actual class. | `APPROVED` gate — PROMPT_HARDENING remains `NOT_AUTHORIZED`; no proven necessary prompt correction |

## Production evidence still required

```
PRODUCTION_FORENSIC_REQUIRED = RECEIVED
PRODUCTION_ACCESS = READ_ONLY_PACKET_USED
ACTUAL_FIRST_FAILURE_CLASS = MODEL_SCHEMA_VALIDATION_ERROR
```

The current `AiAnalysis` row remains the successful second run. The first-run
class came from `ExternalServiceEvent`, not from reconstructing the raw body.

### Read-only production forensic packet

Execute only after explicit operator authorization. Read-only. Print no
secrets, no `.env`, no `DATABASE_URL`, no API keys.

**A. DB rows/columns**

Session: `cmt1l5d3p000irsm1ekwg3oh3`

1. `AiAnalysis` (current = run 2). Select only:

```sql
SELECT
  a."id",
  a."sessionId",
  a."transcriptId",
  a."transcriptRetranscribeCount",
  a."analysisVersion",
  a."publicationEpoch",
  a."inputFingerprint",
  a."status",
  a."providerResponseId",
  a."model",
  a."language",
  a."overallScore",
  a."errorMessage",
  a."startedAt",
  a."completedAt",
  a."createdAt",
  a."updatedAt",
  a."visibility",
  (a."analysisJson" IS NOT NULL) AS "hasAnalysisJson",
  (a."rawModelOutput" IS NOT NULL) AS "hasRawModelOutput",
  jsonb_typeof(a."rawModelOutput") AS "rawModelOutputType"
FROM "AiAnalysis" AS a
WHERE a."sessionId" = 'cmt1l5d3p000irsm1ekwg3oh3';
```

Do **not** print `analysisJson`, `sharedAnalysisJson`, or
`rawModelOutput.providerEnvelope` in the first pass.

Optional second-pass (facilitator-only redacted): from `rawModelOutput` print
**only** `diagnostics` keys (durations, token estimates, `responseLength`).
Redact envelope text.

2. Transcript richness metadata only — **not** transcript text:

```sql
SELECT
  t."id",
  t."status",
  t."language",
  t."retranscribeCount",
  t."speakerMappingStatus",
  t."hasSpeakerDiarization",
  char_length(COALESCE(t."text", '')) AS "textChars",
  char_length(COALESCE(t."diarizedText", '')) AS "diarizedChars",
  (SELECT count(*) FROM "TranscriptSegment" s WHERE s."transcriptId" = t."id") AS "segmentCount"
FROM "Transcript" AS t
WHERE t."sessionId" = 'cmt1l5d3p000irsm1ekwg3oh3';
```

3. Roster counts only — no notes:

```sql
SELECT "type", count(*) AS n
FROM "SessionParticipant"
WHERE "sessionId" = 'cmt1l5d3p000irsm1ekwg3oh3'
GROUP BY "type";
```

4. Journal table (this is the first-run evidence):

```sql
SELECT
  e."id",
  e."service",
  e."severity",
  e."errorCode",
  e."title",
  e."message",
  e."requestId",
  e."createdAt",
  e."rawError"
FROM "ExternalServiceEvent" AS e
WHERE e."sessionId" = 'cmt1l5d3p000irsm1ekwg3oh3'
  AND (
    e."title" LIKE 'AI analysis failed:%'
    OR e."title" = 'AI analysis failed (mock)'
  )
ORDER BY e."createdAt" ASC;
```

Expected useful `rawError` keys: `errorClass`, `provider`, `model`,
`httpStatus`, `retryable`, `diagnostics.issueCount`, `diagnostics.issuePaths`,
`diagnostics.outputCondition`, `diagnostics.responseLength`,
`diagnostics.providerStatus`, `diagnostics.incompleteReason`, `metrics.*`.

`rawError` is not expected to contain transcript/notes. If any text field
looks like model output, redact it before leaving the host.

5. Publication sanity:

```sql
SELECT p."id", p."analysisVersion", p."publicationEpoch", p."publishedAt", p."revokedAt"
FROM "AiAnalysisPublication" AS p
JOIN "AiAnalysis" AS a ON a."id" = p."aiAnalysisId"
WHERE a."sessionId" = 'cmt1l5d3p000irsm1ekwg3oh3';
```

**B. Host journal time window / patterns**

Use the `ExternalServiceEvent.createdAt` min/max ± 15 minutes, or the
operator-known incident day.

Patterns (no secrets):

- `[AI analysis] material_input_fingerprint`
- `[ExternalServiceEvent] APP ERROR: AI analysis failed:`
- `AI analysis failed: MODEL_`
- session id `cmt1l5d3p000irsm1ekwg3oh3`

Do not dump full process env. Do not fetch Yandex response bodies by ID unless
a later packet explicitly authorizes provider-side read-only retrieval.

**C. Is raw provider output expected to exist?**

- Failed run: **not** on `AiAnalysis`. Possibly absent everywhere.
- Successful run: `rawModelOutput.providerEnvelope` **yes** — do not print it
  in the first pass.
- Yandex may still hold the exhausted first generation if its ID was logged.
  That ID is **not** expected on the current row after a MODEL_* fail.

**D. Safe redaction**

Redact: transcript text, notes, hiddenInfo, personal feedback, emails, names
beyond counts, any model-output prose, secrets.

Keep: ids, statuses, counts, hashes, errorClass, issuePaths, outputCondition,
durations, token estimates, analysisVersion.

**E. Comparison**

| Attempt | Source | Compare |
| --- | --- | --- |
| 1 | `ExternalServiceEvent` row(s) with `MODEL_*` title | `errorClass`, paths/condition, responseLength, fingerprint log |
| 2 | current `AiAnalysis` | `status=COMPLETED`, `hasAnalysisJson`, `analysisVersion` (expect ≥ 1), `inputFingerprint`, success diagnostics |
| Same input | fingerprint console + stored hash | both runs should share the fingerprint if materials were unchanged |

If zero matching `ExternalServiceEvent` rows exist, first-run class remains
unknown and CU-D stays blocked.

**F. Commands must be read-only**

`SELECT` only. No `UPDATE`/`INSERT`/`DELETE`. No Prisma migrate. No provider
POST. No deploy.

**G. No secret/env values printed**

Do not `echo` connection strings or keys. Use the existing production access
method from `docs/operations/deployment-runbook.md` after operator
authorization. Do not invent a host/user.

## Validation plan (Checkpoint 1)

```
REQUIRED_VALIDATION_LEVEL = L1 + L2 + L3
L3_REQUIRED_NOW = YES
L3_REASON = production analyze/diagnostics path changed
L4_REQUIRED_NOW = NO
PRODUCT_SUITE_REQUIRED_NOW = NO
LIVE_CHARACTERIZATION = EVIDENCE_NOT_A_SUBSTITUTE_FOR_DETERMINISTIC_TESTS
```

Required:

- exact schema / parser / diagnostic / mocked-harness tests
- Eval Registry validator
- relevant AI analysis / orchestration cluster
- currentness/fencing tests if touched

Do not run L4. Live-provider characterization is evidence, not a gate.

## Checkpoint 0 evidence log

```
CURRENT_CHECKPOINT = 1
CHECKPOINT_0 = PASS
CHECKPOINT_0_IMPLEMENTATION = COMPLETE
CHECKPOINT_0_OPERATOR_ACCEPTANCE = PASS
CHANGE_UNITS = CU-A
FORENSIC_VERDICT = CLASSIFIED
ACTUAL_FIRST_FAILURE_CLASS = MODEL_SCHEMA_VALIDATION_ERROR
```

## Checkpoint 1 evidence log

```
CURRENT_CHECKPOINT = 1
CHECKPOINT_1 = DIAGNOSTICS_AND_EVAL_FOUNDATION
CHECKPOINT_1_IMPLEMENTATION = COMPLETE
CHECKPOINT_1_OPERATOR_ACCEPTANCE = PENDING
CHANGE_UNITS = CU-B + CU-C
PLANNED_EVALS = EVAL-AI-SCHEMA-WRITE-STRICT, EVAL-AI-PARSE-MALFORMED-SHAPES,
                EVAL-AI-INVALID-THEN-VALID-TWIN,
                EVAL-AI-INVALID-THEN-INVALID-BOUNDED,
                EVAL-AI-FAIL-DIAGNOSTICS
RECONCILED_EVALS = SCHEMA-WRITE-STRICT COVERED;
                   PARSE-MALFORMED-SHAPES COVERED;
                   INVALID-THEN-VALID-TWIN PARTIAL;
                   INVALID-THEN-INVALID-BOUNDED PARTIAL;
                   FAIL-DIAGNOSTICS COVERED
PLANNED_VALIDATION_LEVEL = L1 + L2
ACTUAL_VALIDATION_LEVEL = L1 + L2 + L3
L3_REQUIRED_NOW = YES
L4_REQUIRED_NOW = NO
ACTUAL_NEW_TEST_COUNT = 28
TEST_BREAKDOWN = schema-contract 7 + diagnostics 10
                 + characterization 4 + proposed-recovery 3
                 + parser-wrapper-contract 4
CU_B = ExternalServiceEvent sufficient; fail-closed positive allowlist
       sanitizer; no migration; no raw/sensitive persist
CU_C = proposed twins implemented in tests only; production retry unchanged;
       PARSE-MALFORMED-SHAPES invariant corrected to production helpers
CURRENT_FENCE_REUSABLE = PARTIAL
UNRESOLVED_FINDINGS = exact production element value;
                      Checkpoint 1 operator acceptance;
                      Checkpoint 2 implementation authorization
L3_VALIDATE_FAST = PASS
L3_UNIT_TESTS = 1691 passed / 8 skipped / 0 failed
L3_PLAYWRIGHT_LIST = 831 listed
OPERATOR_ACCEPTANCE = PENDING
CHECKPOINT_2 = NOT_STARTED / NOT_AUTHORIZED
```

## Checkpoint 1 characterization

See the operator report for the live matrix. Raw experimental output is
local-only under `tmp/stage-3-17a-characterization/` and must not be staged.

```
CHARACTERIZATION_PROVIDER = yandex
CHARACTERIZATION_MODEL = deepseek-v4-flash
CHARACTERIZATION_LANGUAGE = ru-RU
CHARACTERIZATION_HARD_CAP = 15
LIVE_PROVIDER_GENERATIONS = 15
EXPERIMENT_EARLY_STOP = NO
SYNTHETIC_FIXTURES = ULTRA_SHORT, SHORT, NORMAL_CONTROL
NO_PRODUCTION_MATERIAL = YES
OBSERVED_SHAPES = string_array only
INCIDENT_PATH_FAILURES = 0
PROVIDER_CHARACTERIZATION = NOT_REPRODUCED
PROMPT_SCHEMA_RESULT = AMBIGUITY
RECOMMENDED_DIRECTION = SUPERSEDED
RECOVERY_DIRECTION = DIRECTION_2_BOUNDED_SAME_PROMPT_RETRY
```

| Fixture | Runs | Parse valid | Schema valid | Incident-path failures |
| --- | ---: | ---: | ---: | ---: |
| ULTRA_SHORT | 5 | 5 | 5 | 0 |
| SHORT | 5 | 5 | 5 | 0 |
| NORMAL_CONTROL | 5 | 5 | 5 | 0 |

This sample does not prove historical causation. It does not prove schema
relaxation or prompt hardening. The operator later approved DIRECTION_2 from
the production incident plus same-fingerprint manual recovery, not from this
characterization matrix.

## Approved recovery direction (Checkpoint 2 only — not implemented)

Operator superseded `DIRECTION_5_MORE_EVIDENCE` after Checkpoint 1 review.

```
RECOVERY_DIRECTION = DIRECTION_2_BOUNDED_SAME_PROMPT_RETRY
ELIGIBLE_CLASS = MODEL_SCHEMA_VALIDATION_ERROR
MAX_EXTRA_GENERATIONS = 1
TOTAL_GENERATIONS_MAX = 2
ATTEMPT_2_PROMPT = SAME PROMPT
PROMPT_HARDENING = NOT_AUTHORIZED
SCHEMA_CHANGE = NOT_AUTHORIZED
MODEL_CHANGE = NOT_AUTHORIZED
JSON_REPAIR_CHANGE = NOT_AUTHORIZED
IMPLEMENTATION_IN_CHECKPOINT_1 = NO
CHECKPOINT_2_AUTHORIZATION = NOT_AUTHORIZED
```

Evidence used for the direction, not for implementation:

A. Production generation 1: `MODEL_SCHEMA_VALIDATION_ERROR` at
   `listeningAndReframing.missedOpportunities.0`.
B. Same material fingerprint manual rerun: new generation → `COMPLETED`.
C. Canonical Zod and typed provider schema both require
   `missedOpportunities: string[]`.
D. Static audit found semantic ambiguity but no typed contradiction.
E. Controlled Yandex characterization: 15/15 parse-valid, 15/15 schema-valid,
   0 incident-path reproductions, including 5 ULTRA_SHORT generations.

Interpretation:

- No evidence supports schema relaxation.
- No evidence currently supports prompt hardening as a necessary correction.
- The incident demonstrates that a fresh same-prompt generation can recover
  from this class.
- Current provider-level `retryable=false` means the exhausted generation
  itself must not be re-polled/recovered.
- Future retry means start exactly one NEW generation under the same owned
  analysis operation.

### Checkpoint 2 intended architecture (planning only)

```
SAME_OWNED_OPERATION = YES
SECOND_HTTP_POST_REQUIRED = NO
MAX_PROVIDER_GENERATIONS = 2
```

One analysis operation / one ownership claim. Within the SAME owned
operation:

```
generation 1
  → MODEL_SCHEMA_VALIDATION_ERROR
  → bounded diagnostic event
  → generation 2 using SAME prompt/input
  → success OR terminal failure
```

Do not design retry as:

```
HTTP POST #1 → FAILED → synthetic HTTP POST #2
```

Preferred future implementation should avoid:

- user-visible FAILED flash between attempts;
- same-owner POST re-entry while ANALYZING;
- unnecessary second `analysisVersion` claim;
- duplicate external product action.

`analysisVersion` should represent the owned analysis operation, not every
provider generation, unless existing architecture proves otherwise.

Checkpoint 2 must prove:

A. exactly max 2 generations;
B. only `MODEL_SCHEMA_VALIDATION_ERROR` triggers generation 2;
C. other failure classes retain current behavior;
D. generation 1 schema failure cannot publish;
E. generation 2 success is the only persisted COMPLETED output;
F. generation 2 schema failure produces terminal FAILED;
G. late/stale ownership cannot overwrite newer success;
H. fingerprint/material currentness remains unchanged;
I. no additional prompt/schema/model change;
J. first-attempt bounded diagnostics remain observable even when attempt 2
   succeeds.

## DECISION_REQUIRED

Resolved by operator during Checkpoint 1 review:

1. Keep write schema strict. SCHEMA_GAP is still not evidenced.
   `SCHEMA_CHANGE = NOT_AUTHORIZED`.
2. Recovery direction is `DIRECTION_2_BOUNDED_SAME_PROMPT_RETRY` for
   `MODEL_SCHEMA_VALIDATION_ERROR` only, max one extra same-prompt
   generation. Implementation is Checkpoint 2 only.
3. Prompt hardening is `NOT_AUTHORIZED`. No proven necessary prompt
   correction.

Still pending:

1. Accept Checkpoint 1 implementation?
2. Authorize Checkpoint 2 implementation of the approved direction?

## Authorization

```
AUTOMATIC_RETRY = NOT_AUTHORIZED
RECOVERY_IMPLEMENTATION = NOT_AUTHORIZED
PROMPT_CHANGE = NOT_AUTHORIZED
SCHEMA_CHANGE = NOT_AUTHORIZED
MODEL_CHANGE = NOT_AUTHORIZED
JSON_REPAIR_CHANGE = NOT_AUTHORIZED
COMMIT = NOT_AUTHORIZED
PUSH = NOT_AUTHORIZED
DEPLOY = NOT_AUTHORIZED
```

## Final stop

```
CHECKPOINT_0 = PASS
CHECKPOINT_1_IMPLEMENTATION = COMPLETE
CHECKPOINT_1_OPERATOR_ACCEPTANCE = PENDING
CHECKPOINT_2_STATUS = NOT_STARTED
CHECKPOINT_2_AUTHORIZATION = NOT_AUTHORIZED
STOP = YES — operator review of Checkpoint 1 corrections
```
