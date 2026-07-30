# Accessibility Findings

Structural checks collected: headings, landmarks, action labels, target sizes, focus-order sample, fixed/sticky elements, clipped text, overlap, scroll containers, and horizontal overflow.

`@axe-core/playwright` is not installed and was not added during this audit. That is an explicit coverage gap, not a hidden pass.

WCAG 2.2 and WAI-ARIA APG implications:
- Critical actions must remain keyboard reachable and visible under reflow.
- Icon-only or compact role controls need accessible names and visible/tooltipped text.
- Toolbar-like filter/action groups should be labeled and should reduce tab stops only when arrow-key behavior is implemented.
- State cannot rely on color alone; status text or accessible labels must remain.

Primary finding: UI-F020.
