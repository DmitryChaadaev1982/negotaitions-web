# Solution Architecture

This folder holds the canonical architecture reference for the running
NegotAItions solution on the current codebase, plus navigation and
accepted decision records that live next to it.

Documentation ownership: [`docs/DOCUMENTATION-GOVERNANCE.md`](../DOCUMENTATION-GOVERNANCE.md).
Start hub: [`docs/README.md`](../README.md).
Requirements: [`docs/requirements/PRODUCT-REQUIREMENTS.md`](../requirements/PRODUCT-REQUIREMENTS.md).

## Authority in this folder

The same six roles are used in `docs/README.md` and
`DOCUMENTATION-GOVERNANCE.md`.

| Role | In this folder |
| --- | --- |
| **A. Current architecture contract** | Numbered chapters `01`–`13` plus the email chapters listed below. These define current implemented behavior, structure, state, flows, authority, integration, and operational architecture. |
| **B. Current product requirement contract** | Not in this folder. See `docs/requirements/`. |
| **C. Navigation / traceability** | This README and `code-map.md`. They map domains to documents, modules, and tests. They do not redefine behavior. |
| **D. Accepted decision rationale** | `adr/`. ADRs explain **why** a decision was made. They do **not** override the current architecture contract or the current product requirement contract. |
| **E. Current supporting material** | Not in this folder except by link. |
| **F. Historical non-authoritative material** | Not in this folder. See [`docs/history/`](../history/README.md). |

Current implementation does not automatically redefine a product
requirement. If architecture (A) and requirements (B) diverge, keep B and
record the conflict in `docs/FINDINGS.md`.

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
| Accounts, email, roles, authorization | `09-security-and-access-control.md`, `account-security-email-flows.md` | `email-delivery-foundation.md`, `email-runtime-and-yandex-cloud.md`, `email-retention-suppression.md` |
| Data retention and database changes | `10-data-storage-and-retention.md` | `02-domain-model.md`, `11-deployment-architecture.md`, `docs/operations/personal-data-erasure-runbook.md` |
| Deployment and external services | `11-deployment-architecture.md`, `12-external-systems.md` | `docs/operations/deployment-runbook.md` |
| Test selection and E2E fixtures | `docs/testing/validation-checklist.md`, `docs/testing/e2e-strategy.md` | `docs/testing/observer-test-execution-policy.md` |
| Engineering workflow, evals, validation ladder | `docs/testing/engineering-workflow.md`, `docs/testing/validation-checklist.md` | `docs/testing/eval-registry.json` (`npm run eval:registry:check`), `.cursor/skills/validate-wave/SKILL.md`, `docs/testing/agent-model-routing.md`, `docs/requirements/QUALITY-AND-ACCEPTANCE.md` |

Read `code-map.md` before changing source and follow its linked document/test
entries.

## Current architecture contract (role A)

These files are the current implemented architecture. Keep them aligned with
code changes.

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
13. `13-public-site-and-content.md`
14. `email-delivery-foundation.md`
15. `account-security-email-flows.md`
16. `email-runtime-and-yandex-cloud.md`
17. `email-retention-suppression.md`

Cross-document ownership for current shared runtime flows:

- Session negotiation, role-agnostic room occupancy, Debrief grace, and
  canonical final Session close are owned by `04-session-event-flow.md`.
- Voximplant exact-attempt control/status reconciliation is owned by
  `05-voximplant-integration.md`; its S3/CAS and UI pipeline consequences are
  owned by `06-recording-transcription-pipeline.md`.
- Runtime permission and rollout requirements for those services are owned by
  `11-deployment-architecture.md`.

## Navigation / traceability (role C)

- This README
- `code-map.md` — maps architecture chapters to modules, routes, and tests.
  It does not redefine behavior.

## Accepted decision rationale (role D)

- `adr/0001-email-provider-and-template-foundation.md`

ADRs explain why a choice was made. Current architecture chapters own the
implemented contract. Product requirements own intended contracts.

## Historical / Reference / Source Docs

Preserved under [`docs/history/`](../history/README.md). They are supporting
context and are not canonical current-state truth:

- Older architecture audits and gap analyses
- Voximplant stage notes (scenario JavaScript remains in `docs/voximplant/`)
- Deployment POC notes and historical rollout context
- Checkpoints, handoffs, releases
- Audits and archived reports
- Stage-labelled requirement manifests

They can explain why a decision was made, but never override the current
architecture contract or the current product requirement contract.

## Canonical-First Rule

- Role A documents in this folder take precedence over historical
  documents (role F).
- Historical files are preserved and referenced, not deleted, unless they have
  zero unique knowledge.
- If there is a conflict, validate against code, update canonical architecture
  when the implementation is the subject, and record unresolved requirement
  conflicts in `docs/FINDINGS.md`. Do not silently rewrite a requirement to
  match current code.
