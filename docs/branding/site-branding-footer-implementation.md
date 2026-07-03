# Site branding and footer implementation

## Production asset structure

- Primary runtime header assets (localized exact PNG package):
  - `public/brand/negotaitions-logo-full-ru.png`
  - `public/brand/negotaitions-logo-full-en.png`
  - `public/brand/negotaitions-logo-compact-ru.png`
  - `public/brand/negotaitions-logo-compact-en.png`
  - `public/brand/negotaitions-logo-session-ru.png`
  - `public/brand/negotaitions-logo-session-en.png`
- Platform/browser icons:
  - `public/brand/negotaitions-icon.png`
  - `app/icon.png`
  - `app/apple-icon.png`
  - `public/favicon.ico`
- App-router favicon route source:
  - `app/favicon.ico` (must match `public/favicon.ico`)

## Asset usage mapping

- Locale-specific mapping (runtime):
  - RU locale: only RU assets are rendered (`ПереговорИИ`)
  - EN locale: only EN assets are rendered (`NegotAItions`)
  - No bilingual stacked logo is rendered in the UI.
- App/dashboard/auth headers (`components/ui/brand-logo.tsx` via `components/app-header-nav.tsx`, `app/(auth)/layout.tsx`):
  - Desktop/wide: full localized logo
  - Narrow/mobile: compact localized logo
- Session room top bar (`components/shared-room-shell.tsx`):
  - Desktop/wide: session localized logo
  - Narrow/mobile: compact localized logo
- Event lobby top bar (`components/event-lobby-view.tsx`):
  - Desktop/wide: session localized logo
  - Narrow/mobile: compact localized logo
- App icon usage:
  - Brand icon variant: `/brand/negotaitions-icon.png`
  - Browser tab icon: `/favicon.ico`
  - App icon route: `/icon.png`
  - Apple icon route: `/apple-icon.png`

## Metadata icon wiring

- Root metadata in `app/layout.tsx` configures:
  - `icon`: `/favicon.ico`, `/icon.png`, `/brand/negotaitions-icon.png`
  - `apple`: `/apple-icon.png`
  - `shortcut`: `/favicon.ico`
- For consistency, `app/favicon.ico` is aligned with `public/favicon.ico`.
- Browser cache can keep old favicons; validate with hard refresh and incognito.

## Footer structure

- Reusable footer component: `components/site-footer.tsx`
- Mounted in shared root layout: `app/layout.tsx`
- Footer is in normal document flow (not sticky/fixed), appears at page bottom on scroll.
- Full-screen room/lobby routes are excluded from footer rendering to avoid UI/control overlap:
  - `/room/*`
  - `/events/[id]/lobby`

## Footer content (current scope)

- Real legal content included:
  - Personal copyright notice
  - Copyright/IP protection notice
- Placeholder sections (future-safe):
  - Legal information
  - Support
  - About
  - Terms of use
  - FAQ

## Planned footer sections (future)

- Legal information (full legal docs/navigation)
- Support contacts/channels
- About author/company page
- Terms of use expansion
- FAQ pages

## Replacing brand assets later without code changes

- Keep filenames and paths exactly the same.
- Replace files in-place:
  - same path
  - same file name
- Component/layout code will continue using the new visuals automatically.
