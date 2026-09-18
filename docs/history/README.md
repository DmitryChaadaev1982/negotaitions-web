# Historical documentation

**This tree is NON-AUTHORITATIVE (role F).**

It preserves checkpoints, design packets, audits, stage requirement
manifests, implementation reports, and remediation evidence.

It also holds the baseline document inventory. That inventory is
**historical evidence**. It is not current architecture or current
requirements.

Current truth:

- Requirements (role B): [`docs/requirements/PRODUCT-REQUIREMENTS.md`](../requirements/PRODUCT-REQUIREMENTS.md)
- Architecture (role A): [`docs/architecture/README.md`](../architecture/README.md)
- Navigation (role C): [`docs/architecture/code-map.md`](../architecture/code-map.md)
- Governance (role C): [`docs/DOCUMENTATION-GOVERNANCE.md`](../DOCUMENTATION-GOVERNANCE.md)

Do not use files here as required reading for current architecture. They
may explain why a decision was made. They cannot override a canonical
document.

## Baseline inventory

[`BASELINE-V1-DOCUMENT-INVENTORY.md`](BASELINE-V1-DOCUMENT-INVENTORY.md)
lists **every** tracked Markdown path that existed at starting baseline
`308c1c74eb355724fd3377354c07d9821a0cb3f1` (284 documents), with
classification, disposition, current authority, unique-knowledge notes,
and recovery destination.

That ledger is how an independent reviewer proves that no original
Markdown path disappeared silently and that still-active unique knowledge
was recovered before archival.

## Layout

| Path | Contents |
| --- | --- |
| `checkpoints/` | Release snapshots, handoffs, POC deployment notes, local smoke notes |
| `design-packets/` | Stage requirement manifests, Vox design/audit notes, architecture supplements, email readiness audits |
| `remediation/` | Implementation reports, backlog residuals, one-off repair notes |
| `audits/` | Durable audit evidence (including former `docs/audits/`) |
| `BASELINE-V1-DOCUMENT-INVENTORY.md` | Per-document baseline classification/disposition ledger |

## Classification at archive time

See the inventory for per-path classification. Summary:

- `CANONICAL_CURRENT` — numbered architecture chapters and email architecture chapters retained in `docs/architecture/`
- `CURRENT_SUPPORTING` — operations, testing, ADRs, agent routing, retained Vox scenario ops
- `HISTORICAL_WITH_UNIQUE_KNOWLEDGE` — archived with a recovery destination in current canonical docs
- `HISTORICAL_REDUNDANT` — archived for provenance only
- Deleted original Markdown in this baseline: none (archive preferred)

Voximplant **JavaScript scenarios** remain in `docs/voximplant/` because they
are runtime artifacts.

A later independent baseline review should treat this tree as frozen
provenance, not as a documentation backlog to re-canonicalize.
