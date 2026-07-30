import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVENT_LOBBY_HIDDEN_POLL_INTERVAL_MS,
  EVENT_LOBBY_POLL_INTERVAL_MS,
  getEventLobbyPollDelayMs,
  shouldApplyEventStateResponse,
} from "@/lib/event-state-polling";

describe("event state polling", () => {
  it("keeps lobby poll interval at 3 seconds when visible", () => {
    assert.equal(EVENT_LOBBY_POLL_INTERVAL_MS, 3_000);
    assert.equal(getEventLobbyPollDelayMs(true), 3_000);
  });

  it("slows poll interval when document is hidden", () => {
    assert.equal(EVENT_LOBBY_HIDDEN_POLL_INTERVAL_MS, 10_000);
    assert.equal(getEventLobbyPollDelayMs(false), 10_000);
  });

  it("rejects stale out-of-order poll responses", () => {
    assert.equal(
      shouldApplyEventStateResponse({
        requestId: 2,
        latestAppliedRequestId: 3,
      }),
      false,
    );
    assert.equal(
      shouldApplyEventStateResponse({
        requestId: 4,
        latestAppliedRequestId: 3,
      }),
      true,
    );
  });

  it("allows equal request id for idempotent re-apply", () => {
    assert.equal(
      shouldApplyEventStateResponse({
        requestId: 3,
        latestAppliedRequestId: 3,
      }),
      true,
    );
  });
});
