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
- observer rail bounding box
- main stage bounding box
- right sidebar bounding box when present
- observer tile top coordinates for no-wrap validation

Required viewport scenario coverage is encoded in `tests/e2e/stage-3-12b-observer-scaling.spec.ts`.

Heavy PNG artifacts are local only and should not be committed unless repository policy changes.
