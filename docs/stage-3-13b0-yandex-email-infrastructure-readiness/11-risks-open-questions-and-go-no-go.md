# Risks, Open Questions, and Go/No-Go

## Risks

| Risk | Severity | Evidence source | Mitigation |
| --- | --- | --- | --- |
| Public wildcard/private A records return `172.29.172.1` for root and arbitrary subdomains. | High | PUBLIC DNS | Resolve DNS hygiene before mail rollout. |
| No MX/SPF/DKIM/DMARC currently exists. | High | PUBLIC DNS | Controlled Yandex 360/Postbox DNS rollout. |
| Live Yandex Cloud folder/resources not verified. | High | YANDEX CLOUD CLI blocked | Complete manual console/CLI checklist. |
| Production VM service account and outbound connectivity not verified. | High | PRODUCTION SERVER blocked | Complete read-only server checks. |
| Legal/operator contact details still placeholders. | High | REPOSITORY, USER DECISION | Legal approval before public footer/contact publication. |
| Alias-only `security@` mixes support/business/security mail. | Medium | OFFICIAL DOCUMENTATION, INFERENCE | Separate mailbox/shared mailbox before team delegation or public security program. |
| Static credentials may be introduced if IAM-token path is not verified. | Medium | OFFICIAL DOCUMENTATION, NOT VERIFIED | Prefer VM service account IAM token; Lockbox fallback only. |
| Provider events may include recipient/subject data. | Medium | OFFICIAL DOCUMENTATION | Normalize/redact and apply retention. |
| Invitations could leak access tokens if implemented directly. | High | REPOSITORY | Preserve auth model; no raw Session ID/access-bearing tokens as sufficient access. |
| Template rendering could introduce injection/phishing risk. | Medium | INFERENCE | Escaping-by-default renderer and manifest validation. |

## Open Questions

| Question | Owner | Required before |
| --- | --- | --- |
| Which Yandex Cloud folder should host Postbox: production VM folder or a separate mail folder? | Owner/engineering | Postbox setup |
| Does the production VM already have a service account? | Owner/engineering | IAM-token sending |
| Is Postbox available and billable in the current cloud/account? | Owner | Postbox setup |
| What Yandex 360 plan is acceptable for initial mailbox use and MFA/admin security needs? | Owner | Yandex 360 setup |
| Should `support@` be the primary mailbox and `security@`/`business@` aliases, or should owner use a private primary mailbox? | Owner | Mailbox creation |
| Should `security@` be separate before public launch? | Owner/legal/security | Public contact publication |
| Which address receives DMARC aggregate/failure reports? | Owner/engineering | DMARC record |
| What public operator/contact information can be legally published for an individual operator? | Legal/owner | Legal pages and email footer |
| Are rendered email bodies allowed to be retained for 30 days? | Legal/owner | Schema/env implementation |
| Does suppression indefinite retention (`0`) comply with policy/law? | Legal/owner | Suppression implementation |
| Should Event scheduling require `duration` or `endsAt`? | Product/engineering | Event invitation implementation |

## Go/No-Go Recommendation

**CONDITIONAL GO**

Implementation can begin for repository-side design, data model planning, mock provider tests, template scaffolding, and documentation. Real sending must wait for manual setup/verification.

| Area | Assessment | Result |
| --- | --- | --- |
| Repository implementation readiness | Stage 3.13A findings are present, repo has no current sender/outbox/templates, and timer patterns exist. | CONDITIONAL GO |
| Yandex 360 readiness | Provider capabilities are documented, but organization/domain/mailboxes do not exist. | CONDITIONAL GO after setup |
| Postbox readiness | Provider capabilities are documented, but current folder availability, quotas, billing, identity, and service account are not verified. | CONDITIONAL GO after setup |
| DNS readiness | Delegated to Yandex Cloud DNS, but no mail auth records and wildcard/private A needs correction. | NO-GO for live sending until fixed |
| Server/worker readiness | Repo has a worker/timer precedent, but live VM access and connectivity failed. | CONDITIONAL GO after server checks |
| Security readiness | Preferred IAM-token path is officially supported; must verify VM service account and avoid static secrets. | CONDITIONAL GO |
| Legal/content readiness | Operator/contact/disclaimer/retention require legal approval. | DECISION REQUIRED |

## Next-Stage Recommendation

Stage 3.13B1 should be a repository implementation planning/scaffolding stage only:

- do not send real email;
- do not create provider resources from app code;
- design outbox/attempt/suppression schema;
- scaffold repository templates/manifests;
- implement mocked provider abstraction if approved;
- add admin-only test-email path only behind mock mode until provider/DNS readiness is complete;
- keep product/marketing deferred.
