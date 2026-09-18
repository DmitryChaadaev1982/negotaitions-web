# Audits And Historical Reports

**Historical / non-authoritative.** Former path: `docs/audits/`.

Current architecture lives in `docs/architecture/`. This folder is
provenance and investigation evidence only.

## What Belongs Here

- Durable markdown summaries that are useful for future engineering context.
- Historical report snapshots preserved for traceability.

## What Should Stay Outside Repository

- Raw one-off audit artifacts, large trace dumps, and generated bundles.
- Prefer external artifact storage (for example project-artifacts or server artifact storage such as `/var/www/negotaitions-artifacts`).

## Archive Notes

- Historical root-level markdown reports live in `archive/old-root-reports/`.
- Archived reports are historical records and are not guaranteed to describe current runtime behavior.

## Usage Guidance

- Use `docs/architecture/*` as canonical current-state truth.
- Use these audit reports as supporting context only.
