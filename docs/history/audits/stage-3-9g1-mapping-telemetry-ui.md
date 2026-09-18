# Stage 3.9G1 Mapping/Telemetry/UI Audit

This document is the index for the read-only Stage 3.9G1 audit package.

- Scope: participant activity telemetry, automatic speaker mapping, manual mapping, persistence model, API contracts, mapping statuses, facilitator-facing UI.
- Baseline branch: `audit/stage-3-9g1-mapping-telemetry-ui` (base `deploy/yandex-poc`).
- Change policy: docs-only audit, no application/test/env/provider/runtime modifications.
- Primary production sample: `primary` (requested session).
- Secondary production sample: requested `secondary` session had no usable transcript/mapping rows; fallback `secondary` sample was selected from newest qualifying production data and then sanitized in all committed outputs.

Detailed findings are split into:

- `docs/audits/stage-3-9g1-mapping-telemetry-ui/README.md`
- `docs/audits/stage-3-9g1-mapping-telemetry-ui/*.md`
- `docs/audits/stage-3-9g1-mapping-telemetry-ui/*.csv`

