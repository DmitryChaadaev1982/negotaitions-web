# Stage 3.9E Phase 2 - Enhancement Reliability

Date: 2026-07-12  
Branch: `fix/stage-3-9e-phase-2-enhancement-reliability`  
Base: `deploy/yandex-poc`

## Scope

Implemented reliability-only fixes for empty-output enhancement failures and
provider-text preservation at ingestion:

- empty-output diagnostics and staged telemetry in Yandex enhancement flow;
- bounded empty-output retry policy with strict JSON retry;
- optional alternate-model fallback via env (`TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL`);
- initial ingestion backup: provider text persisted to `TranscriptSegment.qualityText`;
- deterministic tests for retries, fallback, telemetry stages, and no-loss behavior.

No SpeechKit ASR parameter changes, no audio pipeline changes, no schema migration,
no historical backfill, and no real provider calls in tests.

## Root Cause

Phase 1 chunking removed timeout bottlenecks, but chunk attempts still failed with
`empty_output` because provider responses frequently returned no usable output body
for the chosen model/prompt envelope. Existing logic had limited diagnosis and no
alternate model failover path for empty-output-specific failures.

## Implementation Highlights

1. **Empty-output diagnostics**
   - Added sanitized attempt telemetry:
     - `responseIdPresent`, `initialStatus`, `finalStatus`
     - `pollingAttemptCount`, `pollingElapsedMs`
     - `outputFieldDetected`, `rawOutputCharCount`
     - `parsedSegmentCount`, `emptyOutputStage`
     - `modelUsed`, `maxOutputTokens`
     - fallback fields (`fallbackTriggered`, `fallbackReason`)
   - Added output extraction diagnostics across nested response envelopes (`output_text`, `output.content.text`, nested `response/result`).

2. **Bounded retry/fallback policy**
   - Per chunk, bounded to max 3 attempts:
     1) primary model, normal prompt
     2) primary model, strict JSON + higher bounded tokens
     3) optional fallback model, strict JSON + bounded tokens
   - No unbounded retry loops.

3. **Fallback model policy**
   - New env: `TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL`.
   - Default is disabled when empty/unset.
   - Fallback is attempted only when configured and different from primary model.

4. **Ingestion backup safety**
   - Initial transcript-segment creation now stores provider text in both:
     - `TranscriptSegment.text`
     - `TranscriptSegment.qualityText`
   - Existing non-null `qualityText` remains protected in enhancement update path.

5. **Status semantics preserved**
   - `COMPLETED`: all chunks validated.
   - `PARTIAL`: some chunk success + some fallback.
   - `FAILED`: no chunk success, transcript text preserved.
   - `SKIPPED`: no eligible text / enhancement bypass.

## Files Changed

- `lib/services/yandex-transcript-enhancement.ts`
- `lib/services/transcript-enhancement-persistence.ts`
- `lib/services/transcript-enhancement-persistence.test.ts`
- `lib/services/transcription-runner.ts`
- `lib/env.ts`
- `lib/env.transcript-enhancement.test.ts`
- `lib/services/yandex-transcript-enhancement.test.ts`
- `lib/services/admin-env-display.ts`
- `.env.example`
- `docs/architecture/06-recording-transcription-pipeline.md`
- `docs/architecture/code-map.md`
- `docs/testing/validation-checklist.md`
- `docs/voximplant/yandex-deployment-runbook.md`
- `docs/audits/stage-3-9e-chunked-transcript-enhancement-implementation.md`
- `docs/audits/stage-3-9e-phase-2-enhancement-reliability.md`
