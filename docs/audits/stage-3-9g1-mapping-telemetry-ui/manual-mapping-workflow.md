# Manual Mapping Workflow

## Facilitator interaction

- Facilitator selects a participant for each detected technical speaker label (`speaker_1`, `speaker_2`, ...).
- Main endpoint: `POST /api/sessions/[sessionId]/speaker-mapping`.
- Optional fallback mode: `POST /api/sessions/[sessionId]/manual-speaker-attribution` for diarization failure scenarios.

## Cluster mapping behavior

- Default manual assignment is label/global:
  - assign once per label;
  - propagated to all segments carrying that label.
- Speaker labels are independently editable (`speaker_1` and `speaker_2` can be mapped separately).
- Partial save is allowed and persisted (`PARTIALLY_MAPPED` or `NEEDS_REVIEW`).
- Confirmation requires all detected labels assigned; incomplete confirm returns `400`.

## Segment override behavior

- Segment-level divergence is possible via `mappingLocked` and manual segment override flows.
- Cluster mapping respects locked segments unless `forceOverrideLocked=true`.
- Therefore one segment can remain different from other same-label segments.

## Overwrite precedence

- Manual save writes `Transcript.speakerMapping` and segment assignments, replacing prior auto suggestion.
- Manual confirm writes confirmation metadata and final status `CONFIRMED`.
- Previous mapping failure messaging is effectively suppressed after confirmed/auto-suggested status because warning rendering is status-driven.

## Refresh / re-transcription / enhancement

- Refresh: mapping draft sync keeps local edits when dirty and transcript id unchanged (`speaker-mapping-draft-sync`).
- Re-transcription success: new transcript run resets mapping workflow and segment set.
- Re-transcription failure: archived prior mapping/text can be restored.
- DeepSeek re-enhancement changes text only; mapping fields remain intact.

## Participant/role changes

- Mapping stores participant ids; display labels resolve via current participant list.
- If participant metadata changes, rendered names can change while mapping id linkage remains.

