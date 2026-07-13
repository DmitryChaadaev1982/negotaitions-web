# Future Implementation Prompt - Stage 3.9F Decisions

Implement only the validated outcomes from Stage 3.9F.

## Hard constraints

- Do not change provider stack (stay on SpeechKit + DeepSeek).
- Keep existing manual controls intact.
- Keep raw transcript recoverability invariant (`qualityText` canonical raw).
- No destructive DB/data operations.

## Selected target behavior

1. Raw STT remains:
   - model `general:rc`
   - language `ru-RU`
   - diarization enabled
   - normalization enabled
   - literature text enabled
2. Audio source strategy:
   - for SpeechKit transcription input, use full-length audio (original A preferred; processed-no-cut B acceptable).
   - do not feed pause-cut active-audio C to SpeechKit until pause-interval detection/cut policy is corrected and re-validated.
   - keep active-audio artifacts and pause map for diagnostics and non-ASR workflows.
3. Post-processing:
   - keep DeepSeek `deepseek-v4-flash` with Responses API JSON Schema (`v1`) as final enhancement layer.
   - do not add SpeechKit built-in LLM post-processing in production path.
4. Add automatic enhancement after successful automatic transcription.

## Required code areas

- `lib/services/transcription-runner.ts`
  - after successful automatic transcription persistence, trigger enhancement orchestration.
  - ensure enhancement failure does not flip transcription success.
- `lib/services/yandex-transcript-enhancement.ts`
  - keep existing logic; wire through orchestration entrypoint.
- `lib/services/transcript-enhancement-persistence.ts`
  - enforce:
    - `qualityText` remains raw canonical text
    - `text` updated only on successful enhancement persistence
- `app/api/sessions/[sessionId]/materials/status/route.ts`
  - expose clear enhancement state transitions for UI.
- Optional service helper:
  - introduce enhancement lease/idempotency helper for duplicate-run protection.

## Idempotency and safety requirements

- Prevent duplicate concurrent auto-enhancement runs for same transcript state.
- Suggested idempotency key: transcript ID + raw hash + enhancement mode/version.
- Manual re-enhancement must continue to work; if lock is active, return informative status.

## Status and UI requirements

- Distinguish:
  - transcription completed
  - enhancement running
  - enhancement completed
  - enhancement failed (raw transcript still available)
- Preserve existing manual buttons:
  - transcribe/re-transcribe
  - enhance/re-enhance
  - diagnostics

## Env changes (design only)

- Add `TRANSCRIPT_ENHANCEMENT_AUTO_RUN` (recommended default: `false` at first rollout).
- Keep existing enhancement env naming exactly as implemented:
  - `YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL`
  - `TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE`
- Keep SpeechKit env naming exactly as implemented:
  - `YANDEX_SPEECHKIT_MODEL`
  - `YANDEX_SPEECHKIT_LANGUAGE`
  - `YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING`
  - `YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED`
  - `YANDEX_SPEECHKIT_LITERATURE_TEXT`

### Local env instructions

- Add commented keys to `.env`/`.env.local` docs only; do not mutate values during rollout prep.
- Do not auto-enable in developer env without explicit operator action.

### Server env.production instructions

- Add key with default `false`.
- Enable gradually during canary after deploy and health checks.

## Deployment plan

1. Ship code with feature flag off.
2. Validate lint/tests + targeted e2e for transcription->enhancement orchestration.
3. Enable on canary.
4. Monitor:
   - enhancement success rate
   - duplicate-run prevention events
   - latency impact
5. Roll to full production after stable window.

## Rollback plan

- Set `TRANSCRIPT_ENHANCEMENT_AUTO_RUN=false`.
- Keep manual enhancement button active.
- No schema rollback expected.

## Test requirements

- Unit:
  - orchestration trigger behavior
  - idempotency guard
  - persistence invariants (`qualityText` vs `text`)
- Integration/e2e:
  - automatic transcription triggers enhancement
  - enhancement failure keeps transcription completed and raw visible
  - manual re-enhancement still works
  - duplicate trigger attempts are safely coalesced/rejected

## Telemetry cleanup requirements

1. Replace success-case `failureStage=integrity_validation` with:
   - `failureStage=null`, or
   - renamed field `lastValidationStage`
2. Split timing telemetry buckets:
   - transcription timing
   - automatic enhancement timing
   - manual enhancement timing

## Validation gates (mandatory)

- `npm run validate:fast`
- `npm run validate:deploy`
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`
- no changes outside intended files
- no secrets in logs/docs

