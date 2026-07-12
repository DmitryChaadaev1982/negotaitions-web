# Stage 3.9E Chunked Transcript Enhancement Implementation

Date: 2026-07-12  
Branch: `feat/stage-3-9e-chunked-transcript-enhancement`  
Base: `deploy/yandex-poc`

## Scope

Implemented Stage 3.9E Phase 1 reliability changes for transcript enhancement:

- explicit runtime mode (`single` vs `chunked`) with rollback-safe default;
- deterministic bounded chunking over ordered transcript segments;
- bounded concurrency, per-chunk timeout, transient retry;
- per-chunk partial fallback to original text;
- no-loss validation guards;
- richer processing metadata for observability;
- docs and tests for rollout and rollback.

No Yandex SpeechKit parameter changes, no provider switch, no audio pipeline changes, no schema migration, no historical backfill.

## Before -> After Architecture

### Before

- Enhancement request was single-shot for all segments.
- Any timeout or parser failure produced route-level `FAILED` for whole enhancement.
- No partial persistence of successful subset.
- Metadata had coarse status + error + duration.

### After

- `TRANSCRIPT_ENHANCEMENT_MODE=single|chunked`:
  - `single` keeps existing behavior for immediate rollback.
  - `chunked` executes deterministic chunk pipeline.
- Chunk pipeline:
  - deterministic chunk balancing from ordered segments;
  - read-only bounded neighbor context around targets;
  - strict target-index-only structured output;
  - per-chunk validation + fallback on failure.
- Merge and persistence:
  - merge strictly by original segment order;
  - apply validated chunk output where available;
  - fallback to original text for missing/failed chunk outputs;
  - preserve speaker/timestamps/mapping/ordering.
- Statuses:
  - `COMPLETED`, `PARTIAL`, `FAILED`, `SKIPPED`.

## Config

Added env/config readers and display support:

- `TRANSCRIPT_ENHANCEMENT_MODE` (default `single`);
- `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS` (default `6`);
- `TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS` (default `700`);
- `TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY` (default `4`);
- `TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS` (default `120000`);
- `TRANSCRIPT_ENHANCEMENT_MAX_RETRIES` (default `1`).

## No-Loss Guarantees Implemented

- unknown segment IDs rejected per chunk;
- duplicate IDs rejected per chunk;
- empty rewrite of non-empty source rejected;
- catastrophic shrink guard rejects aggressive truncation;
- missing target IDs automatically fallback to original;
- merge preserves original segment count and order by canonical input list;
- speaker/timestamp/mapping fields are never accepted from model output.

## Files Changed

- `lib/env.ts`
- `lib/services/admin-env-display.ts`
- `lib/services/yandex-transcript-enhancement.ts`
- `app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `lib/services/yandex-speechkit-transcription.ts`
- `.env.example`
- `lib/env.transcript-enhancement.test.ts`
- `lib/services/yandex-transcript-enhancement.test.ts`
- `docs/architecture/code-map.md`
- `docs/architecture/06-recording-transcription-pipeline.md`
- `docs/testing/validation-checklist.md`
- `docs/voximplant/env-checklist.md`
- `docs/voximplant/yandex-deployment-runbook.md`

## Rollout Procedure

1. Deploy code with `TRANSCRIPT_ENHANCEMENT_MODE=single`.
2. Verify service health.
3. Enable chunked mode in server env:
   - `TRANSCRIPT_ENHANCEMENT_MODE=chunked`
4. Restart service.
5. Run one controlled new session enhancement.
6. Inspect `processingMetadata.transcriptEnhancement`:
   - overall status;
   - per-chunk status/latency/retries;
   - fallback counts.
7. Compare original vs enhanced transcript for semantic drift.

## Rollback Procedure

1. Set `TRANSCRIPT_ENHANCEMENT_MODE=single`.
2. Restart service.
3. Re-run controlled enhancement on new session and verify normal behavior.

## Validation

Mandatory gates and targeted tests are run in task execution and reported with pass/fail in final summary.

## Residual Risks

- Prompt-bound conservative correction still depends on model behavior; fallback guards reduce risk but cannot guarantee linguistic quality improvements.
- Chunk latency can vary by content despite bounded input; observability now surfaces this for tuning.
- Inline SpeechKit enhancement path remains disabled in normal runtime but now follows same status/fallback semantics if forced.

## Stage 3.9E Persistence Safety Review Addendum

### Canonical storage before enhancement

- Provider transcription is first persisted by `lib/services/transcription-runner.ts`:
  - full transcript: `Transcript.text`, `Transcript.diarizedText`;
  - per-segment transcript: `TranscriptSegment.text`;
  - provider forensic artifact: bounded/sanitized `processingMetadata.rawProviderSnapshot`.

### What enhancement overwrites

- `app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts` updates:
  - `Transcript.text` and `Transcript.diarizedText` for `COMPLETED` and `PARTIAL`;
  - `TranscriptSegment.text` for `COMPLETED` and `PARTIAL`;
  - `processingMetadata.transcriptEnhancement.*` status/telemetry.

### No-loss correction implemented (no migration)

- Reused existing field `TranscriptSegment.qualityText` as immutable original-text backup for enhancement persistence:
  - on the first successful enhancement write, segment update now stores:
    - `text`: enhanced/fallback text,
    - `qualityText`: `qualityText ?? original segment text`.
  - on later enhancement reruns, existing `qualityText` is preserved.
- Manual re-enhancement input now always starts from preserved provider text:
  - route input uses `originalText = segment.qualityText ?? segment.text`;
  - this prevents recursive enhancement of prior AI output whenever backup exists.
- This avoids schema changes and avoids duplicating full transcript payloads into metadata.

### Recovery path

- Original per-segment provider text is recoverable from `TranscriptSegment.qualityText`.
- Original full transcript is recoverable by concatenating ordered segments using `qualityText` (with existing speaker/timestamp fields if diarized rendering is needed).
- `TRANSCRIPT_ENHANCEMENT_MODE=single|chunked` is runtime behavior only; it does not roll back already persisted enhanced text.

### UI semantics

- Transcript/materials UI reads canonical persisted text only (`Transcript.text`, `Transcript.diarizedText`, `TranscriptSegment.text`).
- UI currently has no dedicated side-by-side original-vs-enhanced presentation.
