# Mapping Persistence Model

## Prisma persistence surfaces

- `Transcript.speakerMapping` (`Json?`): global map `speakerLabel -> sessionParticipantId|null`.
- `Transcript.speakerMappingStatus` (`String`): workflow status (`NOT_REQUIRED | REQUIRED | AUTO_SUGGESTED | CONFIRMED | NEEDS_REVIEW | PARTIALLY_MAPPED | FAILED` comment in schema).
- `Transcript.speakerMappingConfirmedAt`, `Transcript.speakerMappingConfirmedBy`: confirmation metadata.
- `Transcript.processingMetadata`: stores `mappingSuggestion` diagnostics and candidate details.
- `TranscriptSegment.speakerLabel`: technical ASR label (for example `speaker_1`).
- `TranscriptSegment.mappedParticipantId`: physical segment-level assignment.
- `TranscriptSegment.mappingSource`, `mappingConfidence`, `mappingLocked`: provenance/confidence/overwrite guard.
- No separate mapping table/model exists.

Evidence: `prisma/schema.prisma`, models `Transcript`, `TranscriptSegment`.

## Application types

- `SpeakerMapping = Record<string, string | null>` in `lib/transcription/speaker-labels.ts`.
- UI resolver uses persisted mapping first, then safe suggestion prefill in `resolveSpeakerMappingForUi()` (`lib/transcription/speaker-mapping-state.ts`).

## Read path

- `GET /api/sessions/[sessionId]/speaker-mapping`:
  - reads transcript + segments;
  - uses `resolveSpeakerMappingForUi()`;
  - emits detected labels and mapped/suggested participant ids.
- `GET /api/sessions/[sessionId]/recording` and `GET /api/sessions/[sessionId]/materials/status`:
  - expose status/failure diagnostics derived from `speakerMappingStatus` + `processingMetadata`.

## Write paths

### Automatic path

- `autoTriggerSpeakerMappingAfterTranscription()` (`lib/transcription/auto-trigger-mapping.ts`):
  - computes suggestion;
  - if non-applicable: writes `Transcript.speakerMapping = JsonNull`, status `REQUIRED` or `NEEDS_REVIEW`, stores diagnostics in `processingMetadata.mappingSuggestion`;
  - if applicable: transaction writes `Transcript.speakerMapping`, status `AUTO_SUGGESTED`, diarized text, diagnostics; updates each matching segment (`mappedParticipantId`, `mappingSource=MIC_ACTIVITY`, `mappingConfidence`) unless `mappingLocked=true`.

### Manual cluster mapping path

- `POST /api/sessions/[sessionId]/speaker-mapping`:
  - validates facilitator and mapping payload;
  - computes status via `deriveSpeakerMappingStatus()`;
  - transaction updates `Transcript.speakerMapping`, status, confirmation fields;
  - iterates mapped segments and updates `mappedParticipantId`, `mappingSource=CLUSTER_MAPPING`, clears `mappingLocked`; skips locked segments unless `forceOverrideLocked=true`.

### Manual attribution path (fallback mode)

- `POST /api/sessions/[sessionId]/manual-speaker-attribution`:
  - upserts transcript as `source=MANUAL`, `speakerMappingStatus=CONFIRMED`;
  - rebuilds all segments with direct `mappedParticipantId`;
  - creates synthetic labels `manual_speaker_n`.

## Transaction boundaries

- Manual mapping (`speaker-mapping` POST): single `prisma.$transaction`.
- Auto-apply (`auto-trigger`): single `prisma.$transaction` only when applied.
- Non-applied auto suggestion: single transcript update (no segment updates).
- Manual attribution: single `prisma.$transaction`.
- Transcription persist + segment recreate: single `prisma.$transaction` in `runRealTranscription()`.

## Update predicates

- Cluster apply loops by `orderIndex` lookup; update by segment `id`.
- Lock guard: `if (dbSegment.mappingLocked && !forceOverrideLocked) continue` (manual) and `if (dbSegment.mappingLocked) continue` (auto).
- Re-transcription replaces segment set (`deleteMany` + `createMany`) and resets transcript mapping fields to fresh state; failed re-transcription can restore archived prior mapping snapshot.

## Direct answers (Part A)

1. Technical speaker label is stored in `TranscriptSegment.speakerLabel`.
2. Participant mapping is stored in both `Transcript.speakerMapping` (global by label) and `TranscriptSegment.mappedParticipantId` (physical per segment).
3. Mapping is persisted in more than one place: transcript JSON, segment rows, and diagnostics in `processingMetadata.mappingSuggestion`.
4. Same label with different mapped participants is technically possible because assignment is physically per segment.
5. Same-label mixed mapped/unmapped segments are also technically possible.
6. This mixed state is intentionally supported via `mappingLocked` and manual segment override flows, even though default cluster workflows try to keep labels consistent.
7. Assignment is physically persisted on segments; not only derived at read time.
8. Manual cluster assignment updates all matching label segments by default (subject to lock guard), and also updates global mapping JSON.
9. Automatic and manual both write transcript-level mapping/status; segment update metadata differs (`MIC_ACTIVITY` vs `CLUSTER_MAPPING`).
10. Successful re-transcription resets mapping to fresh state; failure path restores archived prior mapping.
11. DeepSeek enhancement updates only text fields (`text`, `qualityText`) and keeps mapping fields untouched.

