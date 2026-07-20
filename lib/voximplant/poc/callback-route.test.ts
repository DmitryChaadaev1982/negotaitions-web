import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { processPocCallback } from "@/lib/voximplant/poc/callback-handler";
import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
} from "@/lib/voximplant/poc/callback-signature";
import {
  createEmptyPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

const callbackSecret = "poc-callback-secret-16chars!!";

test("callback route module is POC-gated and has no prisma", () => {
  const routePath = join(
    process.cwd(),
    "app/api/poc/voximplant/server-stop/callback/route.ts",
  );
  const source = readFileSync(routePath, "utf8");
  assert.match(source, /processPocCallback/);
  assert.ok(!source.includes("prisma"));
  assert.ok(!source.includes("@/lib/prisma"));
  assert.ok(!source.includes("Recording"));
});

test("callback route handler path rejects when flag disabled (no provider)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-route-"));
  writePocState(
    createEmptyPocState({
      pocId: "poc-route",
      conferenceName: "neg-poc-server-stop-1",
    }),
    cwd,
  );
  const payload = buildPocCallbackPayload({
    eventType: "command_accepted",
    action: "ping",
    operationId: "op-route",
    conferenceName: "neg-poc-server-stop-1",
  });
  const signed = buildSignedCallbackRequest({
    payload,
    secret: callbackSecret,
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    cwd,
    env: {
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED: "false",
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: callbackSecret,
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.equal(result.disabled, true);
  }
});
