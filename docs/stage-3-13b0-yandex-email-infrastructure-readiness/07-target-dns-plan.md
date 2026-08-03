# Target DNS Coexistence Plan

This is a proposed plan only. No DNS records were changed in B0.

## Current DNS Snapshot

| Record | Current state | Evidence source |
| --- | --- | --- |
| NS | `ns1.yandexcloud.net`, `ns2.yandexcloud.net` | PUBLIC DNS |
| MX | absent | PUBLIC DNS |
| Root TXT/SPF | absent | PUBLIC DNS |
| `_dmarc` TXT | absent | PUBLIC DNS |
| DKIM | no provider selectors known; not guessed | NOT VERIFIED |
| A/wildcard | root, `app`, `www`, `local`, and random wildcard resolve to `172.29.172.1` TTL `0` | PUBLIC DNS |

## Proposed Records

All provider-generated values must be copied from the Yandex 360/Postbox consoles after resources are created. Do not invent verification tokens or DKIM values.

| Purpose | Name | Type | Value | TTL | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Yandex 360 inbound MX | `negotaitions.ru.` | MX | `10 mx.yandex.net.` | initially low, final provider default such as `21600` | Inbound mail | TBD FROM PROVIDER/official docs |
| Yandex 360 ownership verification | TBD | TXT/CNAME | `TBD FROM PROVIDER` | low during verification | Inbound mail | TBD FROM PROVIDER |
| Yandex 360 DKIM | `mail._domainkey.negotaitions.ru.` | TXT | `TBD FROM PROVIDER` | low during verification, then stable | Inbound mail | TBD FROM PROVIDER |
| Postbox domain/address verification simple DKIM 1 | generated selector | CNAME | `TBD FROM PROVIDER` | low during verification | Automated outbound | TBD FROM PROVIDER |
| Postbox domain/address verification simple DKIM 2 | generated selector | CNAME | `TBD FROM PROVIDER` | low during verification | Automated outbound | TBD FROM PROVIDER |
| SPF consolidated | `negotaitions.ru.` | TXT | `v=spf1 include:_spf.yandex.net include:spf.postbox.yandexcloud.net ~all` or stricter variant after validation | low during rollout, then stable | Shared policy | PROPOSED, validate |
| DMARC monitoring | `_dmarc.negotaitions.ru.` | TXT | `v=DMARC1; p=none; rua=mailto:TBD FROM PROVIDER/OWNER; ruf=mailto:TBD FROM PROVIDER/OWNER; fo=1` or minimal `v=DMARC1;p=none` | low during rollout, then stable | Shared policy | DECISION REQUIRED |
| Future DMARC quarantine | `_dmarc.negotaitions.ru.` | TXT | `v=DMARC1; p=quarantine; ...` | stable | Shared policy | FUTURE |
| Future DMARC reject | `_dmarc.negotaitions.ru.` | TXT | `v=DMARC1; p=reject; ...` | stable | Shared policy | FUTURE |

## Conflict Table

| Conflict | Current risk | Resolution |
| --- | --- | --- |
| Multiple SPF TXT records | No current SPF, but future Yandex 360 and Postbox setup could accidentally create two records. | Maintain exactly one root SPF TXT. Combine mechanisms before `all`. |
| Yandex 360 SPF `redirect` plus Postbox include | `redirect=_spf.yandex.net` cannot be combined with Postbox include in the same way as multiple includes. | Use include-based SPF composition and validate with SPF tooling before rollout. |
| DKIM selector collision | Yandex 360 uses `mail._domainkey`; Postbox simple DKIM generates separate CNAME selectors; advanced mode requires one unique selector. | Keep separate selectors. Do not reuse `mail` for Postbox. |
| CNAME with other records | DNS standards disallow CNAME coexistence with other record types at same name. | Use provider-generated unique Postbox selector names only. |
| DMARC reporting mailbox | No reporting mailbox exists. | Decide `dmarc@`, `security@`, or external reporting destination before adding `rua/ruf`. |
| Wildcard/private A response | Public wildcard to `172.29.172.1` may interfere with validation, TLS, and user trust. | Identify and remove/scope wildcard before mail rollout if not intentional. |

## Application Order

1. Clean up or explicitly approve the wildcard/private A behavior.
2. Lower TTLs for affected DNS records before changes where supported.
3. Create/connect Yandex 360 organization and domain.
4. Add/verify Yandex 360 ownership record, MX, and DKIM.
5. Create Postbox address/identity and configuration set in target folder.
6. Add Postbox DKIM/verification records from provider output.
7. Add one consolidated SPF record.
8. Add DMARC with `p=none` monitoring.
9. Verify DNS propagation through public resolvers and provider consoles.
10. Only then perform a controlled manual provider test.

## Propagation Checks

Use public recursive and authoritative checks where available:

```powershell
Resolve-DnsName negotaitions.ru -Type MX -Server 1.1.1.1
Resolve-DnsName negotaitions.ru -Type TXT -Server 1.1.1.1
Resolve-DnsName _dmarc.negotaitions.ru -Type TXT -Server 1.1.1.1
Resolve-DnsName mail._domainkey.negotaitions.ru -Type TXT -Server 1.1.1.1
Resolve-DnsName <postbox-selector> -Type CNAME -Server 1.1.1.1
```

Repeat with `8.8.8.8` and, if reachable, Yandex Cloud authoritative name servers.

## Rollback Order

1. Stop real sending in application/admin switch first.
2. Disable Postbox sender identity/configuration if needed through console.
3. Revert SPF to the last known single valid record.
4. Revert/remove provider DKIM records only after no provider depends on them.
5. Keep MX intact unless rolling back Yandex 360 inbound mail.
6. Keep DMARC at `p=none` during diagnosis rather than deleting it unless it is malformed.

## DMARC Staging

| Phase | Policy | Exit criteria |
| --- | --- | --- |
| Monitor | `p=none` | All human and Postbox sources pass DKIM/SPF alignment; reports reviewed. |
| Quarantine | `p=quarantine` with sampled `pct` if needed | Low false positive rate and stable provider alignment. |
| Reject | `p=reject` | Mature operations, support readiness, and no unknown legitimate senders. |
