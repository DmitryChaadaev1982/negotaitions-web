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

Wave 2 also fences the short `QUEUED` acceptance state. The analyze route
returns `202`, then self-hosted Next.js `after()` atomically transitions the
same owner to `ANALYZING`. A second request sees the active queued lease and
cannot create duplicate provider work. Client request cancellation is not
forwarded into accepted provider execution. The route declares a static
`maxDuration` of 610 seconds, just above the bounded 600-second provider
operation deadline required by Next.js route configuration.

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

The current verified contract covers `background=true` plus independent GET
retrieval. Repository evidence does not establish resumable
`background=true` + `stream=true`, so no provider stream is opened. Background
GET retrieval is the authoritative final recovery path.

A live August 10, 2026 Yandex run returned no usable output in any nonterminal
retrieval during approximately 85 seconds. The complete report appeared only
with `completed`. Wave 2 therefore does not inspect or persist nonterminal
output. This keeps one prompt, one generation, one full validation boundary,
and the pre-Wave-2 report quality contract.

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

## Recovery eligibility of a recorded generation

A recorded `providerResponseId` is a recovery hint, not a permanent property of
the session. It survives only while retrieving it again can still produce the
result the current request needs.

Terminalization decides whether the recorded generation outlives the run:

- Success clears it. A completed generation has already been persisted as
  `analysisJson`, so an explicit user retry must produce a new generation
  instead of re-serving the previous response.
- A failure whose provider-side generation can still yield a usable result
  keeps it. Retrieval deadline exhaustion, local abort, ownership loss, and
  acceptance-unknown POST transport failures fall in this group: the background
  response may still be running, so the next re-entry must resume the same
  generation rather than start a second one.
- A failure that proves the generation is exhausted clears it. Terminal
  lifecycle non-success (`failed`, `cancelled`, `incomplete`), unknown status,
  provider HTTP/rate-limit rejection, and retrieved-but-unusable output
  (`MODEL_EMPTY_OUTPUT`, `MODEL_INVALID_OUTPUT`,
  `MODEL_SCHEMA_VALIDATION_ERROR`) fall in this group. Keeping the ID here
  would make every later retry re-retrieve the same doomed response, so the
  session could never be analyzed again.

The single policy point is
`canRecoverProviderResponseAfterFailure(code)` in `lib/ai/negotiation-analysis.ts`;
the analyze route derives `clearProviderResponseId` from it, and the fenced
`fail` write applies it.

Re-claiming an existing row also revalidates the recorded ID against the input
it was generated from. `AiAnalysis` stores the `transcriptId`,
`transcriptRetranscribeCount`, and `language` of the run that recorded the ID,
and `resolveRecoverableProviderResponseId` reuses the ID only when all three
still match the incoming request. A retranscribe or a language change therefore
drops the ID and forces a new generation, because retrieving the old response
would return an analysis of text the user no longer has.

Clearing an ID never causes duplicate generation on its own: it happens only on
a fenced terminal write by the current owner, after which no polling path for
that ID remains active.

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
- releasing a recorded response ID on success and on exhausted-generation
  failures so an explicit retry is never wedged;
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

Stage 3.13D Wave 2 keeps this durable whole-report provider path. It does not
enable streaming, progressive parsing, partial-result persistence, or
additional provider generations.

## Large-input lifecycle interaction

- Normal and lossless-compact analysis prompts both create one canonical Yandex
  background generation. Packing does not add intermediate response IDs or
  weaken `runToken`/lease fencing.
- The compact representation removes the narrative transcript only after
  normalized equivalence with ordered segment text is verified; every timeline
  segment remains. The logical analysis input identity is therefore still
  transcript ID + retranscription count + language. No derived AI summary is
  persisted or reused.
- A new Yandex DeepSeek generation is rejected locally with
  `INPUT_TOO_LARGE` when the complete lossless prompt exceeds the 90,000
  estimated-token prompt budget. This happens before POST and reports
  `contentDropped=false`.
- Recovery-first remains stronger than the new local budget: an existing
  `providerResponseId` is retrieved before applying the no-new-generation
  boundary. An accepted potentially live generation is not abandoned merely
  because application code now has a conservative input limit.
- `INPUT_TOO_LARGE` does not make a response reusable. If no response ID exists,
  failure terminalization clears any stale pointer and an explicit retry cannot
  accidentally adopt unrelated work.
- Output exhaustion remains separate. `incomplete/max_output_tokens`, invalid
  JSON, empty output, and schema failure still exhaust and release the recorded
  provider generation exactly as before.

## Deferred-item review after large-input hardening

- Oversized transcript-enhancement utterances are now split and reconstructed
  deterministically. This is outside the `AiAnalysis` provider lifecycle.
- Enhancement terminal writes gained a narrow metadata `runId`,
  retranscription-generation check, and `updatedAt` compare-and-swap because
  extra pieces can lengthen execution. Shared speaker-mapping metadata writers
  were not refactored.
- Speaker mapping orchestration remains deterministic/sequential; analysis does
  not depend on mapping parallelism.
- The context builder now reads `Transcript` and ordered
  `TranscriptSegment` rows through one relation query, so the historical torn
  transcript/segment read is not present. Pause intervals are still loaded
  separately, but they do not represent a transcript text version.
- Existing provider timeout and delay timers remain scoped and cleaned up.
  Detached execution adds no browser timers or listeners; lease/provider-ID
  recovery remains the cleanup and takeover mechanism.
