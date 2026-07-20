import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyStartConferenceToState,
  clearPocState,
  createEmptyPocState,
  readPocState,
  toPublicPocStateView,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

test("state file write/read and clear removes only POC state", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-vox-state-"));
  const otherPath = join(cwd, "other.txt");
  writeFileSync(otherPath, "keep\n", "utf8");

  let state = createEmptyPocState({
    pocId: "poc-1",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "111",
    mediaSessionAccessUrl: "https://example.invalid/session/secret-url-token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/secret-url-token",
    ruleId: "9",
    applicationId: "8",
  });
  writePocState(state, cwd);

  const loaded = readPocState(cwd);
  assert.ok(loaded);
  assert.equal(loaded!.conferenceName, "neg-poc-server-stop-1");
  assert.equal(loaded!.mediaSessionAccessSecureUrl, "https://example.invalid/session/secret-url-token");

  const publicView = toPublicPocStateView(loaded!);
  assert.ok(!JSON.stringify(publicView).includes("secret-url-token"));
  assert.equal(publicView.hasControlUrl, true);

  const removed = clearPocState(cwd);
  assert.equal(removed, true);
  assert.equal(readPocState(cwd), null);
  assert.equal(readFileSync(otherPath, "utf8"), "keep\n");
});

test("gitignore includes .agent/ for POC state", () => {
  const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
  assert.match(gitignore, /^\.agent\/$/m);
});

test("start conference sets ~60s idle expiry and ACTIVE runtimeStatus", () => {
  const startedAt = "2026-07-20T12:00:00.000Z";
  let state = createEmptyPocState({
    pocId: "poc-ttl",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "111",
    mediaSessionAccessUrl: "https://example.invalid/session/secret-url-token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/secret-url-token",
    ruleId: "9",
    applicationId: "8",
    startedAt,
    idleTtlMs: 60_000,
  });
  assert.equal(state.runtimeStatus, "ACTIVE");
  assert.equal(state.expiresAt, "2026-07-20T12:01:00.000Z");
});

test("public view exposes runtimeStatus without control URL", () => {
  let state = createEmptyPocState({
    pocId: "poc-pub",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "111",
    mediaSessionAccessUrl: "https://example.invalid/session/secret-url-token",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/secret-url-token",
    ruleId: "9",
    applicationId: "8",
  });
  const view = toPublicPocStateView(state);
  assert.ok(["ACTIVE", "EXPIRED", "UNKNOWN"].includes(view.runtimeStatus));
  assert.ok(!JSON.stringify(view).includes("secret-url-token"));
});
