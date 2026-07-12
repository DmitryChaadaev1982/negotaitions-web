# Stage 3.9E Diagnostic Benchmark (Parameter Reliability / Latency)

Date: 2026-07-12  
Branch: `audit/stage-3-9e-enhancement-parameter-benchmark`  
Base: `origin/deploy/yandex-poc`  
Session: `cmrhs7ms80003mvm1tc8jv7ks`

## Scope and Safety

Executed a bounded production-safe diagnostic benchmark for chunked transcript enhancement against current Yandex AI integration.

Confirmed:
- no production DB writes;
- no transcript mutation API route calls (`POST /api/sessions/.../materials/enhance-transcript` not used);
- no service restart;
- no env changes;
- no source-code changes on server.

Input source for benchmark transcript text:
- `TranscriptSegment.qualityText ?? TranscriptSegment.text`
- 22 segments, fixed partition:
  - chunk 0: indexes 0-5
  - chunk 1: indexes 6-11
  - chunk 2: indexes 12-16
  - chunk 3: indexes 17-21

## Phase-2 Code Parity Check

Inspected local and production copies of:
- `AGENTS.md`
- `.env.example`
- `lib/env.ts`
- `lib/services/yandex-transcript-enhancement.ts`
- `lib/services/transcript-enhancement-persistence.ts`
- `lib/services/transcription-runner.ts`
- enhancement tests
- Stage 3.9E implementation and validation audits
- Yandex deployment/runbook docs

Production implementation semantics match expected Stage 3.9E/Phase-2 behavior for:
- request endpoint/headers/model path;
- prompt shape (normal/strict);
- parsing/extraction logic;
- validation guards;
- response status handling and polling stop conditions.

## Measured Facts

Primary measured artifacts:
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/baseline-observations.json`
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/response-lifecycle.csv`
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/token-budget-results.csv`
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/format-results.csv`
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/chunk-size-results.csv`
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/concurrency-results.csv`
- `docs/audits/stage-3-9e-enhancement-parameter-benchmark/run-summary.csv`

Sanitized run counters:
- generation calls: 27
- retrieval calls: 1
- elapsed benchmark wall time: 592413 ms (~9m52s)

## Required Conclusions (Evidence-Based)

1) Is `status=incomplete` terminal or evolving?
- **Verdict: terminal in this integration sample** (`TERMINAL_INCOMPLETE`).
- Evidence: retrieval of same response ID after initial incomplete remained `incomplete` with same `incomplete_details`, no output.

2) What does `incomplete_details` say?
- `{"reason":"max_output_tokens","valid":true}`.

3) Principal cause?
- **Mixed, dominated by token-cap exhaustion and model output instability**:
  - requests hit output cap exactly (`usageOutputTokens == max_output_tokens`);
  - for problematic chunk(s), higher token caps still returned non-parseable/empty structured output;
  - concurrency/rate-limit was not primary (no 429 in benchmark).

4) Does polling improve completion rate?
- **No evidence that polling helps** (single lifecycle probe showed terminal-incomplete behavior).

5) Minimum useful polling interval/window?
- For current behavior: **none recommended**.
- If defensive check is required: one short verification read (<= 250 ms) only.

6) What `max_output_tokens` is sufficient?
- No globally sufficient value found up to 4800 for failing representative chunk 2.
- Chunk 0 succeeded at 2400 and 4800; chunk 2 failed at 2400/3600/4800.

7) Does compact JSON improve reliability?
- **No**. Compact format performed worse/equal on tested chunks, with incomplete/malformed outcomes.

8) Does smaller chunking improve reliability?
- **Partially, but not reliably**:
  - chunk 0 split (3+3): both parts valid;
  - chunk 2 split (3+2): one part valid, one still malformed.

9) Which concurrency is best?
- Reliability: no winner (all 0/4 valid under tested candidate).
- Latency-only: concurrency 4 was fastest (~29.8s wall time), but still 0/4 valid.

10) Is alternate model needed?
- **Yes, likely required** for reliability target, because current model/config failed to produce 4/4 valid chunks in bounded tests.

11) Expected full-transcript latency?
- Under current failing behavior:
  - c=1: ~113.9s
  - c=2: ~58.2s
  - c=4: ~29.8s
- For production recommendation meeting reliability target, latency remains uncertain until alternate model / stronger structured-output support is validated.

12) Expected provider call count?
- Current bounded run used 27 generation calls.
- Operational estimate (single pass, 4 chunks): ~4 generation calls (+ optional bounded retries for failed chunks).

13) Exact production parameters recommendation
- See:
  - `docs/audits/stage-3-9e-enhancement-parameter-benchmark/recommended-parameters.env.example`
  - `docs/audits/stage-3-9e-enhancement-parameter-benchmark/implementation-recommendation.md`

## Selection Criteria Result

Target criteria (4/4 structural validity with <=60s batch latency) were **not met** by tested primary-model parameter permutations alone.

Therefore:
- do not recommend adding long polling loops;
- do not recommend compact format switch;
- do not claim current model can be stabilized by token cap increase up to 4800.

## Linguistic Quality Notes

For structurally valid outputs:
- observed mostly `FORMATTING_ONLY`/`UNCHANGED` on successful chunk-0 variants;
- one split subchunk reported `QUESTIONABLE` (requires caution);
- no broad claim of quality gain is justified without reliable structure first.

## Raw Artifact Location

Raw provider envelopes and private benchmark input remain only on server:
- `/tmp/negotaitions-enhancement-parameter-benchmark/`
- `/tmp/negotaitions-enhancement-parameter-benchmark/raw/`

Not copied into repository.
