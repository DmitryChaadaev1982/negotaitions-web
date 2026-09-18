# Implementation Recommendation

## Decision

Do **not** ship a parameter-only hotfix as final reliability solution yet.

Reason:
- reliability target (preferably 4/4 valid chunks) was not reached with current primary model by only tuning token budget/format/chunk split/concurrency.

## Recommended Production Baseline (Interim)

- keep `TRANSCRIPT_ENHANCEMENT_MODE=chunked`;
- keep `TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY=4` for latency ceiling;
- keep bounded timeout/retries (`90000 ms`, retries `1`);
- keep strict JSON prompt shape (compact format not better);
- do not add long polling loop (incomplete classified terminal in measured lifecycle).

## Required Next Step

Introduce and validate a **verified alternate fallback model** (single known identifier, no matrix search) using the same validation guards.

Acceptance gate for rollout:
- 4/4 structural success in full-batch run;
- no index/count guard violations;
- no semantic regressions in spot-check;
- batch wall time <= 60s (preferred <= 45s);
- bounded call count / cost.

## Parameter/Semantics Needing Code Implementation

- Optional: explicit lifecycle toggle to skip polling for terminal-incomplete responses with `incomplete_details.reason=max_output_tokens`.
- Optional: targeted split-and-retry fallback only for failed chunks (e.g., 5->3+2) with strict global call budget.
- Optional: deterministic parser hardening for truncated-but-recoverable JSON (without accepting invalid segment structure).

## Parameters Already Existing (No New Code Needed)

- `TRANSCRIPT_ENHANCEMENT_MODE`
- `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS`
- `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS`
- `TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY`
- `TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS`
- `TRANSCRIPT_ENHANCEMENT_MAX_RETRIES`
- `YANDEX_TRANSCRIPT_ENHANCEMENT_MAX_OUTPUT_TOKENS`
- `TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL` (exists but currently unset)
