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

## Validation execution: GPT-5.6 Luna Medium

Keep Luna specifically for deterministic validation execution through
`.cursor/agents/validation-runner.md` (`model: gpt-5.6-luna-medium`).

Use Luna for:

- executing tests
- lint, build, and validation commands
- deterministic validation gates
- retaining long raw logs outside the parent context
- returning compact `FAILURE CAPSULE` or `VALIDATION EVIDENCE`

Do not move implementation or remediation decisions into `validation-runner`.

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

## Quality workflow (unchanged)

Normal product flow:

1. approved requirements
2. atomic requirement manifest
3. requirement-derived acceptance evidence
4. Grok implementation/remediation
5. `verify-requirements` (did we implement all approved requirements?)
6. `validate-wave` (does the implementation work correctly and avoid regressions?)
7. optional targeted escalation review only when justified
8. package

Do not collapse `verify-requirements` and `validate-wave`. Grok is the default
reasoning/judgment model. Luna `validation-runner` is the deterministic
execution layer.

Using Grok by default does **not** lower evidence or validation requirements.

## Return-to-OpenAI condition

When the included Grok usage pool is exhausted, or the user explicitly switches
policy, default routing returns to the previously approved OpenAI workflow:

- GPT-5.6 Terra → implementation/remediation parent
- GPT-5.6 Luna Medium → deterministic validation/subagent execution
- GPT-5.6 Sol High → targeted high-risk review only when justified

The user controls the transition.

## Model quality tracking

Evaluate model choice from actual project outcomes, especially requirement
misses, escaped defects, root-cause accuracy, false-positive audit findings,
remediation loops, validation failures, and tokens/cost per completed task when
usage data is available. Do not add application telemetry or a benchmark
framework for this policy.
