# 03 Application Architecture

## Runtime Stack

- Next.js app router application.
- Server actions for core CRUD and orchestration.
- Route handlers under `app/api/**` for room/event/materials/diagnostics workflows.
- Prisma client for persistence.

## Architectural Layers

- UI/Pages: `app/**`, `components/**`.
- Domain orchestration: `app/actions/**`, `lib/**`.
- Integration adapters: `lib/voximplant/**`, `lib/services/**`, `lib/storage/**`, `lib/ai/**`.
- Persistence: `prisma/schema.prisma`, `lib/prisma.ts`.

## Public website and platform chrome

- Public `/` is a marketing homepage in `app/(public)/`, not a dashboard
  redirect.
- Public chrome is `PublicHeader`; product chrome is `AppHeader` in
  `app/(app)/`. Legal document routes (`/privacy`, `/terms`,
  `/cookie-policy`, `/data-processing-consent`, `/ai-processing-notice`)
  use a compact `LegalDocumentHeader` (brand, contextual return, locale)
  instead of marketing or platform navigation.
- Authenticated product pages in `app/(app)/` and fresh authenticated
  room/lobby/join/rejoin entry are gated by the current legal release when
  `requiresExistingUserAction` is true and required `UserConsent` records
  are missing. Public legal routes, anonymous token-based lobby, and
  provider callbacks are outside that gate. Already-open room tabs and
  active media connections are not force-terminated by a legal-version
  change; the next server navigation, reload, or fresh authenticated entry
  applies the gate.
- Indexing policy lives in `lib/seo/indexing.ts`. Details:
  `13-public-site-and-content.md`.

## Provider Selection

- Video provider: `getVideoProvider()` from `lib/env.ts`.
- Transcription provider: `getTranscriptionProvider()` from `lib/env.ts`.
- AI analysis provider: `getAiAnalysisProvider()` from `lib/env.ts`.

## Room Composition

- Shared orchestration shell: `components/shared-room-shell.tsx`.
- Debrief retains its status badge, timer card, panel, finish-line transition,
  and accessibility announcement without an additional persistent completion
  banner.
- Provider-specific room implementation:
  - `components/video-room-page.tsx` (LiveKit).
  - `components/voximplant-negotiation-room-page.tsx` (Voximplant).

## Dashboard Selection

- `lib/dashboard-activity-selection.ts` is the pure classification and
  deterministic ordering layer for Dashboard room/Event candidates.
- Session eligibility reuses terminal display compatibility, while nonterminal
  `DRAFT`, `LOBBY_OPEN`, and `SESSION_CREATED` Events remain presentation
  candidates. Historical completed materials are not a current-room fallback.
- Dashboard selection does not decide or grant Event lobby or Session room
  access; existing entry authorization remains independent.
- `app/(app)/dashboard/page.tsx` loads account-visible data and maps the
  selected room or nearest eligible Event into the presentation DTO.

## Legacy Terminal Operations

- Runtime display treats FINISHED+CLOSED, and the pre-lifecycle
  FINISHED+NULL compatibility shape, as terminal independently of stale coarse
  `Session.status`.
- `scripts/ops/normalize-legacy-session-terminal-state.ts` is a separate,
  dry-run-default metadata normalization tool. Apply mode is count-fenced and
  does not participate in normal request lifecycle.

## API Domains

- Session control and room state.
- Event lobby state and assignment.
- Recording/transcription/materials.
- Speaker mapping and telemetry processing.
- Admin/service diagnostics.

## Source Notes

- `lib/env.ts`
- `lib/config.ts`
- `app/(public)/page.tsx`
- `components/public-header.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `app/api/sessions/**`
- `app/api/events/**`
