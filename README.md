# NegotAItions

Negotiation-training product: case-based sessions, event lobbies, recording,
transcription, enhancement, and AI debrief. Public site and authenticated
platform share one Next.js application.

Current documentation baseline (this branch) starts from production candidate
`308c1c74eb355724fd3377354c07d9821a0cb3f1`.

## Start here

- Product contract: [`docs/requirements/PRODUCT-REQUIREMENTS.md`](docs/requirements/PRODUCT-REQUIREMENTS.md)
- Architecture: [`docs/architecture/README.md`](docs/architecture/README.md)
- Code map: [`docs/architecture/code-map.md`](docs/architecture/code-map.md)
- Documentation governance: [`docs/DOCUMENTATION-GOVERNANCE.md`](docs/DOCUMENTATION-GOVERNANCE.md)
- Native agent routing: [`AGENTS.md`](AGENTS.md)

Historical audits, stage manifests, and checkpoints:
[`docs/history/README.md`](docs/history/README.md).

## Runtime

- Next.js App Router, PostgreSQL via Prisma
- Video: Voximplant or LiveKit (explicit `VIDEO_PROVIDER`, no app default)
- Transcription / AI / storage / email: Yandex services when selected
- Health: `GET /api/health`

Do not commit secrets. Do not wholesale-copy `.env`. Engineering Orchestrator
owns Change Unit bootstrap and TYPED_IMPORT.

## Brand assets

Exact raster logos (do not approximate as SVG in this iteration):

| Locale | Full | Compact | Session |
| --- | --- | --- | --- |
| Russian UI | `public/brand/negotaitions-logo-full-ru.png` | `public/brand/negotaitions-logo-compact-ru.png` | `public/brand/negotaitions-logo-session-ru.png` |
| English UI | `public/brand/negotaitions-logo-full-en.png` | `public/brand/negotaitions-logo-compact-en.png` | `public/brand/negotaitions-logo-session-en.png` |

Icon / favicon: `public/brand/negotaitions-icon.png`, `public/favicon.ico`,
`app/icon.png`, `app/apple-icon.png`.

Do not display both brand names simultaneously. Use RU assets for Russian UI
and EN assets for English UI. Product architecture:
[`docs/architecture/13-public-site-and-content.md`](docs/architecture/13-public-site-and-content.md).
