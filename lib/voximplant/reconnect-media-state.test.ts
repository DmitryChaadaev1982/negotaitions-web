import test from "node:test";
import assert from "node:assert/strict";

import { isMediaStatusCurrentForConnection } from "@/lib/voximplant/reconnect-media-state";

test("current connection media status is accepted", () => {
  assert.equal(
    isMediaStatusCurrentForConnection(
      {
        connectionId: "current",
        micEnabled: false,
        cameraEnabled: true,
        updatedAt: new Date().toISOString(),
      },
      "current",
    ),
    true,
  );
});

test("old connection media status is ignored after reconnect", () => {
  assert.equal(
    isMediaStatusCurrentForConnection(
      {
        connectionId: "old",
        micEnabled: true,
        cameraEnabled: true,
        updatedAt: new Date().toISOString(),
      },
      "current",
    ),
    false,
  );
});

test("unknown current connection accepts only unknown media status", () => {
  assert.equal(
    isMediaStatusCurrentForConnection(
      {
        connectionId: null,
        micEnabled: false,
        cameraEnabled: false,
        updatedAt: new Date().toISOString(),
      },
      null,
    ),
    true,
  );
});
