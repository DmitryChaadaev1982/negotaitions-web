# Automatic Mapping Algorithm

## Inputs

- Transcript segments with `speakerLabel`, `startSeconds`, `endSeconds`.
- Distinct speaker labels from transcript.
- Participant pool (prefers `PARTICIPANT` roles, excludes `OBSERVER`).
- Activity intervals from `SessionParticipantAudioActivity` (remote/local sources).
- Recording window and pause timeline metadata.
- Existing `processingMetadata` (for mapping mode detection).

## Mapping unit

- Core assignment is label-level (`speakerLabel -> participantId`), not segment-level.
- Segment-level writes are derived from label mapping when auto-apply is allowed.

## Candidate generation and scoring

1. Build per-source normalized intervals per participant.
2. Build speaker/participant overlap score matrix (`coverage = overlap / speakerDuration`).
3. Compute one-to-one best assignment via exhaustive recursion (`selectOneToOneMappingFromScoreMatrix`).
4. Per-label confidence = selected coverage; margin = selected coverage minus runner-up.
5. Compute global assignment margin (best vs second-best assignment totals) for 2x2 override path.

## Handling special conditions

- Simultaneous activity contributes overlap to whichever participant interval overlaps segment window.
- No activity / unusable offsets -> unavailable reasons.
- Missing telemetry or imbalance -> warnings and review-required outcomes.
- Safety check rejects many-to-one in multi-participant sessions.
- Speakers > participants blocks auto-apply.

## Thresholds / constraints

- `AUTO_MAPPING_HIGH_CONFIDENCE = 0.6`
- `AUTO_MAPPING_MIN_MARGIN = 0.12`
- Global margin override only in strict 2x2 conditions:
  - `AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD = 0.2`
  - minimum selected coverage per label `0.12`
  - no blocking warnings, participant coverage >=2, etc.

## One-to-one rules

- Assignment search itself is one-to-one.
- Safety layer additionally blocks collapsed many-to-one outcomes for auto-apply.

## Output types

- Always produces diagnostics (`mappingSuggestion`) when attempted.
- May produce candidate suggestion without persistence (`REQUIRED`/`NEEDS_REVIEW`).
- Produces persisted mapping + segment assignments only when all auto-apply gates pass.
- Never auto-confirms as `CONFIRMED`; successful auto path is `AUTO_SUGGESTED`.

## Required answers

- Auto-apply eligibility requires: compatible counts, all labels covered, high/effective confidence, non-weak margin, mapping safety safe, no blocking telemetry warnings, enough active participants (>=2), usable offsets.
- `REQUIRED`/equivalent is produced when no/partial mapping or insufficient confidence/coverage/margin without telemetry-quality manual-review classification.
- Failure-like states in UI are derived from `REQUIRED`/`NEEDS_REVIEW` plus diagnostics reason mapping.
- Partial automatic persistence does not exist for active mapping:
  - candidate may be partial in diagnostics;
  - persisted `Transcript.speakerMapping` is set to `JsonNull` when not auto-applied.
- Auto-applying one label and leaving another unresolved is not supported in persistence path.

