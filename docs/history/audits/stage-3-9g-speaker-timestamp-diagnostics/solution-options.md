# Solution Options

## Option 1: UI precision only
- Safe immediate improvement; fixes readability artifacts and overlap perception inflation.
- Does not change persisted data or mapping semantics.

## Option 2: Preserve provider utterances
- Helpful only if full raw utterance stream is persisted and trusted; currently DB metadata snapshot is truncated/sampled.

## Option 3: Word-level resegmentation
- Viable medium term only if full word timestamps are durably retained.
- Better turn readability and less overlap inflation if segmentation rules are deterministic.

## Option 4: Activity-aware label mapping
- Keep transcript text/timestamps untouched.
- Improve mapping confidence with explicit ambiguity gating and manual confirmation.

## Option 5: Activity-aware splitting
- Risky if done without deterministic word allocation; do not split text by activity alone.

## Option 6: Activity as primary attribution
- Not safe yet due overlap/simultaneity and telemetry ambiguity in mixed mono context.

## Option 7: Separate participant tracks
- Strong long-term reliability path; decouples diarization from mixed mono constraints.

## Option 8: Multi-channel SpeechKit
- Assess only with confirmed provider capability + actual multi-channel capture availability.

