# NegotAItions Documentation Hub

This `docs/` directory is the canonical knowledge base for the current NegotAItions solution.

## Sections

- `architecture/` - Product, domain, runtime, integration, and deployment architecture.
- `operations/` - Deployment and server operation guidance.
- `decisions/` - Architecture Decision Records (ADRs).
- `testing/` - E2E strategy and validation checklist.
- `audits/` - Durable audit summaries and historical reports.

## Where To Start

1. Read `architecture/README.md`.
2. Open `architecture/code-map.md`.
3. For validation gates, read `testing/validation-checklist.md`; for E2E
   selection and fixture safety, read `testing/e2e-strategy.md`.
4. For observer coverage, read `testing/observer-test-execution-policy.md`.
5. For deployment or runtime configuration, read
   `operations/deployment-runbook.md`.
6. Follow links from code map areas to detailed architecture chapters.
7. For account recovery and security email, read
   `architecture/account-security-email-flows.md` and
   `operations/stage-3-13c-local-email-testing.md`.

## Documentation Update Rule

When changing code:

1. Check `architecture/code-map.md` first.
2. If changed files map to an architecture chapter, update that chapter in the same change.
3. If a change introduces a new major flow, update both:
   - `architecture/README.md`
   - `architecture/code-map.md`
4. If no architecture docs were updated for a mapped area, explain why in the PR/agent final response.

## Scope Boundaries

- Keep secrets and runtime credentials out of docs.
- Keep raw, one-off artifacts outside repository where possible.
- Keep durable summaries in `docs/`.
