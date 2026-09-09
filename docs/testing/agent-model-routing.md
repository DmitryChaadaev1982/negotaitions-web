# Agent Model Routing

This is human guidance for NegotAItions engineering. It is **not** the executable model router.

EO owns routing. Actual provider/model identity comes from the EO resolved
binding for the current Change Unit step. Product documentation must not
select models, switch Cursor models by task class, or treat review as M4.

## Logical classes (EO)

| Class | Meaning |
| --- | --- |
| **M0** | Deterministic. No paid model. |
| **M1** | Economy / mechanical model-assisted validation. |
| **M2** | Routine engineering default. |
| **M3** | High-risk / expert. |
| **M4** | Explicit major independent audit only. |

Durable rules:

- `freshContext` is **not** M4. A fresh session can still be M2 or M3.
- M3 does **not** automatically escalate to M4.
- Maximum automatic root-cause escalation is **one** M2→M3.
- Independence is not a model tier. Independent review is a distinct EO
  step; it is not “run M4”.
- Do not emit or claim M4 unless EO actually bound a distinct configured M4.
- Explicit prompt override beats EO defaults. Hard execution safety remains
  highest.

Do not use stale Product logic such as:

- review ⇒ M4
- large prompt ⇒ expensive model
- CP2E `SOURCE_ONLY` / `ENGINEERING_WITH_DEPENDENCIES` / `UI_ACCEPTANCE` ⇒
  a manual Cursor model switch

`taskClassPolicy` on the Product profile is EO readiness compatibility
(whether local app is required for an intent). It is not a model matrix.

## Canonical validation execution is not a model hop

`npm run validate:fast`, `npm run validate:build`, and
`npm run validate:deploy` are Product commands. EO owns when canonical
formal/release gates run. Native Agent may run focused tests during
implementation. Do not delegate long canonical gates to a Cursor subagent.

If a long canonical command cannot be observed reliably, stop and give the
operator the PowerShell recipe in
[`validation-checklist.md`](./validation-checklist.md).

## Non-authoritative current-policy examples

The following identities are **examples of current local Cursor policy**,
not the executable binding. EO configuration is authoritative.

- Routine engineering often binds a Grok 4.6 High-class identity when that
  binding is configured.
- Expert/high-risk work may bind a distinct Maximum-class identity when
  configured.
- M4 is only a distinct independent-audit identity when EO has one
  configured. If none is configured, do not label the run M4.

Do not maintain a Product Grok/CP2E routing matrix. Do not return-to-OpenAI
or Terra/Sol by Product folklore. If the operator changes Cursor pool
policy, EO bindings still decide what actually ran.
