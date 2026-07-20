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
  assert.match(source, /accepted:\s*true/);
  assert.match(source, /persisted:\s*true/);
  assert.match(source, /stateScope/);
  assert.match(source, /CALLBACK_ACCEPTED_AND_PERSISTED/);
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
    assert.equal(result.errorCode, "POC_CALLBACK_DISABLED");
  }
});

test("access route uses POC conference resolver and exposes no capability URL", () => {
  const routePath = join(
    process.cwd(),
    "app/api/sessions/[sessionId]/voximplant/access/route.ts",
  );
  const source = readFileSync(routePath, "utf8");
  assert.match(source, /resolveVoximplantConferenceNameForAccess/);
  assert.ok(!source.includes("mediaSessionAccessSecureUrl"));
  assert.ok(!source.includes("media_session_access_secure_url"));
  assert.ok(!source.includes("VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET"));
  assert.ok(!source.includes("VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET"));
});
