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
- Provider response ID, renewal, and terminal updates require
  `(id, ANALYZING, runToken)` plus the active lease value where applicable.
- A retry gets a new token. An old process therefore cannot renew or write a
  success/failure after takeover.
- A normal failure is terminal `FAILED` and is immediately retryable.

Rows created before the lease migration have both ownership columns null.
They remain protected for 30 minutes from `updatedAt` by default
(`AI_ANALYSIS_LEGACY_STALE_AFTER_MS`), then become atomically recoverable.
This compatibility grace is only a transition rule for null ownership; new
runs never use timestamps as their ownership identity.

The default renewable lease is 180 seconds
(`AI_ANALYSIS_LEASE_DURATION_MS`, bounded 150–600 seconds). Renewal happens
before context loading, immediately after provider acceptance, around every
known-response GET, and before terminalization. Renewal also compares the
prior lease value and refuses to revive an already expired lease, so an
expired claim remains recoverable.

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

For Yandex background responses, the accepted response ID is persisted to
`AiAnalysis.providerResponseId` immediately after the background POST returns
and before long polling. Only the current fenced owner may persist that ID. If
a route/process retries while an active operation already has a recoverable
ID, the adapter retrieves that same response before any new POST. Yandex
generation requests are treated as non-idempotent; the application does not
rely on `Idempotency-Key` to make duplicate generation safe.

Once an ID is known, transient GET/network/429/5xx failures retry retrieval of
that same ID within both the response deadline and operation deadline. The
operation never creates another generation for that known response. Terminal
non-success and retrieval deadline exhaustion end the operation; a later
explicit application retry may create a new generation only after the durable
operation is terminal.

Synthetic fixtures for every relied-on state are in
`lib/ai/fixtures/yandex-response-lifecycle.ts`.

## Retry and wall-clock model

Wave 1 defaults:

- operation attempts: 1
- POST acceptance HTTP timeout: 20 seconds
- per-known-response polling deadline: 300 seconds
- poll interval: 1.5 seconds
- whole provider operation deadline: 600 seconds
- effective Yandex analysis `max_output_tokens`: 8000

The call tree is:

1. One background primary generation POST.
2. Persist `providerResponseId` if the provider accepted the response.
3. Repeated GET of the same response until a terminal lifecycle state or
   elapsed-time deadline.
4. Schema validation and fenced terminalization.

Wave 1 intentionally disables automatic compact fallback and optional depth
generation. The arbitrary provider GET count ceiling is no longer a primary
termination mechanism; elapsed deadlines are authoritative. Retryable GET
transport errors remain bounded, but they do not create a second generation.
A POST transport failure before a response ID is classified as
acceptance-unknown and does not blindly retry generation.

## Normal successful path

A completed, schema-valid primary result uses exactly one generation POST. It
does not use compact fallback or optional depth in Wave 1.

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

Low-risk, semantics-preserving changes in Wave 1 are limited to:

- adding `reasoning: { effort: "none" }` and `background: true` to the
  Yandex DeepSeek analysis request;
- persisting and recovering `providerResponseId`;
- using wall-clock polling deadlines instead of a 100-GET ceiling;
- avoiding automatic regeneration once a provider response ID may have been
  accepted;
- keeping transcript enhancement optional for analysis readiness.

The August 2026 regression is strongly indicated to have been caused by the
provider defaulting DeepSeek V4 Flash to large internal reasoning. For the
two production Yandex DeepSeek calls in this product, analysis and transcript
enhancement, the request invariant is:

```json
{
  "reasoning": {
    "effort": "none"
  }
}
```

Do not replace it with flat `reasoning_effort`, `reasoningOptions`, or
provider-specific thinking flags.

The following require later waves and are not changed here: background
`stream=true` delivery, progressive section rendering, token-aware larger
chunk packing, oversized single-utterance splitting, automatic mapping
parallelism, and `processingMetadata` race remediation.
