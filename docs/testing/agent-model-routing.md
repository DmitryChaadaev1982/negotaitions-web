# Agent Model Routing (Temporary)

This is the authoritative **temporary** Cursor model-routing policy for
NegotAItions tooling. It does not change product quality, evidence, validation,
privacy, authorization, database, deploy, or production restrictions.

`AGENTS.md` remains the router. Do not copy this full policy into other files.

Applies while the user's included Cursor Grok usage pool remains available, or
until the user explicitly changes the policy. Do not switch routing based on
guessed usage.

## Default primary model: Grok 4.6

Use Grok 4.6 by default for:

- parent implementation and product development
- remediation and root-cause analysis
- repository/codebase exploration
- test selection
- requirements evidence collection and requirement-completeness judgment
- architecture/design reasoning
- targeted code review
- privacy, authorization, database, and deploy audits

Custom-agent identifier: `model: grok-4.6`.

This Cursor installation does **not** support `grok-4.6-low`, `grok-4.6-medium`,
or custom-agent frontmatter effort / fast / standard fields. Do not invent those
identifiers or fields.

## Validation execution: primary agent, not a subagent

Canonical validation commands stay on the **primary / orchestrating** agent:

```
CANONICAL VALIDATION COMMAND
→ PRIMARY AGENT DIRECT EXECUTION
```

Not:

```
PRIMARY
→ VALIDATION RUNNER SUBAGENT
→ canonical command
```

`npm run validate:fast`, `npm run validate:build`, `npm run validate:deploy`,
and any future validation command expected to run longer than a short
focused-test interval **must not** be delegated to a Cursor subagent. Cursor
has repeatedly remained on “Waiting for subagent” after
`scripts/validation-runner.mjs` already finished, released locks, and exited.
The kernel is healthy; the failing layer is the subagent return path.

If the primary agent cannot reliably execute or observe that long command,
stop and hand the operator the PowerShell recipe in
`docs/testing/validation-checklist.md`. Prefer operator PowerShell for
standalone `validate:deploy` when independent release-gate evidence is
desired.

Subagents remain allowed for source review, forensic analysis, high-risk
independent review, architecture review, small focused tests, and bounded
searches. `.cursor/agents/validation-runner.md` may still summarize a short
focused-test manifest. Do not move implementation or remediation decisions
into that profile. Do not use it to isolate `validate:fast` / `validate:build`
/ `validate:deploy` logs.

## Terra and Sol are not defaults

GPT-5.6 Terra and GPT-5.6 Sol are temporarily **not** default models.

Do not automatically invoke Terra or Sol because a task is complex, touches
privacy/auth/DB/concurrency, is an audit, or because an older workflow used Sol
for high-risk review. Start with Grok 4.6.

## Escalation

Terra/Sol may be used only as **escalation** when there is concrete evidence
Grok is not handling the task sufficiently.

Valid escalation signals:

- Grok explicitly reports low confidence on a material decision
- Grok cannot establish root cause after a focused attempt
- repeated remediation loops do not converge
- Grok contradicts deterministic runtime, test, or database evidence
- a material requirement is repeatedly missed
- reasoning becomes internally inconsistent
- the user explicitly requests an OpenAI comparison or review
- assistant or user identifies a specific risk where independent stronger
  verification is justified

Do not escalate merely due to task category.

When escalation is justified:

- Preferred implementation/remediation escalation: GPT-5.6 Terra Medium or High
  according to complexity.
- Preferred high-risk independent review escalation: GPT-5.6 Sol High.

Escalation must be targeted, localized, and based on compact evidence. Do not
reread the repository unless genuinely required. If Grok already produced useful
investigation evidence, pass only the necessary factual evidence/diff packet.

Do not automatically run Grok and Sol in parallel for every audit. Parallel
benchmark runs are allowed only when explicitly requested as a model-quality
experiment.

## Engineering-quality flow (routing implications)

The process contract is `docs/testing/engineering-workflow.md`. Do not copy it
here.

Accepted sequence:

```
Requirement
→ CIA
→ Change Units
→ risk / kernel / strategy
→ Eval Selection
→ Validation Plan
→ Implementation
→ Validation Execution
→ checkpoint / finalization
```

Routing implications only:

- Produce CIA, Change Units, Eval Selection, and the Validation Plan **before**
  implementing meaningful work. Trivial typo/comment work does not require that
  bureaucracy.
- Risk sets a **minimum** reasoning/review floor. It does **not** encode
  “LOW risk always means Low model effort.”
- Complexity, ambiguity, coupling, context volume, or regression breadth may
  **raise** required reasoning effort even when product risk is low.
- Default parent (currently Grok 4.6) owns implementation, remediation,
  judgment, and **direct** canonical Validation Execution
  (`validate:fast` / `validate:build` / `validate:deploy`).
  `validate-wave` is a primary-context skill, not a subagent hop.
- Do not collapse `verify-requirements` (completeness) and `validate-wave`
  (correctness/regression).
- Using the default parent does **not** lower evidence or validation
  requirements.

## Return-to-OpenAI condition

When the included Grok usage pool is exhausted, or the user explicitly switches
policy, default routing returns to the previously approved OpenAI workflow:

- GPT-5.6 Terra → implementation/remediation parent
- GPT-5.6 Luna Medium → short focused-test subagent work only; not
  canonical `validate:fast` / `validate:build` / `validate:deploy`
- GPT-5.6 Sol High → targeted high-risk review only when justified

The user controls the transition.

## Model quality tracking

Evaluate model choice from actual project outcomes, especially requirement
misses, escaped defects, root-cause accuracy, false-positive audit findings,
remediation loops, validation failures, and tokens/cost per completed task when
usage data is available. Do not add application telemetry or a benchmark
framework for this policy.
