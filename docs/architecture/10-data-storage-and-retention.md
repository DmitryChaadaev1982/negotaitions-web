# 10 Data Storage And Retention

## Primary Data Stores

- PostgreSQL (application domain and runtime state).
- Object storage (recording objects and derived audio artifacts).
- Runtime process memory caches for connection lease behavior.

## Durable Database Data

- Business entities: cases, sessions, events, participants.
- Runtime artifacts: recordings, transcripts, transcript segments, AI analyses.
- Telemetry and diagnostics: audio activity, external service events, usage counters.

## Object/File Storage Behavior

- Recording files are referenced via `Recording.fileKey`.
- Transcription pipeline may upload compressed intermediates.
- Download links are generated as signed URLs via storage adapter.

## Retention/Artifact Boundaries

- Durable summaries remain in repository docs.
- Raw or high-volume generated artifacts should stay outside repo in project artifact storage.
- Historical report markdowns were moved to `docs/audits/archive/old-root-reports/` to remove root clutter while preserving history.

## Source Notes

- `prisma/schema.prisma`
- `lib/storage/s3.ts`
- `lib/services/transcription-runner.ts`
- `docs/operations/project-hygiene.md`
- `docs/decisions/ADR-2026-07-07-project-artifact-hygiene.md`
