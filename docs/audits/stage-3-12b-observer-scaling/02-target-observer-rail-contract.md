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
- Scroll controls are rendered only when the measured content overflows and only for directions that can currently scroll.
- While all observer tiles fit, the ordered content strip is centered with `width: max-content` and automatic inline margins.
- When measured content overflows, the strip is start-aligned with zero inline margins so the first joined observers stay visible at the left edge.
- New observers append to the right in stable roster order. The rail does not auto-scroll to new observers or media-state changes.
- The participant A, participant B, facilitator, timer, right sidebar, control bar, recording controls, and room lifecycle behavior are not redesigned.

Zero-observer behavior:
- The same bounded rail region remains present, but it shows a compact empty state instead of a large blank observer card.
- The intended zero-to-one rail height shift tolerance is no more than 2 CSS px at the same viewport.

High-count behavior:
- Counts 0, 1, 2, 4, 5, 8, 12, 30, 50, and 100 are deterministic UI fixture scenarios.
- All observer entries remain in the DOM; no video virtualization is introduced.
- This validates roster presentation scalability, not provider capacity for 100 concurrent live camera streams.

Sizing contract:
- The observer rail height is responsive: `10rem` below `sm`, `11.25rem` from `sm`, and `11.75rem` from `lg`.
- The desktop rail includes the header line, `space-y-2` header/content gap, `p-2` section padding, the 13rem-wide 16:9 observer tile, tile border, overlayed name/media controls, scrollbar gutter, and at least 4 CSS px of internal bottom clearance.
