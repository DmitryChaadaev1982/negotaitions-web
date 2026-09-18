# Retention, Template, and Disclaimer Readiness

## Retention Defaults

Do not edit `.env` in B0. Future values should be environment-configurable.

| Variable | Data class | Purpose | Risk | Proposed default | Legal confirmation | Cleanup | `0` meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `EMAIL_CONTENT_RETENTION_DAYS` | Rendered subject/body | Debug delivery and user support briefly after send. | PII/security content leakage if retained too long. | `30` | Required | Delete/rendered-body nulling job. | Not recommended. |
| `EMAIL_MESSAGE_METADATA_RETENTION_DAYS` | Message metadata excluding rendered bodies | Audit, user support, idempotency, delivery state. | Recipient/type/timing is personal data. | `180` | Required | Scheduled DB cleanup/anonymization. | Indefinite, only with legal approval. |
| `EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS` | Provider attempt metadata and error classes | Retry diagnosis and provider support. | Provider errors may contain recipient/status details. | `180` | Required | Scheduled cleanup after terminal state. | Indefinite, not recommended. |
| `EMAIL_PROVIDER_ID_RETENTION_DAYS` | Provider message IDs | Correlate with Postbox events/support. | Persistent cross-system identifiers. | `180` | Required | Remove IDs after correlation window. | Indefinite, not recommended. |
| `EMAIL_PROVIDER_EVENT_RETENTION_DAYS` | Bounce/complaint/delivery/reject events | Suppression, reputation, analytics, provider reconciliation. | Can include recipient, subject, event metadata. | `365` | Required | Event table cleanup with suppression extraction. | Indefinite, not recommended. |
| `EMAIL_AUDIT_RETENTION_DAYS` | Admin/security audit events | Accountability for email configuration and sensitive flows. | Audit logs include actors and targets. | `365` | Required | Audit retention cleanup/export policy. | Indefinite only if legal requires. |
| `EMAIL_SUPPRESSION_RETENTION_DAYS` | Suppression records | Prevent repeated bounces/complaints/unwanted mail. | Indefinite suppression is personal-data retention. | `0` initially meaning indefinite until legal decision | Required | Review/export/delete process; support override workflow. | Indefinite suppression. |

Category refinements:

- Security/account emails may justify longer metadata/audit retention than invitation/reminder content.
- Rendered content should be minimized or not stored for high-sensitivity templates.
- Provider raw events should be normalized and redacted before long retention.
- Suppression records need reason, scope, source, and optional expiry; not all suppression reasons should be indefinite.

Evidence source: USER DECISION, INFERENCE.

## Template Repository Structure

Recommended future structure:

```text
emails/
  templates/
    <template-key>/
      ru.subject.txt
      ru.text.hbs
      ru.html.hbs
      en.subject.txt
      en.text.hbs
      en.html.hbs
      manifest.json
  partials/
    disclaimer.transactional.ru.html.hbs
    disclaimer.transactional.ru.text.hbs
    disclaimer.transactional.en.html.hbs
    disclaimer.transactional.en.text.hbs
    disclaimer.marketing.ru.html.hbs
    disclaimer.marketing.ru.text.hbs
    disclaimer.marketing.en.html.hbs
    disclaimer.marketing.en.text.hbs
  manifests/
    variables.schema.json
    templates.index.json
```

Evidence source: USER DECISION, INFERENCE.

## Required Template Categories

| Template | Sender | Reply-To | Security/disclaimer notes |
| --- | --- | --- | --- |
| Email verification | `no-reply@` | `support@` | One-time link; expiry; never include password. |
| Password reset | `no-reply@` | `support@` | One-time link; expiry; anti-phishing wording. |
| Password changed | `no-reply@` | `support@` | No password; advise contact if unexpected. |
| Blocked/rejected reset response | `no-reply@` | `support@` | No status leak in UI/API; email may explain automatic reset unavailable per approved policy. |
| Account approved | `notifications@` | `support@` | Link to login; no sensitive admin notes. |
| Event invitation | `invitations@` | event owner or `support@` | Must include title, date, time, time zone; preserve auth. |
| Event changed | `invitations@` or `notifications@` | event owner or `support@` | Include changed date/time/title summary if safe. |
| Event cancelled | `invitations@` or `notifications@` | event owner or `support@` | Clear cancellation; avoid private notes. |
| Standalone Session invitation | `invitations@` | facilitator or `support@` | Safe join link; raw Session ID not sufficient. |
| Materials/results published | `notifications@` | `support@` | Link to authenticated materials; no transcript/AI body inline. |
| Admin approval required | `notifications@` | `admin@` | Internal only; no passwords/tokens. |
| Test email | selected sender | `support@` | Clearly marked test; admin-only. |

Every template must have RU and EN subject, HTML, text, manifest, version, required variables, sender identity, reply-to, disclaimer partial, and security warnings where relevant.

## Scheduling Model for Event Invitations

Future Event invitations require mandatory scheduling fields:

- `startsAt`
- time zone
- duration or `endsAt`

No schema change in B0. B1/B2 should design this before enabling Event invitation email. Event invitation should eventually support an ICS attachment.

Evidence source: USER DECISION.

## Password Reset Policy

Approved behavior:

- ACTIVE/APPROVED accounts: create one-time reset token and send reset email to the verified account address.
- BLOCKED/REJECTED accounts: do not create token; send an email explaining automatic reset is unavailable and instructing the user to contact administrator/support.
- Public UI/API must use anti-enumeration wording and not reveal account existence or status.

Evidence source: USER DECISION.

## Template Renderer Recommendation

| Option | Assessment | Recommendation |
| --- | --- | --- |
| Handlebars/constrained engine | Simple, file-based, manifest-checkable, escaping by default if configured carefully. | Recommended initial model. |
| Another constrained engine | Acceptable if it enforces escaping and manifest validation. | Alternative. |
| Code-owned React email components | Strong typing but more rendering/build complexity and harder manual editing. | Consider later. |
| Postbox provider templates | Provider-coupled and weaker Git review/versioning for this project. | Do not use initially. |
| Admin UI editing | Too risky for first implementation. | Defer. |

## Disclaimer Model

- Transactional disclaimer: service identity, support contact, why recipient received the message, security warning, no marketing unsubscribe for required account/security messages.
- Optional/product disclaimer: consent basis, unsubscribe/preference link, operator contact, legal footer.
- Marketing disclaimer: only after explicit approval, consent model, and unsubscribe implementation.
- Avoid publishing residential address or extra personal data before legal approval.
