# Requirement Completeness Policy

## Two separate gates

`verify-requirements` asks: **did we build every approved requirement?**

`validate-wave` asks: **does the implemented code work correctly and avoid
regressions?**

Neither gate replaces the other. Requirement verification runs before expensive
targeted high-risk review and before packaging; correctness/regression
validation follows the repository validation policy.

## Requirement evidence and judgment

Every approved product requirement must be represented by one stable,
independently verifiable manifest ID. Each ID is judged once in a complete
coverage matrix using evidence appropriate to its acceptance criterion:
CODE, DOM, SCREENSHOT, BEHAVIOR, TEST, API, DB, or MIGRATION.

### Required versus supporting evidence

The manifest defines **required evidence** and **supporting evidence** for every
ID. Required evidence is the minimum evidence class for PASS. Supporting
evidence may narrow a search or corroborate a conclusion, but never replaces a
missing required class.

- Structural/backend invariants require CODE plus API, DB, or TEST evidence
  appropriate to the invariant.
- Visual appearance requires real DOM and/or SCREENSHOT evidence. CODE is
  supporting only.
- Interactive UI behavior requires BEHAVIOR, normally with observed DOM or API
  evidence. CODE and unexecuted test source are supporting only.
- Persistence/migration requirements require CODE plus the applicable
  TEST/DB/MIGRATION evidence.
- Security/privacy invariants require CODE plus TEST/API/DB evidence appropriate
  to the authorization or data boundary.

Use an existing safe local runtime first. Try Cursor browser tooling, then
inspect the repository's existing local Playwright/browser infrastructure for
the cheapest safe page/DOM/screenshot mechanism. Do not start production
services, access production, expose credentials, alter product source, or
create product tests merely to obtain evidence. A manual authentication,
fixture, or local-runtime blocker must be recorded precisely.

| Status | Meaning |
| --- | --- |
| PASS | All required evidence classes satisfy the complete acceptance criterion. |
| PARTIAL | Evidence demonstrates that only part of the atomic implementation exists. Missing evidence alone is not PARTIAL. |
| FAIL | Evidence shows the implementation omits or contradicts the requirement. |
| UNVERIFIABLE | Required evidence cannot currently be obtained; this is not PASS, even when source appears correct. |
| DEFERRED | An explicit user/product decision has deferred the requirement. |

An implementing model’s completion report is not evidence by itself. An asset
on disk does not prove it appears on the required runtime surface. A backend
handler does not prove the required user behavior is exposed. A similar test
does not prove its acceptance criterion. Changed-files-only review is
insufficient: verification must actively search for missing implementation.

An asset on disk, JSX import, conditional source branch, CSS class, backend
handler, or matching test name cannot independently prove runtime appearance or
behavior. Record factual evidence per ID, including `NO_EVIDENCE_FOUND`, before
making a judgment.

### Executed-test evidence

A test file merely existing, its source being inspected, or its name resembling
a requirement is supporting evidence only. A deterministic test may satisfy a
required TEST, API, DB, BEHAVIOR, or DOM class only when it was actually
executed against the relevant local runtime, component, API, or database and
its assertions materially cover the acceptance criterion. Record the exact
command, test identity, runtime mode, and observed assertion result in the
coverage matrix.

An executed Playwright/browser test with relevant UI assertions may satisfy
BEHAVIOR plus DOM evidence. An executed API integration test may satisfy
API/BEHAVIOR evidence where appropriate. An executed DB-backed transaction test
may satisfy TEST plus DB evidence. Purely visual color, hierarchy, pictogram,
layout, and accent requirements still require rendered DOM/computed-style
and/or screenshot evidence as defined by the manifest; helper/unit tests cannot
prove them.

## Requirements-derived acceptance strategy

For a product/UI wave, derive the smallest deterministic acceptance check
directly from each unresolved requirement before remediation:

1. Select or create the minimal check and run it against the current
   implementation.
2. Preserve a failure as baseline evidence of the requirement gap.
3. Implement remediation.
4. Rerun the same check; a passing run becomes requirement evidence.
5. Run the normal `validate-wave` regression gates afterward.

Prefer existing authenticated Playwright fixtures, stable semantic selectors,
DOM assertions, and computed-style checks. Use screenshots only when appearance
cannot be adequately established through DOM/computed style; avoid brittle
pixel-perfect comparison unless it is genuinely necessary.

## Packaging rule

A product wave is requirement-complete only if every manifest ID is PASS or
explicitly DEFERRED. PARTIAL, FAIL, and UNVERIFIABLE are unresolved and block
packaging. The coverage matrix must reconcile its manifest count with the sum
of all status counts; silent omissions are not permitted.

After remediation, re-check failed/partial IDs first, then re-establish full
manifest coverage.
