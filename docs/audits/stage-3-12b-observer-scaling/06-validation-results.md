# Validation Results

Base SHA: `ae4bbf4ff13d94155652b335866c99ec116d9a34`

Environment verification:
- Source `.env` existed: yes.
- Target `.env` existed before copy: no.
- Source/target SHA-256 matched: yes.
- Required template key names present in target: yes.
- `.env` ignored by git: yes, via `.gitignore`.

Automated validation:
- `tests/e2e/voximplant-layout-camera-model.spec.ts`: PASS, 24 passed.
- `tests/e2e/stage-3-12b-observer-scaling.spec.ts`: PASS, 3 passed.
- `npm run validate:fast`: PASS.
- `npm run validate:deploy`: PASS.
- `npm run test:e2e:smoke`: PASS, 12 passed.
- `npm run test:e2e:smoke:browser`: PASS, 5 passed.
- `npm run test:stage310`: PASS, 102 unit checks and 30 browser checks passed.

Layout results:
- Participant-stage 1440x900 count tolerance: PASS, width delta 0 CSS px, height delta 0.875 CSS px across counts 0, 1, 4, 8, 12, 30, 50, 100.
- Zero-to-one observer rail height shift: PASS, 0 CSS px.
- Page horizontal overflow: PASS, max page scroll width delta 0 CSS px.
- Rail no-wrap: PASS, all measured observer tile tops stayed on one row.
- Keyboard scroll and focus retention: PASS in focused observer-scaling spec.

Manual regression:
- Participant role check: covered by focused browser fixture and Stage 3.10 browser regression.
- Observer role check: covered by focused browser fixture and observer explicit-leave Stage 3.10 regression.
- Facilitator role check: covered by focused browser fixture and Stage 3.10 browser regression.
- `OPEN`: covered by focused browser fixture and Stage 3.10 browser regression.
- `DEBRIEF_OPEN`: covered by focused browser fixture and Stage 3.10 browser regression.
- `CLOSED` / materials redirect: covered by `decideSessionRoomAccess` and Stage 3.10 regression.
