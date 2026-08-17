# 13 Public Site And Content

## Purpose

The NegotAItions Next.js application contains two experiences:

- a public website for visitors;
- the authenticated negotiation platform.

They share the same runtime, i18n, cookie banner, and legal routes. They use
separate chrome.

## Public website

- Route group: `app/(public)/`.
- `/` always renders the public homepage, including for an authenticated user.
- Public chrome: `components/public-header.tsx` plus root `SiteFooter`.
- Homepage sections: hero, capabilities, high-level training flow, AI/human
  skills positioning, need-based audience cards, platform CTA.
  Author/collaboration content lives on `/about`, not on the homepage.
  The hero headline is two lines: practice negotiation, then AI-assisted
  skill development (RU/EN dictionaries). There is no third slogan line.
- Hero uses one shared photo (`public/images/landing/hero-negotiation-ai.jpg`)
  for both RU and EN. How-it-works still uses locale-specific PNGs from
  `public/images/public-site/` (`public-how-it-works-{ru|en}-no-heading.png`).
  Those bitmaps omit the section title so the HTML heading is not duplicated.
  The active public locale selects the How-it-works bitmap; the other locale’s
  flow image is not shown.
- Wave 2A public communication routes: `/about`, `/support`, `/faq`.
  Public header links About and FAQ to those routes. Footer Information links
  About, Support, and FAQ. Support email remains
  `mailto:support@negotaitions.ru` on the Support (and About/FAQ) copy.
  Support also states that personal-data questions and account-deletion
  requests go to the same address. There is no self-service deletion control.
  The About page defines an author-photo slot and renders the supplied
  full-length portrait at `public/images/public-site/author-portrait-full.jpg`
  with `object-contain` so the standing pose is not cropped to a headshot.
- Legal routes remain at `/privacy`, `/terms`, `/cookie-policy`,
  `/data-processing-consent`, and `/ai-processing-notice`. There are no
  `/en/...` or `/ru/...` legal prefixes. Bodies are the version-2 public
  legal package in `lib/legal/`, stored as canonical RU and EN documents
  selected by the current locale (`negotaitions_locale` cookie/localStorage,
  otherwise `Accept-Language`, fallback `ru`). `LegalDocumentPage` follows
  the same client locale as other public pages (`useI18n`); switching
  language on a legal route keeps that route and immediately shows the
  matching RU or EN body. Server metadata still reads `getServerLocale()`.
  Russian text is primary; English is a counterpart. Draft MVP wording is
  not used on these pages. English legal documents identify the operator on
  first occurrence as `Dmitry Chaadaev (Чаадаев Дмитрий Владимирович)`;
  ordinary public-site EN branding remains `Dmitry Chaadaev` without
  Cyrillic. Locale-specific legal links from `/legal-update` and
  registration use the same routes and current locale; consent identifiers
  stay language-independent. These routes use a compact sticky
  `LegalDocumentHeader` (brand, explicit safe return, RU/EN) rather than
  `PublicHeader` or `AppHeader`. Return uses `returnTo` plus
  `returnContext` (`legal-update`, `register`, `app`, `site`, `home`);
  context is label-only. Destinations pass the credential-aware sanitizer
  in `lib/legal/legal-document-return.ts` (same invite/claim detection as
  `/legal-update`). Direct visits fall back to `/`. Locale switching keeps
  the current legal route and the sanitized return query. `/legal-update`
  may store three checkbox booleans in `sessionStorage` under
  `negotaitions.legalUpdateDraft.<releaseId>` as UI convenience only; that
  draft is not consent evidence and is cleared on successful acceptance or
  logout from `/legal-update`. Registration legal links keep `target=_blank`
  so password fields are not stored, and still carry register return
  context.

## Legal release

`lib/legal/release.ts` is the single current-release definition. Registration
and `/legal-update` both read `getCurrentLegalRelease()`; they do not keep a
separate required-consent list.

Current release:

- `id`: `2026-08-v2`
- `legalVersion`: `2`
- `effectiveDate`: `2026-08-17`
- `requiresExistingUserAction`: `true`
- `requiredConsentTypes`: `TERMS_PRIVACY_ACK_V2`,
  `PERSONAL_DATA_PROCESSING_V2`, `TRAINING_SESSION_NOTICE_V2`

`PERSONAL_DATA_PROCESSING_V2` is the one dedicated personal-data consent.
The other two records are acknowledgements. Historical `UserConsent` rows
(`TERMS_PRIVACY_V1`, `MVP_DATA_LIMITATION_V1`,
`EXTERNAL_INFRASTRUCTURE_V1`) are append-only and never rewritten.

Status is computed from recorded current-release types, not from
`user.createdAt`. If `requiresExistingUserAction` is `false`, existing users
are not blocked even when those types are missing. A later material release
sets `requiresExistingUserAction` to `true` and a new required set; users
missing those records see `/legal-update`.

Enforcement boundary: `requireCurrentLegalRelease` at authenticated
user-entry navigation, not on APIs or provider callbacks. Call sites are
`app/(app)/layout.tsx`, post-login redirect, `app/room/layout.tsx`,
authenticated event lobby, authenticated `/events/[id]/join`,
authenticated `/join/[joinToken]` (after token validation, before claim
mutation), and authenticated `/rejoin`. `/legal-update`, public legal
pages, `/support`, auth/logout, anonymous token-based lobby, and provider
webhooks/callbacks remain outside that gate. Token-bearing return URLs
(`/join/:joinToken`, `joinToken` / `hostToken` / `participantToken`
query, `/events/join/:publicJoinCode`) are discarded; the user continues
from `/dashboard` and reuses the invitation. An already-open browser tab is not
interrupted in real time, and an active negotiation room is not force-closed.
Acceptance is persisted atomically and idempotently by
`persistCurrentLegalReleaseAcceptance`. Proof of current-release
acknowledgement/consent is the stored `UserConsent` rows. Legal-release
enforcement does not depend on email. Optional email notification of material
releases is deferred to a future email-expansion stage.

## Authenticated platform

- Route group: `app/(app)/` with `AppHeader` product IA.
- App header includes a Website / Сайт control to `/`.
- Dashboard, cases, events, sessions, admin, and room/lobby/join flows are
  unchanged in Wave 1.

## Locale

Saved `negotaitions_locale` cookie/localStorage wins. Otherwise
`Accept-Language` may select `ru` or `en`. Fallback with no useful signal is
`ru`. There are no `/ru` or `/en` URL prefixes.

Public/user-facing product and author names are locale-specific:

- RU: product `ПереговорИИ (NegotAItions)`; author/operator
  `Чаадаев Дмитрий Владимирович`.
- EN: product `NegotAItions`; author/operator `Dmitry Chaadaev`.
  English public copy does not include `ПереговорИИ` or a Cyrillic author name.

Internal identifiers, routes, and package names remain `NegotAItions`. Bitmap
logo assets are not regenerated solely to match this textual rule. The same
naming applies to later public/communication pages (About, Support, FAQ, legal
surfaces, SEO/social metadata, footer).

## Indexing

`lib/seo/indexing.ts` is the reusable metadata helper.

- Public `/`, `/about`, `/support`, `/faq`, and existing legal documents are
  indexable.
- Auth, app, `/legal-update`, account-status, join/lobby/room/rejoin, and
  provider-test routes export `privateIndexingMetadata` (`noindex`).
- `robots.ts`, sitemap, canonical, Open Graph, and Webmaster remain Wave 3.
- Analytics remains off.

## Source notes

- `app/(public)/layout.tsx`, `app/(public)/page.tsx`,
  `app/(public)/about/page.tsx`, `app/(public)/support/page.tsx`,
  `app/(public)/faq/page.tsx`
- `components/public-header.tsx`, `components/public-home-page.tsx`,
  `components/public-about-page.tsx`, `components/public-support-page.tsx`,
  `components/public-faq-page.tsx`, `components/public-visual-frame.tsx`,
  `components/site-footer.tsx`
- `lib/public-site/visuals.ts`, `lib/public-site/faq-items.ts`,
  `lib/public-site/author-portrait.ts`, `public/images/public-site/`,
  `public/images/landing/`
- `lib/seo/indexing.ts`, `lib/i18n/config.ts`,
  `lib/i18n/dictionaries/en.ts`, `lib/i18n/dictionaries/ru.ts`,
  `lib/legal/`, `lib/consent/user-consent.ts`,
  `lib/auth/registration.ts`, `app/privacy/page.tsx`, `app/terms/page.tsx`,
  `app/cookie-policy/page.tsx`, `app/data-processing-consent/page.tsx`,
  `app/ai-processing-notice/page.tsx`, `app/legal-update/page.tsx`,
  `app/actions/legal-release.ts`, `components/legal-document-page.tsx`,
  `components/legal-document-header.tsx`, `components/legal-update-view.tsx`,
  `components/legal-release-checkboxes.tsx`,
  `lib/legal/require-current-release.ts`,
  `lib/legal/legal-update-return-url.ts`,
  `lib/legal/legal-document-return.ts`,
  `lib/legal/legal-update-draft.ts`
