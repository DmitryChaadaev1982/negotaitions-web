# Target Observer Rail Contract

Selected layout:

```text
Room
├── Fixed-height observer rail
├── Existing participant A / facilitator / participant B stage
└── Existing right sidebar
```

Contract:
- The observer area is a fixed-height rail above the existing negotiation stage.
- Desktop, tablet, and mobile use one horizontal row; observer tiles never wrap to a second row.
- The rail owns horizontal overflow with `overflow-x-auto`; the page must not gain horizontal overflow.
- Observer count is visible in the rail heading.
- The scroll region has an accessible label and supports keyboard `ArrowLeft`, `ArrowRight`, `Home`, and `End`.
- Observer tiles are focusable list items with accessible labels including name, connection, mic, and camera state.
- Scroll controls are always available but visually restrained.
- The participant A, participant B, facilitator, timer, right sidebar, control bar, recording controls, and room lifecycle behavior are not redesigned.

Zero-observer behavior:
- The same bounded rail region remains present, but it shows a compact empty state instead of a large blank observer card.
- The intended zero-to-one rail height shift tolerance is no more than 2 CSS px at the same viewport.

High-count behavior:
- Counts 0, 1, 4, 8, 12, 30, 50, and 100 are deterministic UI fixture scenarios.
- All observer entries remain in the DOM; no video virtualization is introduced.
- This validates roster presentation scalability, not provider capacity for 100 concurrent live camera streams.
