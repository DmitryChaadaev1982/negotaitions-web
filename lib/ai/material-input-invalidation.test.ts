import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MATERIAL_CHANGE_AI_ONLY_CONFIRMATION_MESSAGE,
  MATERIAL_CHANGE_AI_RUNNING,
  MATERIAL_CHANGE_CONFIRMATION_MESSAGE,
  MATERIAL_CHANGE_CONFIRMATION_REQUIRED,
  decideFacilitatorMaterialChangeGuard,
} from "@/lib/ai/material-input-invalidation";

test("material edits are blocked while AI is running", () => {
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: "ANALYZING",
    runLeaseActive: true,
    analysisCurrent: true,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.equal(decision.allow, false);
  if (!decision.allow) {
    assert.equal(decision.errorCode, MATERIAL_CHANGE_AI_RUNNING);
  }
});

test("active publication on a current analysis requires confirmation before material save", () => {
  const blocked = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: true,
    confirmRewindPublication: false,
  });
  assert.equal(blocked.allow, false);
  if (!blocked.allow) {
    assert.equal(blocked.errorCode, MATERIAL_CHANGE_CONFIRMATION_REQUIRED);
    assert.equal(blocked.error, MATERIAL_CHANGE_CONFIRMATION_MESSAGE);
    assert.equal(blocked.willRevokePublication, true);
  }

  const confirmed = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: true,
    confirmRewindPublication: true,
  });
  assert.deepEqual(confirmed, { allow: true, revokePublication: true });
});

test("historical NULL current AI still requires publication confirmation before material save", () => {
  const blocked = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: true,
    confirmRewindPublication: false,
  });
  assert.equal(blocked.allow, false);
  if (!blocked.allow) {
    assert.equal(blocked.errorCode, MATERIAL_CHANGE_CONFIRMATION_REQUIRED);
  }
});

test("current unpublished analysis requires confirmation without claiming a publication revoke", () => {
  const blocked = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.equal(blocked.allow, false);
  if (!blocked.allow) {
    assert.equal(blocked.errorCode, MATERIAL_CHANGE_CONFIRMATION_REQUIRED);
    assert.equal(blocked.error, MATERIAL_CHANGE_AI_ONLY_CONFIRMATION_MESSAGE);
    assert.equal(blocked.willRevokePublication, false);
  }

  const confirmed = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: true,
    hasActivePublication: false,
    confirmRewindPublication: true,
  });
  assert.deepEqual(confirmed, { allow: true, revokePublication: false });
});

test("historical non-current analysis does not warn even if a leftover publication row exists", () => {
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: false,
    hasActivePublication: true,
    confirmRewindPublication: false,
  });
  assert.deepEqual(decision, { allow: true, revokePublication: false });
});

test("material change without a current analysis is allowed and does not revoke", () => {
  const decision = decideFacilitatorMaterialChangeGuard({
    aiStatus: "COMPLETED",
    runLeaseActive: false,
    analysisCurrent: false,
    hasActivePublication: false,
    confirmRewindPublication: false,
  });
  assert.deepEqual(decision, { allow: true, revokePublication: false });
});

test("canonical material-save UIs no longer use native window.confirm", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const source = readFileSync(
    join(root, "components/recording-transcription-section.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /ConfirmDialog/);
  assert.match(source, /material-change-confirm-dialog/);
});
