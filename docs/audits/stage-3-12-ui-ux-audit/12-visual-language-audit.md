# Visual Language Audit

Current language: dark background, glass cards, cyan primary gradient, slate secondary controls, rose danger controls, compact list action buttons, badges, and rounded surfaces.

Strengths:
- The app has a recognizable dark product language.
- Buttons and list actions already use reusable helpers.
- Status badges are widely used.

Weaknesses:
- Gradients and glass cards carry too much generic visual weight.
- Spacing and density vary by surface.
- Primary cyan treatment is reused for destinations with different semantics.
- Brand identity is present through `BrandLogo`, but UI tokens are not documented enough for consistent extension.

Direction: document restrained tokens for surface, text, action semantics, status, spacing, radius, and density. Do not redesign the logo or add decorative visuals.
