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
  Author/collaboration content is Wave 2 `/about`, not a homepage teaser.
- Hero uses one shared photo (`public/images/landing/hero-negotiation-ai.jpg`)
  for both RU and EN. How-it-works still uses locale-specific PNGs from
  `public/images/public-site/` (`public-how-it-works-{ru|en}-no-heading.png`).
  Those bitmaps omit the section title so the HTML heading is not duplicated.
  The active public locale selects the How-it-works bitmap; the other locale’s
  flow image is not shown.
- Wave 1 does not create `/about`, `/faq`, `/support`, or public Materials.
  Public header and footer omit About and FAQ until those routes exist.
  Support uses `mailto:support@negotaitions.ru`.
- Legal routes remain at `/privacy`, `/terms`, `/cookie-policy`,
  `/data-processing-consent`, and `/ai-processing-notice`. Bodies are unchanged
  in Wave 1.

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

- Public `/` and existing legal documents are indexable.
- Auth, app, account-status, join/lobby/room/rejoin, and provider-test routes
  export `privateIndexingMetadata` (`noindex`).
- `robots.ts`, sitemap, canonical, Open Graph, and Webmaster remain Wave 3.
- Analytics remains off.

## Source notes

- `app/(public)/layout.tsx`, `app/(public)/page.tsx`
- `components/public-header.tsx`, `components/public-home-page.tsx`,
  `components/public-visual-frame.tsx`, `components/site-footer.tsx`
- `lib/public-site/visuals.ts`, `public/images/public-site/`,
  `public/images/landing/`
- `lib/seo/indexing.ts`, `lib/i18n/config.ts`
