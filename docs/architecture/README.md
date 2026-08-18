# Solution Architecture

This folder is the canonical architecture reference for the running NegotAItions solution on the current codebase.

## Task-Directed Current-State Map

Choose the smallest set of documents that covers the affected domain; do not
load stage history as default context.

| Domain | Read first | Read when needed |
| --- | --- | --- |
| Product, cases, Events, Sessions, Dashboard, Archive | `01-product-context.md`, `02-domain-model.md`, `04-session-event-flow.md` | `code-map.md` |
    | Public website, homepage, public/app chrome, public indexing, SEO, Metrica | `13-public-site-and-content.md`, `03-application-architecture.md` | `09-security-and-access-control.md`, `docs/operations/public-site-seo-and-analytics.md` |
| Room lifecycle, room access, facilitator control, presence | `04-session-event-flow.md`, `09-security-and-access-control.md` | `05-voximplant-integration.md` |
| Room media and provider integration | `05-voximplant-integration.md` | `04-session-event-flow.md`, `11-deployment-architecture.md` |
| Recording, materials freshness, transcription, enhancement | `06-recording-transcription-pipeline.md` | `07-speaker-mapping-and-telemetry.md`, `10-data-storage-and-retention.md` |
| Speaker mapping and operational observability | `07-speaker-mapping-and-telemetry.md` | `12-external-systems.md` |
| AI analysis, publication, recipient privacy, debrief | `08-ai-analysis-and-debrief.md` | `09-security-and-access-control.md`, `04-session-event-flow.md` |
| Accounts, email, roles, authorization | `09-security-and-access-control.md`, `account-security-email-flows.md` | `email-delivery-foundation.md`, `email-runtime-and-yandex-cloud.md` |
| Data retention and database changes | `10-data-storage-and-retention.md` | `02-domain-model.md`, `11-deployment-architecture.md`, `docs/operations/personal-data-erasure-runbook.md` |
| Deployment and external services | `11-deployment-architecture.md`, `12-external-systems.md` | `docs/operations/deployment-runbook.md` |
| Test selection and E2E fixtures | `docs/testing/validation-checklist.md`, `docs/testing/e2e-strategy.md` | `docs/testing/observer-test-execution-policy.md` |

Read `code-map.md` before changing source and follow its linked document/test
entries.

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
16. `email-runtime-and-yandex-cloud.md`
17. `13-public-site-and-content.md`

These files are the authoritative current-state architecture truth and must be kept aligned with code changes.

Cross-document ownership for current shared runtime flows:

- Session negotiation, role-agnostic room occupancy, Debrief grace, and
  canonical final Session close are owned by `04-session-event-flow.md`.
- Voximplant exact-attempt control/status reconciliation is owned by
  `05-voximplant-integration.md`; its S3/CAS and UI pipeline consequences are
  owned by `06-recording-transcription-pipeline.md`.
- Runtime permission and rollout requirements for those services are owned by
  `11-deployment-architecture.md`.

## Historical / Reference / Source Docs

The following are preserved for traceability and implementation history. They are supporting context and are not canonical current-state truth:

- Older architecture audits and gap analyses (for example `docs/architecture/current-solution-audit.md`, `docs/architecture/session-flow-gap-analysis.md`).
- `docs/voximplant/*.md` stage notes and implementation records.
- `docs/deployment/*.md` deployment notes and historical rollout context.
- `docs/checkpoints/*.md` checkpoint snapshots.
- `docs/audits/**/*` and archived historical reports.
- Operational/testing notes that describe prior stages or one-off procedures.

Stage-labelled documents under `docs/architecture/`, `docs/implementation/`,
`docs/audits/`, `docs/voximplant/`, and `docs/releases/` are historical unless
they are explicitly listed in the task-directed map above. They can explain why
a decision was made, but never override the current-state documents.

## Canonical-First Rule

- Canonical current-state docs in this folder take precedence over historical/reference/source docs.
- Historical files are preserved and referenced, not deleted.
- If there is a conflict, validate against code and update canonical current-state docs.
