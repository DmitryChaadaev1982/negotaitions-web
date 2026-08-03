# Mailbox and Sender Plan

## Operator and Ownership

| Decision | Value | Evidence source |
| --- | --- | --- |
| Current site operator | `Чаадаев Дмитрий Владимирович` | USER DECISION |
| Current operating mode | Individual, not legal entity | USER DECISION |
| Public personal data | Do not publish residential address or additional personal information without legal approval. | USER DECISION |
| Initial recipient | Same person receives support, security, and business mail. | USER DECISION |

## Real Inbound Mail

| Address | Initial recommendation | Reason | Evidence source |
| --- | --- | --- | --- |
| `support@negotaitions.ru` | Real mailbox primary address or alias to owner mailbox | Public support address; likely default reply-to. | USER DECISION, OFFICIAL DOCUMENTATION |
| `security@negotaitions.ru` | Alias initially; separate mailbox/shared mailbox before broader launch if sensitive volume grows | Security reports need controlled access and audit, but one operator can start with alias. | USER DECISION, INFERENCE |
| `business@negotaitions.ru` | Alias initially | Owner-operated business inquiries. | USER DECISION, OFFICIAL DOCUMENTATION |

Recommended initial model: one real owner mailbox plus aliases. This is supported by official alias docs up to 10 aliases per mailbox and supports sending from aliases. Verify send-from behavior in the chosen web/mobile/desktop clients before publishing.

## Private Operational Destinations

| Address | Initial recommendation | Public? | Notes |
| --- | --- | --- | --- |
| `admin@negotaitions.ru` | Alias or group to owner/admin mailbox | No | Pending approval/admin operational alerts. |
| `errors@negotaitions.ru` | Alias or group to owner/admin mailbox | No | Provider/app operational alerts; avoid exposing to users initially. |
| `analytics@negotaitions.ru` | Alias to owner or internal group | No | Metrics/report registrations; avoid app secrets or exports in mailbox. |
| `dmarc@negotaitions.ru` | Decision required: alias, shared mailbox, or external DMARC processor | Maybe no | If used in `rua/ruf`, expect report volume and XML attachments. |

## Automated Postbox Senders

| Sender | Purpose | Accept inbound? | Reply-To | Notes |
| --- | --- | --- | --- | --- |
| `no-reply@negotaitions.ru` | Password/security/account system notices where replies are not useful | Prefer no direct inbox; route bounces via provider events | `support@negotaitions.ru` when appropriate | Must not use owner mailbox credentials. |
| `invitations@negotaitions.ru` | Event and standalone Session invitations | Optional alias to support for confused replies | Event host/facilitator when safe, otherwise `support@` | Must preserve auth/access model; raw Session ID is not sufficient. |
| `notifications@negotaitions.ru` | Materials/results, status, reminders | Optional alias to support | `support@` | Avoid embedding private materials; link back to authenticated app pages. |

Postbox identity model should prefer a domain identity for `negotaitions.ru` if it supports all three sender addresses. If Postbox requires per-address restriction, configure the exact allowlist and document it.

## Reply-To Rules

| Template category | Sender | Reply-To |
| --- | --- | --- |
| Email verification | `no-reply@` | `support@` |
| Password reset | `no-reply@` | `support@` |
| Password changed | `no-reply@` | `support@` |
| Blocked/rejected reset response | `no-reply@` | `support@` |
| Account approved | `notifications@` | `support@` |
| Event invitation | `invitations@` | event owner/facilitator if approved, else `support@` |
| Event changed/cancelled | `invitations@` or `notifications@` | event owner/facilitator if approved, else `support@` |
| Standalone Session invitation | `invitations@` | facilitator if approved, else `support@` |
| Materials/results published | `notifications@` | `support@` |
| Admin approval required | `notifications@` | `admin@` |
| Test email | selected sender | `support@` |

## Access and Security Rules

- Automated senders must not be daily human inboxes.
- Application must never authenticate using Yandex 360 mailbox credentials.
- Invitation links must preserve existing authentication/authorization.
- Standalone Session email may include a safe join link, but a raw Session ID must not be enough for access.
- Event invitation links should lead to the target Event and return the user after login or registration.
- Password reset UI/API must use anti-enumeration wording for all account states.
- BLOCKED/REJECTED accounts must not create reset tokens; they receive support-guidance email only if policy permits sending.

## Future Migration Triggers

Move from one mailbox plus aliases to separate/shared mailboxes when:

- there is more than one operator;
- security reports need separation from support/business mail;
- reply ownership must be auditable;
- support workload requires delegation;
- DMARC/reporting volume is noisy;
- legal requires distinct contact handling.
