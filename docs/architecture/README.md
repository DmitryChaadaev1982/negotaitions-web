# Solution Architecture

This folder is the canonical architecture reference for the running NegotAItions solution on the current codebase.

## Canonical Current-State Architecture Docs

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
14. `email-delivery-foundation.md`
15. `account-security-email-flows.md`

These files are the authoritative current-state architecture truth and must be kept aligned with code changes.

## Historical / Reference / Source Docs

The following are preserved for traceability and implementation history. They are supporting context and are not canonical current-state truth:

- Older architecture audits and gap analyses (for example `docs/architecture/current-solution-audit.md`, `docs/architecture/session-flow-gap-analysis.md`).
- `docs/voximplant/*.md` stage notes and implementation records.
- `docs/deployment/*.md` deployment notes and historical rollout context.
- `docs/checkpoints/*.md` checkpoint snapshots.
- `docs/audits/**/*` and archived historical reports.
- Operational/testing notes that describe prior stages or one-off procedures.

## Canonical-First Rule

- Canonical current-state docs in this folder take precedence over historical/reference/source docs.
- Historical files are preserved and referenced, not deleted.
- If there is a conflict, validate against code and update canonical current-state docs.
