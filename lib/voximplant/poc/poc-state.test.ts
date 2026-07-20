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
