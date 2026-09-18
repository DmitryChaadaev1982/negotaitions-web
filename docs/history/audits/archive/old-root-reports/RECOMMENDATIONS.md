# NegotAItions Recommendations

## P1: Add First-Class Test Data Reset Command

Issue:

- E2E tests currently clean up `E2E` data with SQL helpers.

Why it matters:

- A dedicated reset command would make CI runs safer and easier to reason about.

Suggested change:

- Add a test-only reset script or route gated by `NODE_ENV=test` / mock mode.

Risk/impact:

- Low if strictly gated; high if exposed outside test mode.

## P2: Stabilize Event Lobby Bootstrap In Mock Mode

Issue:

- The event lobby can stay on `Loading...` in the Playwright dev harness while the lobby video/LiveKit bootstrap initializes.

Why it matters:

- It makes full UI assertions for event lobby rejoin less reliable, even though API and database invariants pass.

Suggested change:

- In mock external-service mode, allow the event lobby to render state even if the video room bootstrap is unavailable or delayed.

Risk/impact:

- Low if limited to mock/test mode.

## P2: Promote Multi-Session API Helpers To App-Level Test Fixtures

Issue:

- The e2e suite now has deterministic helpers for multi-session Events, but several workflows still set up state through direct API calls for speed.

Why it matters:

- UI-first tests are valuable for a small number of critical flows, while API setup keeps the suite fast. Shared fixtures should make that distinction explicit.

Suggested change:

- Keep `createTestCase`, `createTestEvent`, `joinEventAsParticipant`, and session workflow helpers in one fixture module and document which helpers are setup-only versus behavior-under-test.

Risk/impact:

- Low; this is test maintenance work and does not change product behavior.

## P2: Add Explicit Live Smoke Specs

Issue:

- Optional live smoke tests are represented by a skipped placeholder.

Why it matters:

- Short real-provider checks are useful before demos or releases, but should remain opt-in.

Suggested change:

- Add `@live-smoke` specs for 30-60 second LiveKit/Yandex/OpenAI verification behind `RUN_LIVE_SMOKE_TESTS=true`.

Risk/impact:

- Medium because live tests consume external quotas and require secrets.

## P3: Configure Next Dev Origin For Playwright

Issue:

- Next dev logs an `allowedDevOrigins` warning for `127.0.0.1`.

Why it matters:

- The warning is noisy in test output.

Suggested change:

- Add a dev/test-only `allowedDevOrigins` entry for `127.0.0.1` if this warning becomes disruptive.

Risk/impact:

- Low for local/dev config; avoid broad origins.

