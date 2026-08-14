---
name: verify-requirements
description: Independently verifies every approved requirement in a product wave using Grok evidence collection and a complete coverage matrix. Parent judgment follows docs/testing/agent-model-routing.md.
---

# Verify Requirements

Use this Skill before high-risk review and packaging to determine whether all
approved requirements were built. It does not replace `validate-wave`, scoped
rules, or repository testing policy. Follow
[`docs/testing/requirement-completeness.md`](../../../docs/testing/requirement-completeness.md).

1. Load the authoritative requirement manifest and select the requested
   stage/wave subset.
2. Delegate factual, per-ID evidence collection to
   `.cursor/agents/requirements-evidence-collector.md`. Do not use an
   implementation self-report as primary proof.
3. Independently judge every selected ID: PASS, PARTIAL, FAIL, UNVERIFIABLE, or
   DEFERRED. PASS requires every manifest-defined required evidence class.
   Missing runtime evidence is UNVERIFIABLE, not PASS or PARTIAL; use PARTIAL
   only when evidence demonstrates partial implementation. Produce a complete
   coverage matrix and reconcile its counts.
4. For UI requirements, require manifest-defined DOM/SCREENSHOT/BEHAVIOR
   evidence. First attempt safe local browser tooling, then the cheapest
   existing local Playwright/browser mechanism when the browser cannot reach
   the runtime. Asset existence, JSX import, a conditional branch, CSS class,
   backend handler, and test name are supporting evidence only. Use the
   manifest-defined CODE/TEST/API/DB/MIGRATION evidence for backend, privacy,
   and database requirements.
5. Map existing tests only when their assertions materially cover the
   requirement. An executed deterministic local check may satisfy the relevant
   TEST/API/DB/BEHAVIOR/DOM class; unexecuted test source remains supporting
   evidence. Record command, test identity, target, and result in the matrix.
   For unresolved product requirements, select or create the smallest
   requirements-derived acceptance check before remediation, preserve its
   baseline result, and rerun it after the change.
6. Block packaging unless every ID is PASS or explicitly DEFERRED. After
   remediation, re-check failed/partial IDs first, then restore full-manifest
   coverage.
