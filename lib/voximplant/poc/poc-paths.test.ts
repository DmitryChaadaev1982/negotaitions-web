import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { processPocCallback } from "@/lib/voximplant/poc/callback-handler";
import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
} from "@/lib/voximplant/poc/callback-signature";
import {
  classifyWorktreeMatch,
  getPocRepositoryRoot,
  getPocStatePath,
  getPocWorktreeDiagnostic,
  POC_STATE_RELATIVE_PATH,
} from "@/lib/voximplant/poc/poc-paths";
import {
  createEmptyPocState,
  getPocStatePath as getStatePathFromStateModule,
  readPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

const callbackSecret = "poc-callback-secret-16chars!!";

test("callback state path is shared by route and CLI resolvers", () => {
  const repoRoot = getPocRepositoryRoot();
  const fromPaths = getPocStatePath();
  const fromState = getStatePathFromStateModule();
  assert.equal(fromPaths, fromState);
  const normalized = fromPaths.replace(/\\/g, "/");
  assert.ok(
    normalized.includes("/.agent/voximplant-server-stop") ||
      normalized.endsWith(POC_STATE_RELATIVE_PATH),
  );
  assert.ok(fromPaths.startsWith(repoRoot));
});

test("route cannot write to sibling worktree state", () => {
  const sibling = mkdtempSync(join(tmpdir(), "poc-sibling-"));
  mkdirSync(join(sibling, ".agent"), { recursive: true });
  writeFileSync(
    join(sibling, ".agent", "voximplant-server-stop-poc.json"),
    JSON.stringify({ poisoned: true }),
    "utf8",
  );

  const cwd = mkdtempSync(join(tmpdir(), "poc-exact-"));
  writePocState(
    createEmptyPocState({
      pocId: "poc-exact",
      conferenceName: "neg-poc-server-stop-1",
    }),
    cwd,
  );

  const payload = buildPocCallbackPayload({
    eventType: "command_accepted",
    action: "ping",
    operationId: "op-sibling-isolation",
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
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED: "true",
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: callbackSecret,
      // Force any mistaken env root away from sibling.
      VOXIMPLANT_SERVER_STOP_POC_STATE_ROOT: cwd,
    },
  });
  assert.equal(result.ok, true);

  const exactState = readPocState(cwd);
  assert.equal(exactState?.callbackEvents.length, 1);

  const siblingRaw = readFileSync(
    join(sibling, ".agent", "voximplant-server-stop-poc.json"),
    "utf8",
  );
  assert.match(siblingRaw, /poisoned/);
  assert.ok(!siblingRaw.includes("op-sibling-isolation"));
});

test("exact worktree diagnostic detects sibling process", () => {
  const expected = getPocWorktreeDiagnostic(process.env, getPocRepositoryRoot());
  assert.equal(
    classifyWorktreeMatch({
      observedFingerprint: expected.worktreeFingerprint,
      expectedFingerprint: expected.worktreeFingerprint,
    }),
    "EXACT_POC_WORKTREE",
  );
  assert.equal(
    classifyWorktreeMatch({
      observedFingerprint: "deadbeefdeadbeef",
      expectedFingerprint: expected.worktreeFingerprint,
    }),
    "SIBLING_WORKTREE",
  );
  assert.equal(
    classifyWorktreeMatch({
      observedFingerprint: null,
      expectedFingerprint: expected.worktreeFingerprint,
    }),
    "UNKNOWN_PROCESS",
  );
  assert.equal(typeof expected.callbackEnabled, "boolean");
  assert.ok(!JSON.stringify(expected).includes("C:\\"));
  assert.ok(!JSON.stringify(expected).includes("/Projects/"));
});
