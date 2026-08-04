# ADR 0001: Email Provider and Template Foundation

## Status

Accepted for Stage 3.13B.

## Context

NegotAItions needs secure operational email for future account recovery, account security, invitations, reminders, and administrative notifications. Stage 3.13B must create the foundation without enabling real production sending or implementing later business triggers.

## Decisions

- DNS for `negotaitions.ru` is managed through Yandex Cloud DNS.
- Yandex 360 organization and mailboxes are not configured yet.
- Yandex Cloud Postbox is not configured yet and requires readiness verification.
- Current site operator: Чаадаев Дмитрий Владимирович.
- `support@negotaitions.ru`, `security@negotaitions.ru`, and `business@negotaitions.ru` will be routed to Dmitry when Yandex 360 is configured.
- Application outbound email will use Yandex Cloud Postbox if readiness does not reveal blockers.
- Business code will depend only on a narrow email provider interface.
- Templates are repository-managed files, support RU/EN, and are not stored or edited in the DB in Stage 3.13B.
- Only safe allowlisted variables are supported. No JavaScript, arbitrary HTML evaluation, expression evaluation, dynamic filesystem paths, or runtime code execution is allowed.
- Delivery uses a durable database outbox with DB-level idempotency and a bounded worker.
- Default production sending remains disabled.
- Retention is controlled by env with documented defaults.
- Password reset for `BLOCKED` and `REJECTED` users will be rejected in Stage 3.13C without reset token creation, while preserving public anti-enumeration semantics.
- Stage 3.13D Event invitations require date, time, and timezone and must route through a secure account/invitation flow.
- Standalone Session invitations may be sent when an email is provided in Stage 3.13D.
- Permanent bearer access tokens must not be directly placed in email.

## Consequences

The application can enqueue, inspect, retry, suppress, retain, and test email records locally with delivery disabled. Production activation still requires Yandex 360, Postbox sender identity, credentials, DNS records, provider event pipeline, worker installation, and monitoring.

No Stage 3.13C or Stage 3.13D business triggers are implemented by this ADR.
