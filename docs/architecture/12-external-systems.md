# 12 External Systems

## External Systems In Runtime Architecture

- PostgreSQL (primary relational data store).
- Voximplant (real-time media + scenario-driven recording control path).
- Yandex Object Storage (recording object storage).
- Yandex SpeechKit (transcription and speaker labeling).
- Yandex AI / YandexGPT-compatible model endpoint usage (analysis and transcript enhancement paths).
- Yandex Cloud Postbox (email sending through SES-compatible API when enabled).
- Yandex Data Streams (disabled-by-default Postbox provider-event ingestion).
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
  - Recording file persistence and retrieval for processing.

## Network And Runtime Model

- App domains in active architecture docs:
  - `negotaitions.ru`
  - `app.negotaitions.ru`
  - `local.negotaitions.ru` (local/tunnel testing domain)
- Reverse-proxy + process-manager model:
  - nginx in front of Node runtime.
  - systemd service `negotaitions-poc` running app process.

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

## Source Notes

- `lib/services/yandex-speechkit-transcription.ts`
- `lib/ai/negotiation-analysis.ts`
- `lib/services/transcription-runner.ts`
- `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
