# Yandex 360 Readiness

## Current State

| Item | Status | Evidence source |
| --- | --- | --- |
| Yandex 360 organization for `negotaitions.ru` | NOT CONFIGURED | USER DECISION |
| Domain connected to Yandex 360 | NOT CONFIGURED | USER DECISION |
| Domain ownership verification | NOT CONFIGURED | USER DECISION |
| Mailboxes/aliases/groups/shared mailboxes | NOT CONFIGURED | USER DECISION |
| Tariff/licensing | MANUAL VERIFICATION REQUIRED | OFFICIAL DOCUMENTATION |

No Yandex 360 setup was attempted in B0.

## Official Capability Summary

| Capability | Official finding | Evidence source |
| --- | --- | --- |
| Initial DNS setup | Yandex 360 mail requires MX, SPF, and DKIM records; delegated domains may be configured automatically. | OFFICIAL DOCUMENTATION |
| MX | Required MX target is `mx.yandex.net.` with priority `10`; Yandex docs list TTL `21600`. | OFFICIAL DOCUMENTATION |
| SPF | Yandex 360-only SPF is `v=spf1 redirect=_spf.yandex.net`; when non-Yandex senders are used, use an include-based composition rather than a second SPF record. | OFFICIAL DOCUMENTATION |
| DKIM | DKIM public key is generated from the Yandex 360 admin domain page and added as `mail._domainkey` TXT. | OFFICIAL DOCUMENTATION |
| Employee mailbox | A mailbox is part of an employee account. Creating a mailbox means creating/registering an employee. | OFFICIAL DOCUMENTATION |
| Aliases | One mailbox can have up to 10 aliases; aliases can receive mail, log in, and send from the alias. The same alias cannot be added to multiple mailboxes. | OFFICIAL DOCUMENTATION |
| Shared mailboxes | Shared mailboxes require a connected domain, have no specific owner, and can be used by multiple employees. | OFFICIAL DOCUMENTATION |
| Groups/mailing lists | Groups can have mailing-list addresses for organizations with a connected mail domain; groups under 10,000 employees can use mailing lists. | OFFICIAL DOCUMENTATION |
| Shared/delegated access | Users can access shared/delegated mailboxes via web interface and email clients; send-as and send-on-behalf modes exist depending on roles/client. | OFFICIAL DOCUMENTATION |
| Plans | Yandex 360 for Business offers Basic, Optimal, Extended plans; costs are per employee, including inactive/blocked users in cost calculation. | OFFICIAL DOCUMENTATION |
| Admin security | Official recommendations include limiting administrator sharing, enabling 2FA, recovery options, and password policy; selected 2FA controls are tied to plan/API capability. | OFFICIAL DOCUMENTATION |

## Initial Model Recommendation

**Recommended for launch: Option A, with safeguards**

Use one real owner mailbox for the current individual operator and attach aliases:

- primary real mailbox: to be chosen by owner, e.g. `support@negotaitions.ru` or a private owner mailbox.
- aliases: `support@negotaitions.ru`, `security@negotaitions.ru`, `business@negotaitions.ru` as appropriate.

Why:

- It matches the current owner-operated state.
- It minimizes licensing/admin overhead.
- Official docs confirm one mailbox can have aliases and can send from aliases.
- The alias limit of 10 is enough for the initial public addresses.

Risks:

- Security, support, and business mail are not separated for audit/delegation.
- Alias login may broaden access paths if not managed carefully.
- Future delegation to staff will require shared mailboxes, groups, or separate accounts.
- Reply-from behavior must be manually tested in web and email clients before publication.

## Option Comparison

| Option | Readiness | Pros | Cons | Recommendation |
| --- | --- | --- | --- | --- |
| A: one real mailbox plus aliases | PARTIALLY READY by docs | Cheapest and simplest; supports receiving and sending from aliases; fits single operator. | Weak separation; future delegation migration; alias sending/client behavior must be verified. | Use initially if owner is sole recipient. |
| B: separate real mailboxes | READY by docs, NOT CONFIGURED | Stronger separation and cleaner audit; easier future delegation. | More employee accounts/licensing; more credentials to secure. | Defer until multiple operators or strict separation is needed. |
| C: shared mailbox/group model | READY by docs, NOT CONFIGURED | Better team delegation, shared mailbox identity, group distribution. | Requires connected domain and at least employee accounts; more admin setup. | Target model when there is more than one operator. |

## Owner Readiness Checklist

Manual actions for the owner; do not perform these in B0:

1. Choose the Yandex account that will own/administer the organization.
2. Create the Yandex 360 organization.
3. Select tariff and confirm payment model.
4. Connect `negotaitions.ru`.
5. Verify the domain using provider-generated DNS records.
6. Add MX/SPF/DKIM records through Yandex Cloud DNS after review.
7. Create the owner mailbox.
8. Add `support@`, `security@`, and `business@` as aliases or separate mailboxes based on the final model.
9. Configure desktop/mobile clients and verify receiving plus reply-from behavior.
10. Configure recovery contacts and secure the administrator account.
11. Enable MFA/login verification where the selected plan/API supports it.
12. Decide whether `security@` must become a separate mailbox or shared mailbox before public launch.

## Domain Coexistence With Postbox

Official Postbox FAQ confirms a Yandex 360 organization primary domain can be used for Postbox mailings. DNS must still be coordinated:

- Yandex 360 owns inbound MX and human mailbox DKIM.
- Postbox owns automated sender identities and its own DKIM records.
- SPF must be one consolidated record, not multiple root SPF TXT records.
- DMARC should align both human and automated senders under the same domain policy.

Evidence source: OFFICIAL DOCUMENTATION, INFERENCE.
