# Visual Evidence

The focused Playwright spec writes local evidence to:

```text
artifacts/stage-3-12b-observer-scaling/
```

Generated files:
- `manifest.json`
- `screenshots/*__viewport.png`
- `screenshots/*__observer-rail.png`

Captured scenario metadata:
- observer count
- viewport
- visible observer count
- page scroll width
- rail client width
- rail scroll width
- rail scroll left
- rail viewport and ordered content bounding boxes
- observer rail bounding box
- observer rail inner top/bottom after padding and border
- main stage bounding box
- right sidebar bounding box when present
- observer tile top coordinates for no-wrap validation
- observer tile bounding boxes for centered-fit/start-overflow assertions
- observer media-control bounding boxes for vertical clipping assertions
- conditional left/right scroll arrow visibility

Focused correction screenshots:
- `desktop-1440x900-1__viewport.png`
- `desktop-1440x900-1__observer-rail.png`
- `desktop-1440x900-4__viewport.png`
- `desktop-1440x900-4__observer-rail.png`
- `desktop-1440x900-5__viewport.png`
- `desktop-1440x900-5__observer-rail.png`
- `desktop-1440x900-30-start__viewport.png`
- `desktop-1440x900-30-start__observer-rail.png`
- `desktop-1440x900-30-middle__viewport.png`
- `desktop-1440x900-30-middle__observer-rail.png`
- `desktop-1440x900-30-end__viewport.png`
- `desktop-1440x900-30-end__observer-rail.png`
- `viewport-1280x720-12__viewport.png`
- `viewport-1280x720-12__observer-rail.png`
- `viewport-390x844-12__viewport.png`
- `viewport-390x844-12__observer-rail.png`

Required viewport scenario coverage is encoded in `tests/e2e/stage-3-12b-observer-scaling.spec.ts`.

Heavy PNG artifacts are local only and should not be committed unless repository policy changes.
