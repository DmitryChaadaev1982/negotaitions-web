# NegotAItions documentation

Start here. This hub distinguishes **authoritative current documents** from
**historical** material.

Governance owner: [`DOCUMENTATION-GOVERNANCE.md`](DOCUMENTATION-GOVERNANCE.md).

## Where to start

Read this hub, then the rows for the task. Each row is navigation. The
linked document owns the rule.

| Task | Canonical document |
| --- | --- |
| Product requirements | [`requirements/PRODUCT-REQUIREMENTS.md`](requirements/PRODUCT-REQUIREMENTS.md) |
| Quality and acceptance | [`requirements/QUALITY-AND-ACCEPTANCE.md`](requirements/QUALITY-AND-ACCEPTANCE.md) |
| System / application architecture | [`architecture/README.md`](architecture/README.md) |
| Security / auth / account | [`architecture/09-security-and-access-control.md`](architecture/09-security-and-access-control.md), [`architecture/account-security-email-flows.md`](architecture/account-security-email-flows.md) |
| Database / Prisma / migrations | [`architecture/10-data-storage-and-retention.md`](architecture/10-data-storage-and-retention.md), [`architecture/11-deployment-architecture.md`](architecture/11-deployment-architecture.md) |
| Email / durable outbox | [`architecture/email-delivery-foundation.md`](architecture/email-delivery-foundation.md), [`architecture/account-security-email-flows.md`](architecture/account-security-email-flows.md), [`architecture/email-runtime-and-yandex-cloud.md`](architecture/email-runtime-and-yandex-cloud.md) |
| Deploy / release / recovery | [`operations/deployment-runbook.md`](operations/deployment-runbook.md), [`architecture/11-deployment-architecture.md`](architecture/11-deployment-architecture.md) |
| Environment / config | [`architecture/11-deployment-architecture.md`](architecture/11-deployment-architecture.md), [`architecture/email-runtime-and-yandex-cloud.md`](architecture/email-runtime-and-yandex-cloud.md) |
| Code ownership | [`architecture/code-map.md`](architecture/code-map.md) |
| Engineering / agent working contract | [`testing/engineering-workflow.md`](testing/engineering-workflow.md) |
| Documentation ownership | [`DOCUMENTATION-GOVERNANCE.md`](DOCUMENTATION-GOVERNANCE.md) |

Native engineering routing is [`AGENTS.md`](../AGENTS.md). It points here.
It is not a second documentation owner. Temporary investigation notes and
untracked local helpers are not canonical.

## Authority model

Every current document has exactly one of these roles. The same semantics
are used in `DOCUMENTATION-GOVERNANCE.md` and `architecture/README.md`.

| Role | What it is | Canonical location |
| --- | --- | --- |
| **A. Current architecture contract** | Current implemented system behavior, structure, state, flows, authority, integration, and operational architecture | Numbered `architecture/01-*.md`–`13-*.md` plus the email chapters listed in `architecture/README.md` |
| **B. Current product requirement contract** | Active intended product and quality requirements | `requirements/PRODUCT-REQUIREMENTS.md`, `requirements/QUALITY-AND-ACCEPTANCE.md` |
| **C. Navigation / traceability** | Maps requirements, architecture, code, and tests. Does not redefine behavior | This file, `architecture/README.md`, `architecture/code-map.md`, `DOCUMENTATION-GOVERNANCE.md` |
| **D. Accepted decision rationale** | Explains **why** a decision was made. Does **not** override A or B | `decisions/`, `architecture/adr/` |
| **E. Current supporting material** | Operations, testing, engineering change governance, branding, unresolved findings, agent routing | `operations/`, `testing/` (`engineering-workflow.md` owns change governance), `branding/`, `voximplant/` (scenario JS is a runtime artifact), `FINDINGS.md`, `AGENTS.md` |
| **F. Historical non-authoritative material** | Provenance only. Never required reading for current architecture | `history/**` |

Current implementation does not automatically redefine a product
requirement. When A and B diverge, keep B and record the conflict in
`FINDINGS.md`.

## Authoritative now

| Need | Role | Read |
| --- | --- | --- |
| Active requirements | B | `requirements/PRODUCT-REQUIREMENTS.md` |
| Quality/acceptance, validation commands | B / E | `requirements/QUALITY-AND-ACCEPTANCE.md`, `testing/validation-checklist.md` |
| Current architecture | A | Numbered `architecture/01-*.md` through `13-*.md` plus email chapters in `architecture/README.md` |
| Code ↔ docs ↔ tests | C | `architecture/code-map.md` |
| Why a past decision was made | D | `decisions/`, `architecture/adr/` |
| Security/authorization | A | `architecture/09-security-and-access-control.md` |
| Session/Event lifecycle | A | `architecture/04-session-event-flow.md` |
| Recording/transcript/enhancement | A | `architecture/06-recording-transcription-pipeline.md` |
| AI analysis and publication | A | `architecture/08-ai-analysis-and-debrief.md` |
| Deployment/runtime/recovery | A / E | `architecture/11-deployment-architecture.md`, `operations/deployment-runbook.md` |
| Engineering change governance | E | `testing/engineering-workflow.md` |
| Unresolved conflicts | E | `FINDINGS.md` |

## Historical (non-authoritative)

[`history/README.md`](history/README.md) holds checkpoints, design packets,
audits, stage requirement manifests, implementation reports, remediation
evidence, and the per-document baseline inventory
([`history/BASELINE-V1-DOCUMENT-INVENTORY.md`](history/BASELINE-V1-DOCUMENT-INVENTORY.md)).

Historical files can explain why a decision was made. They cannot override
current requirements or architecture.

## Supporting (current, not architecture)

| Area | Location |
| --- | --- |
| Operator runbooks | `operations/` |
| Test strategy, E2E, evals | `testing/` |
| Accepted ADRs | `decisions/`, `architecture/adr/` |
| Brand implementation notes | `branding/` |
| Voximplant scenario source and sync | `voximplant/` (JavaScript is a runtime artifact) |

## Rules for changing code

1. Inspect `architecture/code-map.md`.
2. Update the mapped canonical architecture chapter in the same change.
3. If the product contract changed, update `requirements/PRODUCT-REQUIREMENTS.md`.
4. New major flows also update `architecture/README.md` and `code-map.md`.
5. Do not create a new stage-labelled architecture or requirements file as
   current truth.

Keep secrets out of documentation.
