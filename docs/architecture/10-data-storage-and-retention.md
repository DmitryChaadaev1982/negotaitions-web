# 10 Data Storage And Retention

## Primary Data Stores

- PostgreSQL (application domain and runtime state).
- Object storage (recording objects and derived audio artifacts).
- Runtime process memory caches for connection lease behavior.

## Durable Database Data

- Business entities: cases, sessions, events, participants.
- Runtime artifacts: recordings, transcripts, transcript segments, AI analyses.
  `AiAnalysis.inputFingerprint` is a nullable SHA-256 of the canonical
  material AI-input envelope. For new analysis runs it is the prompted
  snapshot. Historical rows may remain `NULL` and are not bulk-backfilled.
  A facilitator material write may bind a still-legacy-current NULL row to
  the pre-mutation envelope hash so later currentness can detect
  same-generation lexical/mapping edits. That bound value is a PT-22
  compatibility baseline (the last snapshot already treated as current),
  not proven original model input. The column is additive; absence of the
  column is schema drift, not a historical-NULL row, and 500s all
  `materials/status` reads.
- AI publication snapshots: `AiAnalysisPublication` persists an immutable
  sanitized shared artifact for one analysis version/publication epoch;
  `AiAnalysisPublicationGrant` persists its per-recipient account,
  `SessionParticipant`, maximum projection, and revocation state. Grants are
  created from historical Session room-shell entry (including first authorized
  `/room` claim after Publish) and revoked with the publication epoch; they
  are not a snapshot of who was online at Publish and do not require a
  confirmed Vox/media connection. Full AI output remains singular on `AiAnalysis`
  and is never duplicated per recipient.
- Telemetry and diagnostics: audio activity, external service events, usage counters.

## Object/File Storage Behavior

- Recording files are referenced via `Recording.fileKey`.
- Transcription pipeline may upload compressed intermediates.
- Download links are generated as signed URLs via storage adapter.
- `Recording.status = COMPLETED` remains historical lifecycle truth even if
  the physical object is later absent. `Recording.fileKey` is retained as
  historical reference after the object disappears. Retranscription must
  download source bytes before any generation or publication mutation. A
  missing object is `SOURCE_RECORDING_NOT_AVAILABLE` and does not invalidate
  or delete saved transcript, diarization, speaker mapping, AI analysis,
  publication, notes, or Recording COMPLETED history.
- Physical recording retention is independent from historical application
  material. Object absence (lifecycle expiration, operator delete, or any
  other storage miss) is not itself a materials rewind.

## Dedicated recording bucket and operator lifecycle

- `negotiations-recordings-dev-bucket` is dedicated to recording and
  audio-artifact objects.
- Physical objects keep existing provider/application key formats
  (`negotiation-room/audio/`, `voximplant/audio/`,
  `recordings/{sessionId}/…` intermediates). The key namespace is not
  normalized into `recordings/raw/`.
- Application runtime does not change Vox `recordNamePrefix`, rewrite
  historical object keys, copy/move/rename stored objects, or migrate
  `Recording.fileKey` values.
- Target Yandex Object Storage lifecycle (operator/cloud configuration,
  not application runtime code):
  - scope: all objects in `negotiations-recordings-dev-bucket`;
  - expiration: 90 days;
  - no prefix filter;
  - this **replaces** any older prefix-specific 14-day rule rather than
    coexisting with it.
- Lifecycle apply/replace is an operator Yandex Cloud action. The
  application does not call storage lifecycle APIs and must not add
  prefix-dependent expiration behavior.

## Retention/Artifact Boundaries

- Durable summaries remain in repository docs.
- Raw or high-volume generated artifacts should stay outside repo in project artifact storage.
- Historical report markdowns were moved to `docs/audits/archive/old-root-reports/` to remove root clutter while preserving history.
- The application does not enforce calendar retention for accounts,
  sessions, transcripts, speaker mapping, AI analyses, or publication
  rows. Those remain until an explicit product or support process
  changes them.
- Physical objects in the dedicated recording bucket are subject to the
  operator-managed 90-day bucket-wide expiration above. That cloud
  policy is not an application-enforced materials purge.
- Account-deletion requests are support-operated. The approved model is a
  controlled combination of deletion and anonymization, documented in
  `docs/operations/personal-data-erasure-runbook.md`. That runbook is not a
  user-facing product function and does not authorize unreviewed destructive
  SQL.

## Source Notes

- `prisma/schema.prisma`
- `lib/storage/s3.ts`
- `lib/storage/recording-file-key.ts`
- `lib/services/transcription-runner.ts`
- `lib/services/source-recording-preload.ts`
- `lib/services/source-recording-not-available.ts`
- `docs/operations/project-hygiene.md`
- `docs/operations/personal-data-erasure-runbook.md`
- `docs/decisions/ADR-2026-07-07-project-artifact-hygiene.md`
