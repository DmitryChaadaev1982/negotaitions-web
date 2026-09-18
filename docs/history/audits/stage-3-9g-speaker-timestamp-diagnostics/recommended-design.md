# Recommended Design

## Immediate (low risk)
- UI-only: show sub-second precision (tenths), duration badge, and deterministic stable sort key (`startMs`, `endMs`, `orderIndex`).
- Keep DB/API contracts unchanged.

## Medium term
- Introduce canonical segmentation layer from provider words/utterances when available.
- Keep technical `speaker_N` immutable.
- Improve participant mapping as post-segmentation overlap scoring with explicit ambiguity/manual fallback.

## Long term
- Move to separate participant tracks (or true multi-channel ingest) for deterministic attribution.

