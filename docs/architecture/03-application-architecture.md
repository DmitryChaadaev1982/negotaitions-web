# 03 Application Architecture

## Runtime Stack

- Next.js App Router `16.3.3` with React / React DOM `19.2.8`.
- Server Actions for core CRUD and orchestration. The RSC / Server Function
  implementation is vendored inside Next (`react-server-dom-*-builtin`); it is
  not a separately installed npm package.
- Next Image Optimization remains enabled for local public assets. Next
  `16.3.3` disables AVIF output while the vendor libheif issue is addressed
  (`GHSA-2xp9-vwfh-vxw4`). The product does not require AVIF.
- Route handlers under `app/api/**` for room/event/materials/diagnostics workflows.
- Prisma client for persistence (`7.10.0`).

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
- Indexing policy lives in `lib/seo/indexing.ts`. Canonical host, robots,
  sitemap, Open Graph, and public-site Metrica:
  `13-public-site-and-content.md` and
  `docs/operations/public-site-seo-and-analytics.md`.

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
- `lib/account-dashboard-view-model.ts` maps account-visible Session/Event
  list items into the Dashboard presentation DTO. The server page and the
  mounted client both use this builder.
- `app/(app)/dashboard/page.tsx` loads account-visible data through
  `getSessionsForUser` / `getEventsForUser` for the first paint.
- A mounted Dashboard then uses the same visible-list poll as `/sessions` and
  `/events` (`LIST_OVERVIEW_POLL_INTERVAL_MS` = 2_000, pause while hidden,
  refresh on focus/visible, `cache: "no-store"`). Poll responses come from
  `/api/sessions/list` and `/api/events/list`, not from a Dashboard-specific
  realtime channel. Session and Event last-good snapshots are independent:
  one failed list response does not block applying the other.

## List overview freshness

- `/sessions` polls `/api/sessions/list`.
- `/events` polls `/api/events/list`.
- `/dashboard` polls both list routes in one shared 2-second interval and
  rebuilds the view model from latest-good Sessions plus latest-good Events.
- Shared client primitive: `lib/list-overview-polling.ts` and
  `lib/use-visible-list-poll.ts`. Create/update/delete/status changes appear
  on the next successful poll of that side; create actions may also
  `revalidatePath` the server page, but an already-mounted Dashboard does not
  depend on `router.refresh()`.

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
- `app/(app)/dashboard/page.tsx`
- `components/account-dashboard-view.tsx`
- `lib/account-dashboard-view-model.ts`
- `lib/list-overview-polling.ts`
- `lib/use-visible-list-poll.ts`
- `components/public-header.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `lib/voximplant/use-voximplant-room.ts`
- `app/api/sessions/**`
- `app/api/events/**`
