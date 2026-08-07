# AI analysis operation and provider lifecycle

## Durable application ownership

An `AiAnalysis` in `ANALYZING` is owned by its `runToken` until
`leaseExpiresAt`. Claim, renewal, success, and failure are separate short
database statements; no database transaction spans prompt construction or a
provider request.

- Initial creation is protected by the unique `sessionId`.
- Existing terminal or `QUEUED` rows are claimed with a compare-and-swap on
  the row identity and prior state.
- An `ANALYZING` row can be taken over only after its lease expires.
- Renewal and terminal updates require `(id, ANALYZING, runToken)`.
- A retry gets a new token. An old process therefore cannot renew or write a
  success/failure after takeover.
- A normal failure is terminal `FAILED` and is immediately retryable.

Rows created before the lease migration have both ownership columns null.
They remain protected for 30 minutes from `updatedAt` by default
(`AI_ANALYSIS_LEGACY_STALE_AFTER_MS`), then become atomically recoverable.
This compatibility grace is only a transition rule for null ownership; new
runs never use timestamps as their ownership identity.

The default renewable lease is 180 seconds
(`AI_ANALYSIS_LEASE_DURATION_MS`, bounded 150–600 seconds). It exceeds the
largest permitted individual provider HTTP timeout (120 seconds) with a
safety margin. Renewal happens before/after generation requests, around every
known-response GET, before semantic fallback/depth work, and before success
terminalization. Renewal also compares the prior lease value and refuses to
revive an already expired lease, so an expired claim remains recoverable.

## Yandex Responses lifecycle contract

The adapter uses the Yandex AI Studio OpenAI-compatible Responses endpoint:

- [Yandex AI Studio Responses API](https://aistudio.yandex.ru/docs/ai-studio/responses/)
- [Yandex AI Studio OpenAI-compatible API](https://aistudio.yandex.ru/docs/ai-studio/concepts/api#openai)
- Existing sanitized capability evidence:
  `docs/audits/stage-3-9e-structured-output-probe/official-api-capability.md`

The production adapter relies only on these response-level lifecycle values:

- nonterminal: `queued`, `in_progress`
- terminal success: `completed`
- terminal non-success: `failed`, `cancelled`, `incomplete`

Only `completed` may supply final output. Text present in a nonterminal or
terminal non-success response is partial and is never accepted. A completed
response with no usable text is `MODEL_EMPTY_OUTPUT`. Failure, cancellation,
incomplete, missing status, and unknown status use explicit provider
lifecycle errors and retain only bounded status/error-code/reason metadata.

A nonterminal response must include `id`; otherwise retrieval is impossible
and the call ends deterministically. A completed response does not require an
ID because no retrieval is needed.

Once an ID is known, transient GET/network/429/5xx failures retry retrieval of
that same ID within both the response deadline and operation deadline. The
operation never creates another generation for that known response. Terminal
non-success and retrieval deadline exhaustion end the operation; a later
manual application retry may create a new generation.

Synthetic fixtures for every relied-on state are in
`lib/ai/fixtures/yandex-response-lifecycle.ts`.

## Retry and wall-clock model

Defaults:

- operation attempts: 2
- HTTP timeout: 45 seconds
- per-known-response polling deadline: 150 seconds
- poll interval: 1.5 seconds
- maximum GETs per known response: 100
- whole provider operation deadline: 600 seconds

The call tree is:

1. Primary generation, retried once only when no provider response ID was
   obtained and the transport/HTTP failure explicitly permits regeneration.
2. One compact JSON fallback only after a completed primary produced
   truncated JSON.
3. One optional depth call only after a schema-valid mandatory result exists.

Compact fallback and optional depth are not outer retries. Optional depth
never triggers another primary attempt and cannot discard the valid base
result on timeout, provider failure, empty/invalid output, schema failure, or
no measured depth improvement.

Maximum generation POSTs are therefore 4 (2 primary + 1 compact + 1 depth).
Maximum configured GET count is 400, additionally constrained by the
per-response and 600-second whole-operation deadlines. The deterministic
provider wall-clock bound is 600 seconds, down from the approximately
24-minute pre-remediation composition where every outer attempt could contain
primary, compact, and depth calls and polling could overshoot by a full HTTP
timeout.

## Normal successful path

A completed, schema-valid primary result that satisfies all depth checks uses
exactly one generation POST. It does not use compact fallback or optional
depth. Compact generation is reachable only when a completed mandatory
response is truncated/invalid in the recoverable JSON shape. Optional depth is
reachable only after mandatory schema validity and only when the deterministic
depth checks find a quality gap.

Runtime metrics separate:

- application work before the first provider request;
- prompt characters and estimated input tokens;
- system/coaching/output-schema instruction sizes;
- configured maximum output tokens;
- generation POST time;
- known-response polling time and request count;
- parsing/schema-validation time;
- optional-depth time and outcome;
- actual response/output characters;
- total operation time.

The deterministic benchmark (`scripts/benchmark-ai-analysis.ts`) uses a
synthetic depth-complete result to verify the one-POST path without a provider
call. It must not be interpreted as observed Yandex latency or as a typical
production output percentile.

Low-risk, semantics-preserving changes in this remediation are limited to:

- constructing identical base provider instructions once per operation;
- preventing compact/depth work from being multiplied by outer retries;
- skipping optional depth when primary already meets the existing criteria;
- preserving a valid mandatory result when optional depth is unusable;
- avoiding regeneration once a provider response ID is known.

The following require the later controlled live-provider benchmark and are
not changed here: max-output-token right-sizing, removal of overlapping
prompt/schema prose, polling-interval tuning, and any change to the depth
criteria or model.
