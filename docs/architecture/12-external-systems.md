# 12 External Systems

## External Systems In Runtime Architecture

- PostgreSQL (primary relational data store).
- Voximplant (real-time media + scenario-driven recording control path).
- Yandex Object Storage (recording object storage).
- Yandex SpeechKit (transcription and speaker labeling).
- Yandex AI / YandexGPT-compatible model endpoint usage (analysis and transcript enhancement paths).
- Yandex Cloud Postbox (email sending through SES-compatible API when enabled).
- Yandex Data Streams (disabled-by-default Postbox provider-event ingestion).
- Yandex Metrica (optional public-site traffic analytics after cookie consent).
- Yandex Webmaster (external ownership already confirmed via DNS TXT; used after deploy for robots/sitemap/re-crawl/diagnostics).
- Yandex infrastructure VM runtime hosting app process.

## Roles By System

- Voximplant:
  - Room/lobby conferencing transport in Vox mode.
  - Scenario webhook callback for recording completion/status.
- Yandex SpeechKit:
  - Async STT with diarization data for transcript pipeline.
- Yandex AI model endpoints:
  - Negotiation analysis generation.
  - Optional transcript enhancement in configured flows.
- PostgreSQL:
  - Source of truth for domain, runtime, and processing states.
- Yandex Postbox:
  - Sends password-reset/account-security mail only when delivery is explicitly
    enabled.
  - The verified production sender policy allows
    `no-reply@negotaitions.ru`, `notifications@negotaitions.ru`, and
    `invitations@negotaitions.ru`; all application sender roles must resolve to
    that explicit allowlist.
  - Provider-event subscription should emit only Send, Delivery, DeliveryDelay,
    Bounce, Complaint, and Rendering Failure during Stage 3.13C canary.
- Yandex Data Streams:
  - Kinesis-compatible consumer source for Postbox provider events.
  - Requires dedicated consumer static-key credentials; do not reuse Postbox
    sending credentials.
  - No public webhook route is part of this architecture.
- Object storage:
  - Dedicated recording/audio-artifact bucket:
    `negotiations-recordings-dev-bucket`.
  - Existing object-key formats are unchanged; there is no
    `recordings/raw/` namespace and no historical object migration.
  - Operator-managed Yandex lifecycle: 90-day expiration for all objects,
    no prefix filter, replacing any older prefix-specific 14-day rule.
    The application does not configure lifecycle at runtime.
  - Recording file persistence and retrieval for processing. Physical
    object deletion does not delete saved transcript or AI material.
- Yandex Metrica:
  - Optional public-site traffic statistics after analytics cookie consent.
  - SPA init uses `defer: true` plus explicit pathname `hit`; `destruct` on
    consent withdrawal and when leaving public routes.
  - Not used for authenticated product, room, join, admin, or legal-update.
  - Webvisor / session replay is not enabled.
- Yandex Webmaster:
  - Ownership of `https://negotaitions.ru` is already confirmed via DNS TXT.
  - Application code does not participate in ownership verification.
  - After public-site SEO deploy: check `/favicon.ico`, robots.txt,
    sitemap.xml, re-crawl important public pages, and review site diagnostics.

## Network And Runtime Model

- App domains in active architecture docs:
  - `negotaitions.ru`
  - `app.negotaitions.ru`
  - `local.negotaitions.ru` (local/tunnel testing domain)
- These domains are deployment examples, not a browser copy-link allowlist.
  Interactive invitation copies use the page's actual origin; server and email
  generation uses configured canonical origins.
- Reverse-proxy + process-manager model:
  - nginx in front of Node runtime.
  - systemd service `negotaitions-poc` running app process.
  - nginx access logs use the sanitized format in
    `deploy/nginx/sanitized-access-log.conf` so query strings and
    token-bearing pathname segments are not persisted.

## SSH Reverse Tunnel Role

- Reverse tunnel is used in local Vox/webhook test workflows to expose local app endpoints to external callback flows.
- This is an operational test aid, not a production runtime requirement.

## JustHost Note

- JustHost is not confirmed in current runtime code/docs as an active production dependency for NegotAItions app runtime.
- Status: "not part of production app runtime / to confirm".

## Security Note

- No credentials, tokens, private keys, or secret env values are documented here.
- Postbox and Data Streams credentials are independently classified by the
  typed server runtime-setting registry. Administrative diagnostics derive
  from that classification and always serialize secret values as `null`.
- Control-plane identifiers and the sender/template matrix are recorded in
  `email-runtime-and-yandex-cloud.md` without credentials.

## Provider processing geography (Stage 3.15A amendment, recorded 2026-08-19)

On 2026-08-19 ООО «Фастком» (Voximplant), ИНН 7702764401, confirmed in writing
that processing performed by the provider, including media-traffic processing
and technical support, is performed within the Russian Federation and that
cross-border transfer by the provider is not performed. The provider also
confirmed that client-selected recording storage means the recording is saved
to the client's storage and ООО «Фастком» does not retain a copy on its own
servers.

This register entry is a factual summary only. The private correspondence is
not published. After Manual Checkpoint D, Voximplant-scoped user-facing copy
lives in `/ai-processing-notice` and the Privacy Policy. It must not be
rewritten as a platform-wide claim that every NegotAItions data path stays
inside the Russian Federation.

## Source Notes

- `lib/services/yandex-speechkit-transcription.ts`
- `lib/ai/negotiation-analysis.ts`
- `lib/services/transcription-runner.ts`
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
