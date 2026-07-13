# Automatic Mapping Persistence

## Path summary

- Entry: `autoTriggerSpeakerMappingAfterTranscription(sessionId)`.
- Suggestion generation: `suggestSpeakerMapping()`.
- Decision: `decideAutoMappingApplication()` (+ safety + margin override checks).

## All-or-nothing behavior

- Yes for active persisted auto mapping:
  - if gates fail: `Transcript.speakerMapping` is explicitly cleared (`JsonNull`), no segment assignment writes;
  - if gates pass: complete label map persisted and segment rows updated.
- No partial automatic persistence of active mapping is implemented.

## Segment writes

- On apply, code loops mapped segments and updates each segment by id:
  - `mappedParticipantId`
  - `mappingSource = MIC_ACTIVITY`
  - `mappingConfidence` from label confidence
- Locked segments (`mappingLocked=true`) are skipped.

## Global mapping object

- Stored separately in `Transcript.speakerMapping` as cluster map.
- Segment rows still physically updated for display/readiness.

## Transactionality

- Apply path uses `prisma.$transaction` for transcript + segment writes.
- Non-apply path is a single transcript update.
- Status switches to `AUTO_SUGGESTED` only inside successful apply transaction.

## UI implications

- UI may show suggested prefill from diagnostics (`processingMetadata.mappingSuggestion`) when persisted mapping is empty (`REQUIRED`/`NEEDS_REVIEW`).
- This is suggestion view state, not confirmed mapping.
- Potential confusion is mitigated by separate state labels, but wording can still be interpreted as hard failure in some states (documented in UX problems).

