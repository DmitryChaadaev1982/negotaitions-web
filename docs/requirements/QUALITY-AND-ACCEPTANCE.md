# Quality And Acceptance

This is the canonical quality and acceptance contract. Command catalogs,
E2E isolation, and observer matrices stay in `docs/testing/` so this file
does not duplicate them.

## Ownership

| Owner | Role |
| --- | --- |
| Native Agent | Focused tests and diagnostics while implementing |
| Product commands | What `validate:*`, `test:e2e:*`, `eval:registry:check` actually check |
| EO | When formal validation and release gates run, after UAT |

UAT precedes formal validation. Chat transcript is not lifecycle authority.

Do not delegate `validate:fast`, `validate:build`, or `validate:deploy` to a
Cursor subagent. Operator PowerShell / EO owns those.

## Product command catalog

Authoritative command behavior: [`docs/testing/validation-checklist.md`](../testing/validation-checklist.md).

Canonical EO-declared gates:

- `npm run validate:fast`
- `npm run validate:deploy` (`validate:fast` then `validate:build`, once)
- `npm run test:e2e:smoke`
- `npm run test:e2e:smoke:browser`

`validate:fast` never runs `*.pg.test.ts` or `tests/pg-race/**`. Name
mutating tests so they cannot leak into that gate.

## E2E and database isolation

Authoritative strategy: [`docs/testing/e2e-strategy.md`](../testing/e2e-strategy.md).

- `E2E_DATABASE_URL` is mandatory; never fall back to `DATABASE_URL`.
- E2E PostgreSQL is `localhost:5433/negotiations_e2e`.
- Do not run overlapping managed Playwright servers.
- Tunnel and live-provider suites are opt-in.
- Managed Playwright pins `VIDEO_PROVIDER=livekit` unless
  `PLAYWRIGHT_VIDEO_PROVIDER=voximplant`.
- `POST_TRANSCRIPTION_LAB=1` skips realtime signaling and is ignored when
  `NODE_ENV=production`.

## Observer coverage

Authoritative matrix:
[`docs/testing/observer-test-execution-policy.md`](../testing/observer-test-execution-policy.md).

Layout contracts (fit ≤4, overflow ≥5 at 1440×900) must be verified before
room-geometry release. Visual acceptance on one surface does not imply
neighbor surfaces.

## Enhancement UAT

Large-realistic enhancement UAT:
[`docs/testing/large-realistic-enhancement-uat.md`](../testing/large-realistic-enhancement-uat.md).

Skip is not Resume. Max two provider POSTs per chunk per run. UAT shares
the ten-slot enhancement inventory with the app and Stage 3.10 maintenance.

## Eval registry and requirement completeness

- [`docs/testing/eval-registry.json`](../testing/eval-registry.json) —
  `npm run eval:registry:check` requires evidence files to exist.
- [`docs/testing/requirement-completeness.md`](../testing/requirement-completeness.md)
  and `.cursor/skills/verify-requirements/SKILL.md`.
- `verify-requirements` is not `validate-wave`.

## Native dialogs

Production UI must not call `window.confirm`, `window.prompt`, or
`window.alert`. `npm run check:native-dialogs` is part of `validate:fast`.
In-app dialogs: `components/confirm-dialog.tsx` and related components.

## Model routing (process, not product runtime)

[`docs/testing/agent-model-routing.md`](../testing/agent-model-routing.md):
`freshContext` is not M4. Maximum automatic root-cause escalation is one
M2→M3. EO binds actual models.

## Documentation Change Units

For documentation-only Change Units, deterministic checks are:

- internal Markdown links resolve (`node scripts/check-docs-links.mjs`)
- `architecture/code-map.md` names real modules/tests
- `git diff --check`
- `npm run eval:registry:check` if evidence paths changed
- focused unit tests that assert documentation contracts, if any

Do not call real Yandex/Voximplant providers. Do not mutate production.

## BUG04 Slice A (session-room Layer-3 media recovery)

Acceptance for the Vox session-room recovery candidate:

- SDK `RECONNECTING` is observational; the app does not connect/join/hangup/disconnect then.
- A terminal Conference disconnect (`CONNECTION_LOST` / unexpected membership disconnect) that arrives while SDK reconnect is active is deferred, not lost; after SDK settle it recovers exactly once unless Leave/stale/unmount cancelled it.
- If SDK `RECONNECTING` begins after terminal recovery has already started but before the new Conference joins, the same attempt is paused and resumed after settle. It must not become a second attempt or a failed `already_in_flight` result.
- Old-generation Conference Connected/Failed/Disconnected/Endpoint callbacks and released Conference state watchers must not mutate current `conferenceConnected`, SDK reconnect projection, or Layer 3. A still-current watcher may observe a legitimate reconnect settle so a pending incident can flush exactly once.
- SDK reconnect completion is edge-triggered (`RECONNECTING` → settled). Ordinary `CREATED` / `CONNECTING` / `CONNECTED` / `LOGGED_IN` callbacks are not recovery and must not promote `hasEnteredRoom` or flash DEGRADED merely because there are zero remotes.
- Stream ENDED / native `ended` listeners are owned by `endpointId + streamId`. `RemoteMediaRemoved` disposes that exact binding; `EndpointRemoved` still disposes every binding for the endpoint. A late callback from a removed stream cannot degrade or suppress replacement media.
- 408 log-alone does not rejoin.
- Terminal Failed / `CONNECTION_LOST` fences generation N before reset, then joins a new Conference with the same `connectionId`.
- Successful recovery may handle a later independent terminal incident; a failed incident does not loop.
- Explicit Leave and stale/superseded connections never auto-rejoin.
- Recoverable media failure keeps `SharedRoomShell` / heartbeat mounted.
- Recording START/STOP is not dispatched by media recovery.
- Healthy live `RemoteMediaAdded` remains synchronous: no new await, server round trip, Connected-state render gate, or reconciliation poll before usable media state update.

Peer/endpoint duplicate convergence is out of Slice A.

## BUG04 Slice B (peer media convergence)

Acceptance for remote-browser endpoint overlap after Slice A:

- Logical participant identity is normalized Vox username; Vox endpoint id is transport/media-instance identity.
- One logical participant tile is rendered when endpoint IDs overlap during recovery.
- Selection is live-track-first: live video, then live audio, then media absent/degraded, then ended/unusable. A stream object with `readyState !== live` cannot beat a live candidate.
- Equal-quality candidates keep the previously selected endpoint when still present; otherwise lexicographic endpoint id (stable tie-break, not Vox recency). Video tiles and remote audio playback consume the same session-room selected-endpoint set; layout does not rank independently.
- Remote HTMLAudioElement playback is selected-endpoint and selected-current-stream only. Unselected endpoints stay paused. An obsolete/replaced audio stream on a still-selected endpoint is paused immediately, without waiting for `RemoteMediaRemoved`. An endpoint that becomes selected has its current stream resumed immediately. Manual unlock plays only the currently selected endpoint's current audio stream and does not replay suppressed or obsolete audio. Newly attached audio is represented in the selection snapshot before the play/pause decision, without waiting for React `setState` flushing.
- Background snapshot reconciliation feeds the same helper and must not run before first live media render.
- Observer browsers converge on recovered live media without Refresh and without requiring `EndpointRemoved` as the only repair.
- Event lobby does not copy session-room peer selection. Recording/transcription identity stays on the logical participant.
- The selection helper is synchronous: no await, fetch, poll, SDK-state wait, or peer acknowledgement before selecting a live candidate. HEALTHY_FAST_PATH remains no-regression.
