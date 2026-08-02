# Observer Test Execution Policy

Authoritative rules for deciding which observer E2E suite to run for a given
change. `AGENTS.md` links here; `docs/testing/e2e-strategy.md` and
`docs/testing/validation-checklist.md` reference it rather than restating it.

## 1. Purpose

Observer regression coverage used to live in one Playwright spec that mixed
functional presence tests with a full geometry matrix (0-100 observers across
six viewports). Running it was expensive, and most changes that touched shared
room code did not need the geometry matrix at all.

The observer tests are now split into two suites with separate commands:

- a fast **observer smoke** suite that is the normal observer regression gate;
- a full **observer layout** suite that is mandatory only when Session room
  structure or geometry can change.

Both suites live in `tests/e2e/stage-3-12b-observer-scaling.spec.ts` and are
selected by single-token Playwright tags (`@observer-smoke`,
`@observer-layout`). Single tokens are required because
`scripts/agent-tooling/common.mjs` spawns `npx.cmd` with `shell: true` on
Windows, which loses quoting around multi-word `--grep` expressions.

## 2. Smoke suite scope (`@observer-smoke`)

Seven independent tests, small and moderate observer counts only.

| Test | Observer counts | Proves |
|---|---|---|
| grows from empty to first overflow with stable append-right order | 0 -> 1 -> 2 -> 3 -> 4 -> 5 | empty rail, zero-to-one rail height stability, centred-while-fitting, first overflow at 5, append-right order, no duplicate tiles, participant stage present, no page-level horizontal overflow |
| exposes conditional arrows at a moderate overflow size | 12 | start/middle/end scroll positions, conditional left/right arrows, page scroll is not hijacked |
| removes inactive observers while facilitator roster keeps them | 3 | active observer rendered, explicit leave removes the tile, lease expiry removes the tile, facilitator roster keeps both, camera-off observers stay rendered |
| reconnect before expiry keeps one stable rail tile | 3 | supersede/reconnect produces no duplicate tile and no reorder |
| applies active membership during debrief | 3 | `DEBRIEF_OPEN` membership follows active presence, camera-off observers stay rendered |
| unassigned participant remains in observer rail during debrief | 5 | authorized but unassigned participant is rendered as an observer, no duplicate ids |
| stays bounded on a narrow mobile viewport | 4 @ 390x844 | one representative narrow viewport stays bounded with no page-level horizontal overflow |

The smoke suite deliberately excludes 8, 30, 50 and 100 observers and the full
viewport matrix.

## 3. Full layout suite scope (`@observer-layout`)

Twenty-four tests. One Playwright test per viewport/observer-count sample, so
each sample owns its own timeout, trace, failure artifact and cleanup.

| Viewport | Observer counts |
|---|---|
| 1440x900 (desktop reference) | 0, 1, 4, 5, 8, 12, 30, 50, 100 |
| 1366x768 | 4, 12, 30 |
| 1280x720 | 4, 12, 30 |
| 1024x768 | 4, 12 |
| 768x1024 (tablet) | 4, 12, 30 |
| 390x844 (mobile) | 1, 4, 12 |

Plus one dedicated 30-observer scroll test covering start/middle/end scroll
states, conditional arrows, keyboard `End` scrolling and tile focus.

Every case asserts: rail stays a single row, rail height stays bounded, tiles
and media badges stay vertically contained inside the rail, the first observer
is visible, append-right ordering holds, roster order is stable, and the page
never scrolls horizontally. Desktop reference samples additionally assert the
measured fit/overflow contract and, in `afterAll`, that participant-stage width
and height are identical across the whole 0-100 range.

The fit/overflow boundary is asserted from the measured rail rather than
assumed: at 1440x900 the rail must fit up to 4 observers and must overflow at 5
(`desktopLastFittingObserverCount`).

## 4. Trigger matrix

| Changed area | Observer smoke | Full observer layout |
|---|---:|---:|
| `components/voximplant-video-layout.tsx` | Yes | Yes |
| Observer rail CSS, dimensions or scroll controls | Yes | Yes |
| Observer tile dimensions (`components/voximplant-participant-tile.tsx`) | Yes | Yes |
| Participant stage geometry / room grid or flex layout | Yes | Yes |
| `lib/voximplant/room-layout-model.ts` layout calculations | Yes | Yes |
| Room responsive breakpoints or room shell dimensions | Yes | Yes |
| Roster rendering structure that can change tile count or geometry | Yes | Yes |
| Future 3-8 negotiator layout work | Yes | Yes |
| Observer membership / presence / roster data | Yes | No |
| Explicit leave, lease expiry, reconnect | Yes | No |
| Shared Voximplant provider ownership / media handoff | Yes | No |
| Session lifecycle and room navigation | Yes | No |
| Media-state representation (mic/camera badges) | Yes | No |
| Shared room components changed without changing geometry | Yes | No |
| Event lobby observer actions | Optional / targeted | No |
| Dashboard | No | No |
| Event lobby layout outside the Session room | No | No |
| Debrief notes | No | No |
| Speaker mapping | No | No |
| Transcription, AI analysis, materials | No | No |
| Administrative pages | No | No |
| Documentation | No | No |
| Test/docs-only edit | Affected test only | No |
| Release containing Session room layout changes | Yes | Yes, once before deployment |

A shared generic component being imported by room code is not by itself a
trigger for the full layout suite. The trigger is a change that can alter room
geometry.

## 5. Commands

```bash
npm run test:e2e:observer:smoke          # 7 tests, managed mode
npm run test:e2e:observer:layout         # 24 tests, managed mode
npm run test:e2e:observer:smoke:list     # inventory only, no server, no DB
npm run test:e2e:observer:layout:list    # inventory only, no server, no DB
```

Both run through `scripts/run-playwright-mode.mjs --mode=managed`, which
requires port 3000 to be free and starts one Playwright-managed Next.js server
on port 3100 against `E2E_DATABASE_URL`. Do not leave a standalone `npm run dev`
running while invoking them.

`npm run test:stage310` runs the Stage 3.10 unit and browser coverage plus the
observer smoke suite in a single managed server lifecycle, selected with
`--grep-invert @observer-layout`. The full layout matrix is never part of it.

## 6. Expected duration

Measured locally on Windows with a warm `.next/dev` cache and the E2E Postgres
container on port 5433:

| Command | Tests | Duration |
|---|---:|---:|
| `test:e2e:observer:smoke` | 7 | ~53 s (~58 s wall) |
| `test:e2e:observer:layout` | 24 | ~2.1 min (~134 s wall) |
| `test:stage310` | 102 unit + 37 browser | ~70 s wall |

Slowest individual layout test is ~9 s, well inside the repository-wide 60 s
Playwright timeout. A cold `.next/dev` cache adds roughly 25-40 s to the first
room navigation of a run.

Artifacts:

- screenshots and `manifest.json`: `artifacts/stage-3-12b-observer-scaling/`
  (layout suite only; the smoke suite collects metrics without screenshots);
- Playwright HTML report: `playwright-report/`;
- failure traces, videos and error context: `test-results/`.

## 7. Provider-independent layout strategy

Current state, verified by measurement rather than assumption:

- Observer tiles are rendered from the server roster (`sidebar.roster`), not
  from Voximplant endpoints. Geometry therefore does not depend on live media.
- The suites already navigate with `?media=off`, which skips initial camera and
  microphone capture. It does **not** skip the WebSDK connect/login/join.
- Each room open still calls `POST /api/sessions/:id/voximplant/access`, which
  provisions a real Voximplant identity through the Management API, and the
  browser still attempts a WebSDK gateway connection.
- During these validation runs the gateway transport actually failed
  (`TransportInternalError ... code 500`) and every geometry assertion still
  passed, because the room shell renders once the provider phase leaves its
  loading state.

Removing the provider handshake for geometry-only scenarios would require
changing `app/room/[sessionId]/page.tsx` and
`components/voximplant-negotiation-room-page.tsx` to accept a guarded,
production-unreachable provider-neutral mode, comparable to the existing
`getVoxProviderFaultMode()` seam used by the Event lobby. That is a runtime
architecture change and is out of scope for this test/docs task, so the existing
path was retained after the split.

The cost was reduced instead by cutting provider-touching room opens on the
routine path from 31 (previous full spec) to 7 (smoke suite).

## 8. Known limitations

- Neither suite validates live media. The full layout suite must not be
  described as validating 100 live video streams; it validates the rendered
  geometry of a 100-entry roster.
- Every room open provisions a Voximplant account through the Management API,
  so a full layout run creates roughly 24 real provider identities. Functional
  provider ownership and media handoff stay covered by
  `tests/e2e/stage-3-12b-room-lobby-media-handoff.spec.ts` and
  `tests/e2e/voximplant-room-presence.spec.ts`.
- The participant-stage stability assertion across the 0-100 count range runs in
  `afterAll` and is skipped unless all desktop reference counts were executed.
  It therefore only reports when the full layout suite runs.
- `workers=1` remains required while E2E fixture ownership is shared, so both
  suites are strictly sequential.
- Fixture accounts reuse a single bcrypt hash (`hashE2ePassword`) because they
  authenticate through a seeded `UserSession` cookie. Any future observer test
  that needs the password login form must not reuse that hash path.

## 9. Pre-production requirement

Before deploying a release that contains Session room layout changes since the
last successful full run, run `npm run test:e2e:observer:layout` once and record
the result with the release evidence. Observer smoke alone is not sufficient for
such a release.

## 10. Examples

Full layout suite required:

- changing observer rail height, tile width or rail padding;
- changing the room grid, the participant stage sizing, or a room breakpoint;
- changing observer rail scroll affordances;
- adding the 3-8 negotiator layout variants.

Full layout suite not required (smoke only):

- changing how observer presence is derived from `SessionRoomConnection`;
- changing explicit-leave, lease or reconnect semantics;
- changing Voximplant client ownership or room-to-lobby handoff;
- renaming a roster field without changing rendered structure.

Neither suite required:

- Dashboard, notes, speaker mapping, transcription, AI analysis, materials,
  administrative pages, or documentation-only edits, provided no shared room
  runtime file changed.
