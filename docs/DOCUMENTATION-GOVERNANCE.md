# Documentation Governance

This file is the documentation ownership contract for NegotAItions.
It is navigation/governance (role C). It is not a second engineering
lifecycle, requirement, or architecture authority.

## Authority model

The same six roles are used in `docs/README.md` and
`architecture/README.md`.

| Role | Meaning | Owner |
| --- | --- | --- |
| **A. Current architecture contract** | Current implemented behavior, structure, state, flows, authority, integration, and operational architecture | Numbered `architecture/01-*.md`–`13-*.md` plus email chapters in the owner map below |
| **B. Current product requirement contract** | Active intended product and quality requirements | `requirements/PRODUCT-REQUIREMENTS.md`, `requirements/QUALITY-AND-ACCEPTANCE.md` |
| **C. Navigation / traceability** | Maps requirements, architecture, code, and tests. Does not redefine behavior | `docs/README.md`, `architecture/README.md`, `architecture/code-map.md`, this file |
| **D. Accepted decision rationale** | Explains why a decision was made. Does **not** override A or B | `decisions/`, `architecture/adr/` |
| **E. Current supporting material** | Operations, testing, engineering change governance, branding, unresolved findings, agent routing | `operations/`, `testing/` (change governance: `testing/engineering-workflow.md`), `branding/`, `voximplant/` scenario ops, `FINDINGS.md`, `AGENTS.md` |
| **F. Historical non-authoritative material** | Provenance only | `history/**` |

`architecture/adr/` lives next to architecture chapters for discoverability.
An ADR is not current-state architecture truth and cannot override A or B.

`architecture/code-map.md` is navigation/traceability. It does not redefine
behavior.

Current implementation does not automatically redefine a product
requirement. Record unresolved disagreement in `FINDINGS.md`.

## Owner map

| Topic | Canonical owner |
| --- | --- |
| Product purpose and capabilities | `architecture/01-product-context.md` |
| Domain aggregates and persisted state | `architecture/02-domain-model.md` |
| Application runtime/UI composition | `architecture/03-application-architecture.md` |
| Session/Event/room lifecycle and occupancy | `architecture/04-session-event-flow.md` |
| Voximplant media/recording control | `architecture/05-voximplant-integration.md` |
| Recording, transcription, enhancement | `architecture/06-recording-transcription-pipeline.md` |
| Speaker mapping and telemetry | `architecture/07-speaker-mapping-and-telemetry.md` |
| AI analysis, publication, debrief | `architecture/08-ai-analysis-and-debrief.md` |
| Authentication, authorization, privacy | `architecture/09-security-and-access-control.md` |
| Persistence, retention, UTC SQL | `architecture/10-data-storage-and-retention.md` |
| Deployment topology and runtime env | `architecture/11-deployment-architecture.md` |
| External systems and geography claims | `architecture/12-external-systems.md` |
| Public site, legal, branding, SEO | `architecture/13-public-site-and-content.md` |
| Email outbox/worker | `architecture/email-delivery-foundation.md` |
| Account-security email flows | `architecture/account-security-email-flows.md` |
| Email Yandex runtime | `architecture/email-runtime-and-yandex-cloud.md` |
| Email retention/suppression | `architecture/email-retention-suppression.md` |
| Code ↔ docs navigation (role C) | `architecture/code-map.md` |
| Active product requirements | `requirements/PRODUCT-REQUIREMENTS.md` |
| Quality/acceptance and validation | `requirements/QUALITY-AND-ACCEPTANCE.md` |
| Unresolved baseline findings | `FINDINGS.md` |
| Operator procedures | `operations/deployment-runbook.md` and sibling runbooks |
| Test strategy and command catalog | `testing/validation-checklist.md`, `testing/e2e-strategy.md` |
| Engineering / agent change governance | `testing/engineering-workflow.md` |
| Production release and recovery procedure | `operations/deployment-runbook.md` (architecture invariants: `architecture/11-deployment-architecture.md`) |

The numbered architecture chapters are the adapted PRODUCT-ARCHITECTURE /
RUNTIME-FLOWS / SECURITY / DATA / INTEGRATIONS / DEPLOYMENT topology.
Do not create parallel current documents with the same topic.

## Rules

1. The numbered architecture chapters and email chapters listed above
   represent CURRENT implemented architecture (role A).
   `architecture/code-map.md` is navigation (role C).
   `architecture/adr/` is decision rationale (role D).
   Stage-labelled files inside `docs/history/` are historical (role F).

2. `docs/requirements/PRODUCT-REQUIREMENTS.md` and
   `QUALITY-AND-ACCEPTANCE.md` represent CURRENT active requirements
   (role B). Stage-labelled requirement manifests under `docs/history/`
   are historical after this baseline.

3. `docs/history/**` is HISTORICAL and NON-AUTHORITATIVE (role F).

4. Historical documents can explain why something happened, but cannot
   override a current canonical requirement or architecture document.

5. Before a current document is archived, all still-active unique
   requirements and decisions must be recovered into the canonical
   baseline.

6. Ordinary Change Units should update the relevant canonical owner
   document instead of creating new checkpoint architecture documents.

7. A code change that materially changes architecture, authority,
   lifecycle, persistence, integration contract, or operational behavior
   must update the relevant canonical documentation in the same Change
   Unit.

8. New Markdown documents need a clear canonical owner/purpose and must
   not duplicate an existing canonical topic.

9. Implementation traceability should use stable module, function, route,
   Prisma model, and test names, not volatile line numbers.

10. Requirements and implementation reality must remain distinguishable.
    A current implementation does not automatically redefine a
    requirement. Record conflicts in `docs/FINDINGS.md`; do not silently
    rewrite the requirement.

11. Historical, checkpoint, audit, and remediation documents must never
    again become required reading for understanding CURRENT architecture.

12. Documentation changes must preserve valid internal links after moves.

13. Durable requirements and architecture documents separate
    **implemented current state** from **deferred**, **planned**,
    **target**, and **future** behavior. Describe future design as future.
    When a feature is intentionally deferred, keep that status explicit.
    One concrete current case is password security in
    `requirements/PRODUCT-REQUIREMENTS.md`,
    `architecture/09-security-and-access-control.md`, and
    `architecture/account-security-email-flows.md`: Argon2id, bcrypt
    compatibility, the 10–128 policy, history depth five, and the common
    password rule are implemented; `passwordChangeRequiredAt` enforcement,
    administrator reset, and BLOCKED/REJECTED session revocation are
    deferred.

## Repository-specific rules

- Native Agent follows `AGENTS.md` and `architecture/code-map.md` before
  changing mapped source. Engineering Orchestrator owns Change Unit
  lifecycle, TYPED_IMPORT, UAT, formal validation, and release.
- Voximplant scenario JavaScript under `docs/voximplant/` is a **runtime
  artifact**, not architecture documentation. Keep those files in place.
  Scenario operations live in `docs/voximplant/scenario-sync.md`.
- `docs/testing/eval-registry.json` evidence paths must remain existing
  files. After a documentation move, update the registry in the same
  change.
- Tests that assert historical operator sequences must follow the
  archived path, or be rewritten to the canonical operations document.
- Do not reopen BUG02, BUG03, or session-admin enhancement behavior in a
  documentation Change Unit.
- Do not copy secret env values into documentation.
- `docs/decisions/` and `docs/architecture/adr/` remain accepted decision
  records (role D). They explain why a choice was made. They do not
  override the current architecture contract (role A) or the current
  product requirement contract (role B).
- Production provider selection has **no application default**.
  `VIDEO_PROVIDER`, `TRANSCRIPTION_PROVIDER`, and `AI_ANALYSIS_PROVIDER`
  are required runtime settings.
- Occupancy and lease SQL against Prisma `DateTime` columns must use
  UTC wall-clock helpers (`lib/sql-utc-wall-clock.ts`). Production
  PostgreSQL `TimeZone=Europe/Moscow` plus `timestamp without time zone`
  is a current invariant, not a closed incident footnote.

## Classification used by this baseline

| Class | Meaning |
| --- | --- |
| CANONICAL_CURRENT | Current architecture or requirements owner |
| CURRENT_SUPPORTING | Operations, testing, ADR, agent routing |
| HISTORICAL_WITH_UNIQUE_KNOWLEDGE | Archived with recovered active knowledge |
| HISTORICAL_REDUNDANT | Archived for provenance only |
| OBSOLETE_OR_MISLEADING | Archived and marked non-authoritative |
| GENERATED/TEMPORARY/JUNK | Eligible for deletion only if proven empty of unique knowledge |

## Change checklist

1. Read `docs/README.md` and `architecture/code-map.md`.
2. Change the single canonical owner for the topic.
3. Update `code-map.md` if implementation anchors changed.
4. Update `PRODUCT-REQUIREMENTS.md` only when the product contract changed.
5. Do not add a new `docs/audits/` or `docs/checkpoints/` current-state
   document.
6. If a finding cannot be resolved from repository evidence, add it to
   `FINDINGS.md` and stop rather than inventing intent.
