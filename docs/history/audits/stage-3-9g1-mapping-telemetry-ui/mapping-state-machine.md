# Mapping State Machine

## Persisted states found in code/schema/tests/UI

- `NOT_REQUIRED`
- `REQUIRED`
- `NEEDS_REVIEW`
- `PARTIALLY_MAPPED`
- `AUTO_SUGGESTED`
- `CONFIRMED`
- (`FAILED` appears in schema comment but no active writer in current mapping workflow code path)

## State semantics

- `NOT_REQUIRED`
  - no diarization or no labels;
  - mapping not needed; names may remain raw speaker labels.
- `REQUIRED`
  - diarization exists, mapping not complete/auto-unsafe with non-manual-review reason.
- `NEEDS_REVIEW`
  - manual review required due telemetry/safety reasons.
- `PARTIALLY_MAPPED`
  - some labels manually assigned, not all.
- `AUTO_SUGGESTED`
  - complete safe mapping auto-applied and persisted.
- `CONFIRMED`
  - facilitator confirmed complete mapping.

## Transition sources

- Initial transcription completion sets:
  - `REQUIRED` if diarization true;
  - `NEEDS_REVIEW` in specific single-speaker-only fallback;
  - `NOT_REQUIRED` without diarization.
- Auto-trigger mapping updates to:
  - `AUTO_SUGGESTED` (full apply),
  - or `REQUIRED` / `NEEDS_REVIEW` with diagnostics only.
- Manual save/confirm (`speaker-mapping` POST) uses `deriveSpeakerMappingStatus()`:
  - save complete -> `AUTO_SUGGESTED`;
  - save partial -> `PARTIALLY_MAPPED` (or keeps `NEEDS_REVIEW`);
  - confirm complete -> `CONFIRMED`;
  - confirm incomplete -> rejected (`400`) and status unchanged/derived non-confirmed.
- Manual attribution endpoint directly sets `CONFIRMED`.
- Re-transcription resets mapping status as part of new transcript run.

## UI behavior per state (facilitator)

- `REQUIRED` / `NEEDS_REVIEW`: review card/manual selectors visible; warnings displayed.
- `PARTIALLY_MAPPED`: selectors visible; confirmation unavailable until complete.
- `AUTO_SUGGESTED`: auto-applied note shown; names displayable; still editable later.
- `CONFIRMED`: confirmed badge/state; mapping considered ready for AI analysis.

