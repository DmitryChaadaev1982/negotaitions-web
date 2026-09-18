# Stage 3.14A Authoritative Requirement Manifest

## Authority and use

This is the authoritative, implementation-independent requirement manifest for
Stage 3.14A — Public Site & Content Foundation. The approved Wave 0 audit
packet and the subsequent user/ChatGPT approval checkpoint are the product
authority. Current architecture documents may confirm or refine a requirement;
historical stage reports, existing tests, and implementation claims are
supporting evidence only and cannot add, weaken, or replace a requirement.

Each row is one independently judged requirement. “Source” refers to the
approved packet section unless an architecture document is named. Evidence
types used here: `CODE`, `TEST`, `BEHAVIOR`, `DOM`, `SCREENSHOT`, `MANUAL`.
Visual requirements cannot PASS from source inspection alone.

Wave ownership:

- Wave 1 — Public shell + homepage (packaged).
- Wave 2A — About, Support, FAQ public communication pages (this
  implementation), including the supplied author portrait on `/about`.
- Wave 2 — remaining legal rewrite and later product screenshot visuals.
- Wave 3 — Analytics (after consent/legal sync), robots, sitemap, canonical,
  Open Graph, Webmaster, communication-page governance.

Status values: `APPROVED`, `PROPOSED`, `DECISION_REQUIRED`, `OUT_OF_SCOPE`,
`SUPERSEDED`. After the approval checkpoint, the numbered decisions in the
implementation packet are `APPROVED`, not `DECISION_REQUIRED`.

## Public branding / i18n (Stage 3.14A, all waves)

Locale-specific public/user-facing identity. Internal code, routes, package
names, and technical documentation may keep `NegotAItions`.

| Locale | Product name | Author / operator identity |
| --- | --- | --- |
| Russian | `ПереговорИИ (NegotAItions)` | `Чаадаев Дмитрий Владимирович` |
| English | `NegotAItions` | `Dmitry Chaadaev` |

English public copy must not include `ПереговорИИ` or a Cyrillic author name.
A shorter Russian author form is allowed only where the full FIO is stylistically
excessive; canonical public/legal identity remains the full FIO.

This applies to Wave 1 public shell/homepage/footer/metadata copy and to later
Stage 3.14A public/communication surfaces: About, Support, FAQ, Privacy, Terms,
Cookie Policy, Consent, AI/external-providers notice, SEO metadata,
Open Graph/social metadata, footer, and future public content pages.

Legal page **bodies** remain unchanged in Wave 1; Wave 2 rewrite must follow
this table.

## Evidence profiles

| Requirement IDs | Required evidence for PASS | Supporting evidence |
| --- | --- | --- |
| S314A-IA-001–014 | CODE + TEST or BEHAVIOR | DOM |
| S314A-HDR-001–008 | DOM or SCREENSHOT + BEHAVIOR | CODE, TEST |
| S314A-HOME-001–006, 008, 023–025 | SCREENSHOT + MANUAL | CODE, DOM |
| S314A-HOME-009–022, 026 | DOM or BEHAVIOR + TEST | CODE |
| S314A-COPY-001–005, 007 | DOM | CODE, SCREENSHOT, MANUAL |
| S314A-LOC-001–004 | CODE + TEST | BEHAVIOR |
| S314A-SEO-001–005 | CODE + TEST | DOM |
| S314A-FTR-001–006 | DOM + TEST | CODE, SCREENSHOT |
| S314A-APP-001–003 | DOM or BEHAVIOR | CODE, TEST |
| Wave 2/3 `APPROVED` rows | not required for Wave 1 PASS | — |
| `OUT_OF_SCOPE` rows | CODE/TEST showing absence of the forbidden work | — |

Wave 1 packaging must not treat Wave 2/3 IDs as implementation failures.
Those IDs remain `APPROVED` for later waves and are judged `DEFERRED` until
their wave starts.

| ID | Wave | Status | Requirement | Source / rationale | Verification type(s) | Relevant runtime surface | Acceptance criterion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S314A-IA-001 | 1 | APPROVED | Public website and authenticated platform use separate logical chrome/layout inside the same Next.js application. | Packet A, decision 1 | CODE, TEST | `/` vs `/dashboard` | Public `/` does not render `AppHeader` product IA; `/dashboard` does not render the public visitor header as its primary chrome. |
| S314A-IA-002 | 1 | APPROVED | `/` always renders the public homepage, including for an authenticated user. Authenticated `/` must not redirect to `/dashboard`. | Packet A/Q, decision 2 | CODE, TEST, BEHAVIOR | `/` | Unauthenticated and authenticated GET `/` remain on `/` and render homepage content. |
| S314A-IA-003 | 1 | APPROVED | Authenticated users reach the platform in one obvious click. | Packet A/E, decision 3 | DOM, BEHAVIOR, TEST | Public `/` | Primary authenticated action `Перейти в платформу` / equivalent EN navigates to `/dashboard`. |
| S314A-IA-004 | 1 | APPROVED | Public and app headers are different information architectures. | Packet E, decision 6 | DOM, SCREENSHOT | Public header vs `AppHeader` | Public header is visitor-oriented; app header remains product-oriented (Dashboard, trainings group). |
| S314A-IA-005 | 1 | APPROVED | Future public `Материалы` architecture is reserved and is not exposed as an empty or disabled navigation item. | Packet D/E, decision 7 | DOM, TEST | Public header/footer | No public nav/footer item labelled Materials/Материалы, including “soon”/disabled doors. |
| S314A-IA-006 | 1 | APPROVED | Do not create fake future pages solely to activate navigation labels. | Packet D | CODE, TEST | `/about`, `/faq`, `/support` | Wave 1 does not add empty `/about`, `/faq`, or `/support` routes. |
| S314A-IA-007 | 1 | APPROVED | Public information architecture is `/` now; `/about`, `/support`, `/faq` in Wave 2; existing legal routes remain. | Packet D | CODE | Public IA | Wave 1 implements `/` and keeps legal routes; About/Support/FAQ pages are not built. |
| S314A-IA-008 | 1 | APPROVED | Authenticated platform routes remain `/dashboard`, `/cases`, `/events`, `/sessions`, `/admin`, and existing lobby/session/room/materials runtime. | Packet D | CODE | App routes | Those routes continue to exist; Wave 1 does not redesign their business functionality. |
| S314A-IA-009 | 1 | APPROVED | Do not introduce `/ru` or `/en` URL prefixes in Stage 3.14A. | Packet P | CODE, TEST | Routing | Locale is cookie/storage/Accept-Language based, not path-prefixed. |
| S314A-IA-010 | 1 | APPROVED | Do not add a broad auth middleware that risks existing join/session flows unless a concrete architectural need is proven. | Packet Q | CODE | `middleware.ts` / join/room | Join, lobby, and room auth remain route-level; no new global auth gate on those paths. |
| S314A-IA-011 | 1 | APPROVED | Preserve existing route-level auth behavior for application routes. | Packet Q | CODE, TEST | `/dashboard` | Unauthenticated `/dashboard` still redirects to login with `returnUrl=/dashboard`. |
| S314A-IA-012 | 1 | APPROVED | No database/schema changes, no Prisma migrations, no join/lobby/room behavioral changes, no account/auth policy changes. | Packet Q/W | CODE | Schema, room, auth | Wave 1 diff contains none of those mutations. |
| S314A-IA-013 | 1 | APPROVED | There is an obvious route from the authenticated app chrome to the public site. | Packet E | DOM, BEHAVIOR | App header/footer | Authenticated app surfaces a working control to `/` without hunting. |
| S314A-IA-014 | 1 | APPROVED | The product remains one Next.js application containing two experiences: public website + negotiation platform. | Packet A | CODE | App Router | Public and platform routes coexist in the same app; no separate marketing site repo. |
| S314A-HDR-001 | 1 | APPROVED | Do not reuse the authenticated working header unchanged as the public-site header. | Packet E | CODE, DOM | Public `/` | Public header component is distinct from `AppHeader`. |
| S314A-HDR-002 | 1 | APPROVED | Desktop unauthenticated public header hierarchy: brand, Возможности, Как это работает, RU/EN, Войти, Регистрация. Об авторе and FAQ are omitted until their Wave 2 destinations exist. | Packet E; user visual checkpoint 2026-08-16 | DOM, SCREENSHOT | Public header desktop | Those Wave 1 labels/actions are present; About and FAQ are omitted because `/about` and `/faq` do not exist. |
| S314A-HDR-003 | 1 | SUPERSEDED | SUPERSEDED by S314A-ABOUT-001 and S314A-ABOUT-003 (`user visual checkpoint 2026-08-16`). Original: Wave 1 “Об авторе” may link to the homepage author section. | Packet E; superseded 2026-08-16 | DOM, TEST | Public header | Historical record only. Do not keep `/#author` or an About nav item in Wave 1. |
| S314A-HDR-004 | 1 | APPROVED | Prefer omitting a Wave-2 route from first implementation rather than creating a fake destination. | Packet E | DOM | Public header/footer | No href to missing `/about`, `/faq`, or `/support` pages. |
| S314A-HDR-005 | 1 | APPROVED | Authenticated visitor on `/` sees the same public homepage; primary action is `Перейти в платформу` → `/dashboard`; Login/Register are not shown as the primary path. | Packet E/H | DOM, BEHAVIOR, TEST | Public `/` authenticated | Platform CTA present; Login/Register not used as primary CTAs. |
| S314A-HDR-006 | 1 | APPROVED | Mobile public navigation is a proper scalable menu using established component patterns, not the existing horizontal-only header, and not a new heavy hamburger dependency. | Packet E/Y | DOM, BEHAVIOR, SCREENSHOT | Public `/` ~375px | Menu is keyboard-accessible, not hover-only, and does not introduce a new nav library. |
| S314A-HDR-007 | 1 | APPROVED | Authenticated app header remains product-oriented: Dashboard; Negotiation trainings / Переговорные тренировки grouping Cases/Events/Sessions; existing admin/rejoin/language/account behavior. | Packet E | DOM | App header | Existing product IA is preserved. |
| S314A-HDR-008 | 1 | APPROVED | Important CTA/navigation is not hidden behind hover-only behavior. | Packet Y | BEHAVIOR, DOM | Public header | Primary links and mobile menu are available to keyboard and touch. |
| S314A-HOME-001 | 1 | APPROVED | Homepage includes a Hero section. | Packet F/H | SCREENSHOT, MANUAL | `/#hero` or hero landmark | Hero is visually present with approved headline/body/CTAs. |
| S314A-HOME-002 | 1 | APPROVED | Homepage includes a Capabilities section with four approved cards. | Packet F/I | SCREENSHOT, MANUAL | `/` capabilities | Four cards match approved concepts; no provider names. |
| S314A-HOME-003 | 1 | APPROVED | Homepage includes a high-level “how training works” section with the four approved steps. | Packet F/J | SCREENSHOT, MANUAL | `/` flow | Four steps only; not an instruction manual. |
| S314A-HOME-004 | 1 | APPROVED | Homepage includes a standalone AI / human-skills positioning section with visual prominence. | Packet F/K | SCREENSHOT, MANUAL | `/` AI section | Approved headline/body; no objective-accuracy claim. |
| S314A-HOME-005 | 1 | APPROVED | Homepage includes a need-based audience section (not a role list) with the approved headline and four cards: build skill, prepare for important conversations, get more from practice, train with others. | Packet F/L; visual checkpoint 2026-08-16 | SCREENSHOT, MANUAL | `/` audience | Four need cards render; no role-based club/facilitator/participant/observer list; no fake logos, stats, testimonials, or client names. |
| S314A-HOME-006 | 1 | APPROVED | Homepage includes a platform CTA section. | Packet F | SCREENSHOT, DOM | `/` CTA | Unauth: login/register hierarchy; auth: go to platform. |
| S314A-HOME-007 | 1 | SUPERSEDED | SUPERSEDED by S314A-ABOUT-001 (`user visual checkpoint 2026-08-16`). Original: homepage includes a short author/collaboration teaser. | Packet F/M; superseded 2026-08-16 | SCREENSHOT, MANUAL | `/#author` | Historical record only. Wave 1 homepage must not include the author/collaboration section. |
| S314A-HOME-008 | 1 | APPROVED | Homepage includes the public footer. | Packet F/O | SCREENSHOT, DOM | `/` footer | Footer groups and legal destinations render. |
| S314A-HOME-009 | 1 | APPROVED | Homepage is complete in RU and EN. | Packet P/G | DOM, TEST | `/` | Switching locale changes homepage copy; both languages include required sections. |
| S314A-HOME-010 | 1 | APPROVED | New public textual copy uses locale-specific product naming: RU `ПереговорИИ (NegotAItions)`; EN `NegotAItions`. Do not show the Cyrillic product name in English public copy. Internal identifiers remain `NegotAItions`. | Packet G, decision 5; branding/i18n correction 2026-08-16 | DOM | Public `/` copy | RU public strings name the product as `ПереговорИИ (NegotAItions)`; EN public strings name it `NegotAItions` only. |
| S314A-HOME-011 | 1 | APPROVED | Do not rename internal code identifiers, package names, routes, or technical documentation terminology solely for branding. | Packet G | CODE | Identifiers | Runtime/package/route names remain NegotAItions/technical as today. |
| S314A-HOME-012 | 1 | APPROVED | Homepage is a public product page, not a detailed product manual; it does not document every screen, button, facilitator action, or room state. | Packet F/J/S | DOM, MANUAL | `/` | No click-by-click operating instructions. |
| S314A-HOME-013 | 1 | APPROVED | Capability cards do not name technical providers. | Packet I | DOM | Capabilities | No Yandex/Voximplant/LiveKit/OpenAI/Whisper names on cards. |
| S314A-HOME-014 | 1 | APPROVED | Use existing brand/entity pictograms where they fit; do not regenerate logo bitmaps solely to embed the combined textual name. | Packet G/I/N | CODE, SCREENSHOT | `/` | Visuals use existing `public/brand` and object pictograms or CSS treatments. |
| S314A-HOME-015 | 1 | APPROVED | Training-flow section stays high-level and does not expose every internal object/state. | Packet J | DOM, MANUAL | `/` flow | Only the four approved public steps. |
| S314A-HOME-016 | 1 | APPROVED | Do not claim objective AI accuracy. | Packet K | DOM | AI section | Copy does not claim correctness/accuracy of AI output. |
| S314A-HOME-017 | 1 | APPROVED | Do not invent customer logos, commercial usage statistics, testimonials, case studies, or client names. | Packet L | DOM, SCREENSHOT | Audience | None of those fabricated social-proof devices appear. |
| S314A-HOME-018 | 1 | APPROVED | Homepage must not include an author portrait or author/collaboration teaser. Portrait and full author copy belong to `/about` in Wave 2. | Packet M, decision 13; user visual checkpoint 2026-08-16 | SCREENSHOT, DOM | `/` | No author section, portrait, Chaadaev biography, or collaboration CTA on the homepage. |
| S314A-HOME-019 | 1 | APPROVED | Wave 1 public contact in the footer uses `mailto:support@negotaitions.ru`; do not create `/support`. | Packet T | DOM, TEST | Footer support | Destination is a working mailto, not a missing route. |
| S314A-HOME-020 | 1 | APPROVED | Unauthenticated hero CTA hierarchy: primary `Войти в платформу` → `/login`; secondary `Зарегистрироваться` → `/register`; text/anchor `Узнать, как это работает`. | Packet H | DOM, TEST | Hero | Those targets and hierarchy exist in RU and structurally equivalent EN. |
| S314A-HOME-021 | 1 | APPROVED | Authenticated hero primary CTA is `Перейти в платформу` → `/dashboard`; Login/Register are not the primary path. | Packet H | DOM, TEST | Hero authenticated | Dashboard CTA present; login/register not primary. |
| S314A-HOME-022 | 1 | APPROVED | EN homepage is structurally equivalent; do not invent additional marketing claims. | Packet H/G | DOM | `/` EN | EN covers the same sections/ideas without extra claims. |
| S314A-HOME-023 | 1 | APPROVED | Do not fabricate fake product screenshots, generic stock negotiation photos, or generic AI brain/robot imagery. | Packet N | SCREENSHOT, MANUAL | `/` | Visuals are brand/pictogram/CSS composition; no stock/AI-cliché photos. |
| S314A-HOME-024 | 1 | APPROVED | Layout can later receive real screenshots without a large refactor; avoid ugly “IMAGE PLACEHOLDER” boxes. | Packet N | SCREENSHOT, MANUAL | `/` | Composition is complete and tasteful without placeholder copy. |
| S314A-HOME-025 | 1 | APPROVED | Visual language is professional, calm, contemporary, recognizably part of the existing product; good RU typography; responsive; dark/light only where the product already supports it. | Packet Y | SCREENSHOT, MANUAL | `/` | Manual visual checkpoint accepts direction; current product is dark-first. |
| S314A-HOME-026 | 1 | APPROVED | Existing cookie banner continues to work on public `/`. | Packet Z | TEST, BEHAVIOR | `/` cookie banner | Banner still appears for a new visitor on `/`. |
| S314A-HOME-027 | 1 | APPROVED | Accessibility: semantic headings, keyboard-accessible mobile nav, visible focus, alt text where applicable; no text embedded into newly generated bitmap assets. | Packet Y | DOM, BEHAVIOR | `/` | Heading outline exists; images that convey meaning have alt; no new text-in-bitmap assets. |
| S314A-COPY-001 | 1 | APPROVED | RU hero headline is exactly: `Тренируйте переговоры.` / `Используйте возможности ИИ.` / `Становитесь сильнее в переговорах.` | Packet H; user visual checkpoint 2026-08-16 | DOM | Hero RU | Exact approved lines. |
| S314A-COPY-002 | 1 | APPROVED | RU hero body is the approved two-paragraph product explanation, including that AI does not negotiate for the user. | Packet H | DOM | Hero RU | Approved body present. |
| S314A-COPY-003 | 1 | APPROVED | Four RU capability titles/bodies match the approved packet. | Packet I | DOM | Capabilities RU | Exact approved concepts/copy. |
| S314A-COPY-004 | 1 | APPROVED | Four RU training-flow steps match the approved packet. | Packet J | DOM | Flow RU | Exact approved steps. |
| S314A-COPY-005 | 1 | APPROVED | RU AI section headline and body match the approved packet. | Packet K | DOM | AI RU | Exact approved headline/body. |
| S314A-COPY-006 | 2A | APPROVED | `/about` uses locale-specific author identity and product name: RU `Чаадаев Дмитрий Владимирович` and `ПереговорИИ (NegotAItions)`; EN `Dmitry Chaadaev` and `NegotAItions`. Include the approved Wave 2A About body (club captain, 10+ years, professional IT, AI-first, human-skills positioning, collaboration via support email). | Packet M; user visual checkpoint 2026-08-16; branding/i18n correction 2026-08-16; Wave 2A copy 2026-08-16 | DOM, SCREENSHOT | `/about` | Implemented Wave 2A. Factual positioning is on About, not the homepage; EN About has no Cyrillic product or author name. Portrait is on About only. |
| S314A-COPY-007 | 1 | APPROVED | Footer copyright is locale-specific: RU `© 2026 Чаадаев Дмитрий Владимирович · ПереговорИИ (NegotAItions)`; EN `© 2026 Dmitry Chaadaev · NegotAItions`. | Packet O; branding/i18n correction 2026-08-16 | DOM | Footer | RU and EN copyright lines match the approved locale forms. |
| S314A-LOC-001 | 1 | APPROVED | Saved user locale preference wins. | Packet P, decision 4 | CODE, TEST | i18n | Cookie/localStorage locale overrides Accept-Language. |
| S314A-LOC-002 | 1 | APPROVED | When no saved locale exists, browser/Accept-Language may determine RU or EN. | Packet P | CODE, TEST | `detectBrowserLocale` | `ru*` → `ru`; `en*` → `en`. |
| S314A-LOC-003 | 1 | APPROVED | Fallback for a new/unknown visitor with no useful language signal is RU. | Packet P, decision 4 | CODE, TEST | `DEFAULT_LOCALE` / detect | Missing/unknown Accept-Language resolves to `ru`. |
| S314A-LOC-004 | 1 | APPROVED | Keep existing i18n architecture unless a small scoped refactor is required for the public shell. Do not redesign all existing legal localization in Wave 1. | Packet P | CODE | i18n / legal pages | Legal page bodies unchanged; locale plumbing reused. |
| S314A-SEO-001 | 1 | APPROVED | Public `/` is indexable and is not accidentally `noindex`. | Packet R, decision 17 | CODE, TEST, DOM | `/` metadata | Homepage robots allow indexing. |
| S314A-SEO-002 | 1 | APPROVED | Defensive private-route `noindex` uses a maintainable App Router layout/metadata strategy, not repetitive ad-hoc metadata where a scoped layout solution exists. | Packet R | CODE, TEST | Private layouts | Auth, app, and runtime categories share a reusable noindex helper/metadata. |
| S314A-SEO-003 | 1 | APPROVED | Private/non-public categories receive noindex, including login, register, forgot/reset password, pending/rejected/blocked, dashboard, cases, events application routes, sessions, account settings, admin, join/lobby/room/rejoin, and provider/test routes. | Packet R | CODE, TEST | Those routes | Response/metadata is noindex. |
| S314A-SEO-004 | 1 | APPROVED | Do not rely solely on future `robots.txt` for Wave 1 protection. | Packet R | CODE | Metadata | Wave 1 protection is metadata/`robots` meta, not robots.txt alone. |
| S314A-SEO-005 | 1 | APPROVED | Do not implement `robots.ts`, sitemap, full canonical/OG, or Webmaster in Wave 1. | Packet R/V, decisions 18–19 | CODE | `app/robots.ts` etc. | Those Wave 3 files/features are absent. |
| S314A-FTR-001 | 1 | APPROVED | Create a proper responsive public footer with groups PLATFORM, INFORMATION, DOCUMENTS. | Packet O | DOM, SCREENSHOT | Footer | Groups exist on desktop and wrap on small viewports. |
| S314A-FTR-002 | 1 | APPROVED | PLATFORM group: Главная, Войти, Регистрация (auth-aware: do not present Login/Register as the path when already authenticated). | Packet O/E | DOM, TEST | Footer | Unauth shows login/register; auth shows platform entry instead of login/register. |
| S314A-FTR-003 | 1 | APPROVED | INFORMATION group in Wave 1: Поддержка / Связаться. Об авторе and FAQ are omitted until Wave 2 destinations exist. Wave-2 routes must not be broken links. | Packet O; user visual checkpoint 2026-08-16 | DOM, TEST | Footer | Support → mailto; About and FAQ omitted until `/about` and `/faq` exist. |
| S314A-FTR-004 | 1 | APPROVED | DOCUMENTS group links existing legal routes: privacy, terms, cookie-policy, data-processing-consent, AI processing notice. | Packet O | DOM, TEST | Footer | Those five destinations are real existing routes. |
| S314A-FTR-005 | 1 | APPROVED | Existing legal route bodies are not rewritten in Wave 1. | Packet U, decision 20 | CODE | Legal pages | Legal page content files are unchanged aside from incidental layout/metadata if required. |
| S314A-FTR-006 | 1 | APPROVED | Footer continues to hide on room and event-lobby surfaces. | Existing footer contract | TEST, BEHAVIOR | `/room/*`, lobby | Footer remains hidden there. |
| S314A-APP-001 | 1 | APPROVED | Do not redesign negotiation-room functionality or modify recording/transcription/AI-analysis behavior. | Packet W | CODE | Room/materials | Wave 1 does not change those domains. |
| S314A-APP-002 | 1 | APPROVED | Existing returnUrl/auth sanitization remains intact. | Packet Z | TEST | Login/register | `/` is a safe returnUrl; dashboard gating unchanged. |
| S314A-APP-003 | 1 | APPROVED | Analytics remains OFF; do not add Yandex Metrika or another analytics script. | Packet V, decision 16 | CODE | Layout/scripts | No analytics tags in Wave 1. |
| S314A-ABOUT-001 | 2A | APPROVED | Full `/about` author page is Wave 2A. It includes the approved author copy (developer identity, club captain, 10+ years, professional IT, two directions / AI-first, collaboration via `support@negotaitions.ru`) and an author-photo slot. Do not keep a homepage teaser. | Packet D/M; user visual checkpoint 2026-08-16; Wave 2A copy 2026-08-16 | MANUAL, SCREENSHOT | `/about` | Implemented Wave 2A. Wave 1 homepage has neither `/about` content nor an author section. |
| S314A-ABOUT-002 | 2A | APPROVED | Supplied author portrait is a Wave 2A `/about` asset. Do not invent or copy a substitute on the homepage. | Packet M, decision 13 | SCREENSHOT | `/about` | Implemented Wave 2A. Portrait used only on About at `public/images/public-site/author-portrait.jpg`. |
| S314A-ABOUT-003 | 2A | APPROVED | When `/about` exists, public header and footer expose `Об авторе` / equivalent EN as a working link to `/about`. | Packet E/O; user visual checkpoint 2026-08-16 | DOM, TEST | Public header/footer | Implemented Wave 2A: About nav points to `/about`, not `/#author`. |
| S314A-SUP-001 | 2A | APPROVED | Full `/support` contact page is Wave 2A. | Packet T; Wave 2A copy 2026-08-16 | MANUAL | `/support` | Implemented Wave 2A. |
| S314A-SUP-002 | 2A | APPROVED | Public contact/support address is `support@negotaitions.ru`. | Packet T, decision 14 | DOM | Support / mailto | Implemented Wave 2A: address is a mailto on `/support` (and in About/FAQ copy). Footer Support goes to `/support`. |
| S314A-SUP-003 | 2 | APPROVED | Do not change Yandex 360 or Postbox configuration in this stage; operational receive verification happens before Wave 2 publication if needed. | Packet T | CODE | Infra | No mail-provider config changes in Wave 1. |
| S314A-FAQ-001 | 2A | APPROVED | FAQ page implementation is Wave 2A. | Packet S; Wave 2A copy 2026-08-16 | MANUAL | `/faq` | Implemented Wave 2A. |
| S314A-FAQ-002 | 2A | APPROVED | Wave 2A FAQ covers the ten approved first-version questions. | Packet S; Wave 2A copy 2026-08-16 | DOM | `/faq` | Implemented Wave 2A. Questions 1–10 from the Wave 2A register are present. |
| S314A-FAQ-003 | 2A | APPROVED | FAQ must not become a detailed operating manual. | Packet S, decision 10 | MANUAL | `/faq` | No click-by-click product operation, full session walkthrough, facilitator manual, or detailed prep/negotiation/debrief instructions. |
| S314A-LEGAL-001 | 2 | APPROVED | Existing legal rewrite is Wave 2, not Wave 1. | Packet U, decision 20 | CODE | Legal pages | Bodies rewritten only in Wave 2. |
| S314A-LEGAL-002 | 2 | APPROVED | Operator named as `Чаадаев Дмитрий Владимирович` in Russian legal/public copy and `Dmitry Chaadaev` in English legal/public copy. | Packet U; branding/i18n correction 2026-08-16 | DOM | Legal | Operator identity matches the locale. |
| S314A-LEGAL-003 | 2 | APPROVED | Communication/legal copy must be synchronized with actual architecture. | Packet U | MANUAL | Legal | Claims match current providers/publication model. |
| S314A-LEGAL-004 | 2 | APPROVED | Yandex and Voximplant are the principal external service families to describe where relevant. | Packet U | DOM | Legal | Those families are described where relevant. |
| S314A-LEGAL-005 | 2 | APPROVED | Stale LiveKit / Whisper-as-current / OpenAI-as-current-default claims must not survive without factual evidence. | Packet U | DOM | Legal | Unevidenced current-provider claims are removed. |
| S314A-LEGAL-006 | 2 | APPROVED | Do not publish a blanket “all data is processed only in RF” statement without evidence/legal review. | Packet U | DOM | Legal | No unevidenced RF-only processing claim. |
| S314A-LEGAL-007 | 2 | APPROVED | Actual role/grant publication model must replace facilitator-only claims. | Packet U | DOM | Legal | Publication model matches architecture. |
| S314A-LEGAL-008 | 2 | APPROVED | Remove MVP/draft banners when approved Wave 2 content replaces the drafts. | Packet U | DOM | Legal | Draft banners gone after rewrite. |
| S314A-LEGAL-009 | 2 | APPROVED | Retain clear restrictions on sensitive/confidential data. | Packet U | DOM | Legal | Restrictions remain. |
| S314A-LEGAL-010 | 2 | APPROVED | Retain clear warnings that AI output may be inaccurate and is educational. | Packet U | DOM | Legal | Warning remains. |
| S314A-LEGAL-011 | 2 | APPROVED | Do not invent retention periods or deletion behavior. | Packet U | DOM | Legal | No invented retention/deletion claims. |
| S314A-LEGAL-012 | 2 | APPROVED | Technical architecture validation does not replace legal review. | Packet U | MANUAL | Legal process | Legal review remains a separate gate. |
| S314A-VIS-001 | 2 | APPROVED | Later product visuals are based on real application screenshots with synthetic names/content and image editing. | Packet N, decision 11 | MANUAL | Homepage/about visuals | Real-app screenshots, transformed, not stock. |
| S314A-VIS-002 | 2 | APPROVED | Do not capture or use production user faces, names, case data, or sensitive content. | Packet N, decision 12 | MANUAL | Screenshot pipeline | No real participant identity or sensitive content. |
| S314A-VIS-003 | 1 | PROPOSED | Exact screenshot slots, crops, and aspect ratios after the Wave 1 rendered layout is reviewed. | Packet N/AA | MANUAL | Visual checkpoint | Wave 1 reports a screenshot request; final slot design may adjust after user review. |
| S314A-AN-001 | 3 | APPROVED | Analytics belongs to Wave 3 and remains off until feature → cookie classification → consent → Cookie Policy → Privacy/provider review are synchronized. | Packet V, decision 16 | CODE | Analytics | No analytics in Wave 1. |
| S314A-SEO3-001 | 3 | APPROVED | `robots.ts` implementation is Wave 3. | Packet V, decision 18 | CODE | `app/robots.ts` | Not in Wave 1. |
| S314A-SEO3-002 | 3 | APPROVED | Sitemap implementation is Wave 3. | Packet V | CODE | sitemap | Not in Wave 1. |
| S314A-SEO3-003 | 3 | APPROVED | Canonical metadata implementation is Wave 3. | Packet V | CODE | metadata | Not in Wave 1. |
| S314A-SEO3-004 | 3 | APPROVED | Open Graph / social metadata is Wave 3. | Packet V | CODE | metadata | Not in Wave 1. |
| S314A-SEO3-005 | 3 | APPROVED | Yandex Webmaster verification is Wave 3. | Packet V | CODE | verification | Not in Wave 1. |
| S314A-SEO3-006 | 3 | APPROVED | Communication-page governance is Wave 3. | Packet V, decision 19 | MANUAL | Public pages | Not in Wave 1. |
| S314A-SEO3-007 | 3 | APPROVED | Canonical public host strategy is `https://negotaitions.ru`. | Packet V, decision 15 | CODE | Canonical | Recorded as strategy; not applied via nginx in Wave 1. |
| S314A-HOST-001 | 1 | APPROVED | Do not perform domain/nginx changes in Wave 1. | Packet V/W | CODE | Infra | No nginx/domain mutation. |
| S314A-OOS-001 | — | OUT_OF_SCOPE | Detailed user instructions / detailed product walkthrough pages. | Packet A/S, decision 9 | CODE | Public site | Absent in Stage 3.14A; later stage after UI stabilizes. |
| S314A-OOS-002 | — | OUT_OF_SCOPE | Public materials / lessons / articles / negotiation preparation / trainers / instruction / recordings educational content. | Packet D | CODE | Public nav | Not built; not shown as disabled doors. |
| S314A-OOS-003 | — | OUT_OF_SCOPE | Database mutations, Prisma migrations, production env, local `.env`, systemd, Voximplant, Yandex provider configuration, production deploy, SSH production mutation. | Packet W | CODE | Ops | None of these actions in this stage’s Wave 1 implementation. |
| S314A-OOS-004 | — | OUT_OF_SCOPE | Observer-scaling or other unrelated room E2E as part of this wave. | Packet W | TEST | CI | Not run for Wave 1 focused tests. |
| S314A-OOS-005 | — | OUT_OF_SCOPE | Domain/nginx/systemd/Voximplant/Yandex provider mutation and production deploy/SSH. | Packet W | CODE | Infra | Absent from Wave 1. Also constrained by S314A-HOST-001. |
| S314A-OOS-006 | — | OUT_OF_SCOPE | Analytics scripts in Stage 3.14A until Wave 3 consent/legal synchronization. | Packet V/W | CODE | Layout | Absent from Wave 1. Also constrained by S314A-APP-003 / S314A-AN-001. |
| S314A-OOS-007 | — | OUT_OF_SCOPE | Fake/empty future public pages and stock negotiation or generic AI imagery. | Packet D/N/W | CODE, SCREENSHOT | Public site | Absent. Also constrained by S314A-IA-006 and S314A-HOME-023. |
| S314A-OOS-008 | — | DECISION_REQUIRED | None remaining from the numbered approval checkpoint. Reserved so later genuine opens can be added without recycling APPROVED IDs. | Approval checkpoint | — | — | Empty set after decisions 1–20. |

## Approved Wave 1 copy register

RU hero headline:

- Тренируйте переговоры.
- Используйте возможности ИИ.
- Становитесь сильнее в переговорах.

RU hero body:

ПереговорИИ (NegotAItions) — платформа для учебных переговорных сессий:
от кейса и распределения ролей до записи, транскрипта и AI-разбора.

ИИ не ведёт переговоры за вас. Он помогает увидеть то, что трудно заметить
во время разговора.

RU capabilities:

1. Учебные переговорные кейсы — Создавайте и используйте сценарии с разными ролями, интересами и вводными для участников.
2. Полный цикл тренировки — Организуйте встречу, распределяйте роли, проводите подготовку и переговоры в одной платформе.
3. Запись и транскрипт — Возвращайтесь к прошедшей сессии не только по памяти: используйте запись и текст переговоров для разбора.
4. AI-разбор — Получайте дополнительный взгляд на переговорный процесс и контролируемо публикуйте результаты участникам и наблюдателям.

RU training flow:

1. Выберите кейс — Участники получают свои роли и вводные.
2. Подготовьтесь — Проверьте связь и сформулируйте переговорную позицию.
3. Проведите переговоры — Платформа ведёт участников через учебную сессию.
4. Разберите результат — Запись, транскрипт, AI-анализ и обсуждение после переговоров.

RU AI headline: ИИ — не вместо собеседника. / ИИ — чтобы лучше его понимать.

RU audience headline: Переговоры — навык, который можно тренировать

RU audience cards:

1. Развивать переговорные навыки — Тренируйтесь на учебных кейсах, пробуйте разные стратегии и разбирайте результат.
2. Готовиться к важным разговорам — Используйте практику и ИИ, чтобы лучше понимать свои цели, аргументы и возможную позицию собеседника.
3. Получать больше от практики — Возвращайтесь к записи, транскрипту и разбору, чтобы замечать то, что сложно увидеть прямо во время разговора.
4. Тренироваться вместе — Используйте платформу индивидуально, в переговорном клубе, с тренером, коллегами или командой.

EN audience is a natural equivalent, not a literal translation. Do not invent logos, statistics, or testimonials.

## Wave 2A About copy register

RU page title: `Об авторе`

RU author: `Чаадаев Дмитрий Владимирович`

RU body is the approved Wave 2A About copy in `lib/i18n/dictionaries/ru.ts`
(`publicAbout.*`), including collaboration via `support@negotaitions.ru`.

EN page title: `About`

EN author: `Dmitry Chaadaev`

EN product name: `NegotAItions`. EN About must not include `ПереговорИИ` or a
Cyrillic author name.

Author portrait belongs on `/about` only, at
`public/images/public-site/author-portrait.jpg`.

## Wave 2A FAQ question register

1. Что такое ПереговорИИ (NegotAItions)? / What is NegotAItions?
2. Для кого предназначен проект? / Who is the project for?
3. Что такое кейс, встреча и сессия? / What are a case, event and session?
4. Какие роли есть в переговорах? / What roles are available in a negotiation?
5. Записываются ли переговоры? / Are negotiation sessions recorded?
6. Как используется искусственный интеллект? / How is AI used?
7. Насколько объективен ИИ-разбор? / How objective is the AI review?
8. Кто видит результаты ИИ-разбора? / Who can see AI analysis results?
9. Какие данные не следует использовать в учебных переговорах? / What information should not be used in training negotiations?
10. Что делать, если что-то не работает? / What should I do if something is not working?

The earlier twelve-question packet list is superseded for Wave 2A by this
ten-question register. Do not add facilitator walkthroughs or user-guide pages.

## Counts

| Status / wave | Count |
| --- | --- |
| APPROVED Wave 1 | 72 |
| APPROVED Wave 2A | 9 |
| APPROVED Wave 2 | 15 |
| APPROVED Wave 3 | 8 |
| PROPOSED | 1 |
| OUT_OF_SCOPE | 7 |
| DECISION_REQUIRED (empty placeholder row) | 1 |
| SUPERSEDED | 2 |

## Executable evidence register (Wave 1)

| Requirement IDs | Existing automated evidence candidate | Runtime/manual evidence still required |
| --- | --- | --- |
| S314A-IA-002, 011; S314A-HOME-020–021, 026 | New `tests/e2e/public-homepage.spec.ts`; tighten `phase-6-legal-consent.spec.ts` `/` assertions | Authenticated `/` browser pass; visual checkpoint |
| S314A-LOC-001–003 | New `lib/i18n/config.test.ts` | Browser RU/EN homepage switch |
| S314A-SEO-001–003 | New `lib/seo/indexing.test.ts` plus homepage E2E meta robots | Private-route HTML robots on dashboard/login |
| S314A-HOME-001–006, 023–025; S314A-HDR-002, 006 | — | MANUAL visual checkpoint + SCREENSHOT |
| S314A-FTR-001–004 | Homepage E2E footer destinations | Responsive footer screenshot |
