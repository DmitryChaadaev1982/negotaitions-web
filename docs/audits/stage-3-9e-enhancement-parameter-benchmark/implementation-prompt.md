# Ready Implementation Prompt

Implement Stage 3.9E reliability follow-up for chunked transcript enhancement on top of `origin/deploy/yandex-poc`.

Constraints:
- no DB schema changes;
- no transcript data backfill;
- no SpeechKit/audio pipeline changes;
- keep existing validation guards;
- no secret logging.

Changes requested:

1. Response lifecycle policy:
- Treat `status=incomplete` with `incomplete_details.reason=max_output_tokens` as terminal for current attempt.
- Do not run long polling in this terminal case.
- Keep short bounded retrieval only when status semantics are uncertain.

2. Fallback model path:
- Keep current primary model.
- If configured fallback model exists (`TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL`), run it as final bounded attempt for failed chunk.
- Keep max 3 attempts/chunk total.

3. Targeted chunk split retry:
- On failed chunk after strict retry, optionally split that chunk once (e.g., 5->3+2 or 6->3+3) and retry under same global call budget.
- Preserve deterministic merge and index validation.

4. Budget guards:
- enforce bounded call budget and timeout budget per enhancement run;
- emit sanitized counters (generation calls, retrieval calls, elapsed ms, success/failure totals).

5. Observability:
- store structured diagnostics per attempt:
  - status, incomplete_details, output token usage, output field path, parse/validation category, latency.
- do not store raw provider payload in DB.

6. Tests:
- add deterministic unit tests for:
  - terminal incomplete classification;
  - no-long-poll terminal path;
  - split retry path with index integrity;
  - fallback model final-attempt success/failure behavior.

Acceptance:
- full four-chunk batch can reach 4/4 valid chunks in controlled run with bounded latency/cost;
- no segment index/count integrity violations;
- no speaker/timestamp mutation.
