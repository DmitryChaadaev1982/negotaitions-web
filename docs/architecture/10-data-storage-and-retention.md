# 10 Data Storage And Retention

## Primary Data Stores

- PostgreSQL (application domain and runtime state).
- Object storage (recording objects and derived audio artifacts).
- Runtime process memory caches for connection lease behavior.

## Durable Database Data

- Business entities: cases, sessions, events, participants.
- Runtime artifacts: recordings, transcripts, transcript segments, AI analyses.
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

## Retention/Artifact Boundaries

- Durable summaries remain in repository docs.
- Raw or high-volume generated artifacts should stay outside repo in project artifact storage.
- Historical report markdowns were moved to `docs/audits/archive/old-root-reports/` to remove root clutter while preserving history.
- The product does not currently enforce fixed retention periods for accounts,
  sessions, recordings, transcripts, or AI analyses.
- Account-deletion requests are support-operated. The approved model is a
  controlled combination of deletion and anonymization, documented in
  `docs/operations/personal-data-erasure-runbook.md`. That runbook is not a
  user-facing product function and does not authorize unreviewed destructive
  SQL.

## Source Notes

- `prisma/schema.prisma`
- `lib/storage/s3.ts`
- `lib/services/transcription-runner.ts`
- `docs/operations/project-hygiene.md`
- `docs/operations/personal-data-erasure-runbook.md`
- `docs/decisions/ADR-2026-07-07-project-artifact-hygiene.md`
