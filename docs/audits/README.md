# Audits And Historical Reports

`docs/audits` is the canonical audit/history folder for this repository.

This folder contains durable audit summaries and historical report material relevant to architecture and operations traceability.

## What Belongs Here

- Durable markdown summaries that are useful for future engineering context.
- Historical report snapshots preserved for traceability.

## What Should Stay Outside Repository

- Raw one-off audit artifacts, large trace dumps, and generated bundles.
- Prefer external artifact storage (for example project-artifacts or server artifact storage such as `/var/www/negotaitions-artifacts`).

## Archive Notes

- Historical root-level markdown reports were moved to:
  - `docs/audits/archive/old-root-reports/`
- Historical records from former `docs/audit` locations should be archived under `docs/audits/archive/`.
- Archived reports are historical records and are not guaranteed to describe current runtime behavior.

## Usage Guidance

- Use `docs/architecture/*` as canonical current-state truth.
- Use archived audit reports as supporting context/source notes.
