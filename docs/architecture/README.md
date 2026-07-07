# Solution Architecture

This folder is the canonical architecture reference for the running NegotAItions solution on the current codebase.

## Canonical Chapters

1. `01-product-context.md`
2. `02-domain-model.md`
3. `03-application-architecture.md`
4. `04-session-event-flow.md`
5. `05-voximplant-integration.md`
6. `06-recording-transcription-pipeline.md`
7. `07-speaker-mapping-and-telemetry.md`
8. `08-ai-analysis-and-debrief.md`
9. `09-security-and-access-control.md`
10. `10-data-storage-and-retention.md`
11. `11-deployment-architecture.md`
12. `12-external-systems.md`
13. `code-map.md`

## Inventory Classification (Current Repository Docs)

- Canonical architecture:
  - `docs/architecture/current-solution-audit.md`
  - `docs/architecture/session-flow-gap-analysis.md`
  - `docs/voximplant/*.md` (implementation and stage docs)
  - `docs/deployment/*.md`
- Operations/runbook:
  - `docs/operations/project-hygiene.md`
  - `docs/voximplant/yandex-deployment-runbook.md`
  - `docs/deployment/yandex-poc-server-parameters.md`
- Testing:
  - `docs/testing/yandex-poc-smoke-regression-plan.md`
  - root historical reports `TEST_PLAN.md`, `TEST_RESULTS.md`
- Audit/report/history:
  - `docs/audit/*.md`, `docs/audits/*.md`, `docs/checkpoints/*.md`
  - root historical audit reports moved to `docs/audits/archive/old-root-reports/`
- Agent instruction:
  - `AGENTS.md`, `CLAUDE.md`
- Stale/unclear candidates:
  - Stage-specific historical Voximplant docs in `docs/voximplant/` and some `docs/checkpoints/` items (keep for historical traceability, do not treat as canonical runtime truth without revalidation).

## Canonical-First Rule

- These chapter files are authoritative over older scattered reports.
- Historical files are preserved and referenced, not deleted.
- If there is a conflict, validate against code and update canonical chapters.
